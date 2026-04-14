import { Camera, createCamera, setupCameraControls, stepCamera, worldToCanvas } from "../camera";
import { rgbaToCssColor } from "../characterPalette";
import { type Point } from "./cardStatsLayout";
import { getCardStatsSectorGuides } from "../cardStatsSectors";
import { clamp } from "../utils";
import { GraphDataset, GraphNode } from "../types";
import edgeShaderCode from "./edge.wgsl";
import forceShaderCode from "./forces.wgsl";
import nodeShaderCode from "./node.wgsl";
import { buildCardStatsLayout, getCardStatsPositions } from "./cardStatsLayout";

interface EdgeInput {
  sourceId: string;
  targetId: string;
  weight: number;
}

interface RenderNodeInput {
  id: string;
  radius: number;
  layoutRadius: number;
  color: [number, number, number, number];
}

interface NodeAnchorInput {
  anchorX: number;
  anchorY: number;
  groupId: number;
}

interface LabelBinding {
  nodeIndex: number;
  element: HTMLDivElement;
}

interface ImageBinding {
  nodeIndex: number;
  element: HTMLDivElement;
}

interface CardStatsGuideBinding {
  labelWorldPosition: Point;
  startAngle: number;
  endAngle: number;
  label: HTMLDivElement;
  wedge: HTMLDivElement;
}

interface ScatterGuideBinding {
  metadata: NonNullable<GraphDataset["scatterPlot"]>;
  xAxisLine: HTMLDivElement;
  yAxisLine: HTMLDivElement;
  xAxisLabel: HTMLDivElement;
  yAxisLabel: HTMLDivElement;
  xMinLabel: HTMLDivElement;
  xMaxLabel: HTMLDivElement;
  yMinLabel: HTMLDivElement;
  yMaxLabel: HTMLDivElement;
}

const SHOW_NODE_LABELS = false;
const ENABLE_EDGE_RENDERING = true;
const NODE_STRIDE_FLOATS = 8;
const EDGE_STRIDE = 6; // sourceIndex(u32), targetIndex(u32), r(f32), g(f32), b(f32), a(f32)

class ForceDirectedLayout {
  private readonly adjacencyMatrixBuffer: GPUBuffer;
  private readonly anchorBuffer: GPUBuffer;
  private readonly computePipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly nodeCount: number;
  private readonly characterNodeCount: number;
  private readonly baseLength: number;
  private readonly initialMagnitude: number;
  private readonly coolingFactor: number = 0.985;
  private magnitude: number;

  constructor(device: GPUDevice, nodeBuffer: GPUBuffer, nodes: RenderNodeInput[], edges: EdgeInput[], characterNodeCount: number = 0, gentleSettle: boolean = false, anchors?: NodeAnchorInput[]) {
    this.nodeCount = nodes.length;
    this.characterNodeCount = characterNodeCount;
    const maxLabelExpansion = Math.max(...nodes.map((node) => node.layoutRadius - node.radius), 0);
    this.baseLength = 0.1 + Math.min(0.12, maxLabelExpansion * 0.35);
    this.initialMagnitude = gentleSettle ? 0.022 : (maxLabelExpansion > 0 ? 0.072 : 0.06);
    this.magnitude = this.initialMagnitude;

    const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
    const adjacencyMatrix = new Float32Array(this.nodeCount * this.nodeCount);
    for (const edge of edges) {
      const start = nodeIndexById.get(edge.sourceId);
      const end = nodeIndexById.get(edge.targetId);
      if (start === undefined || end === undefined) {
        continue;
      }

      const weight = Math.max(edge.weight, 0);
      const forwardIndex = start * this.nodeCount + end;
      const backwardIndex = end * this.nodeCount + start;
      adjacencyMatrix[forwardIndex] = Math.max(adjacencyMatrix[forwardIndex], weight);
      adjacencyMatrix[backwardIndex] = Math.max(adjacencyMatrix[backwardIndex], weight);
    }

    this.adjacencyMatrixBuffer = device.createBuffer({
      size: adjacencyMatrix.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.adjacencyMatrixBuffer.getMappedRange()).set(adjacencyMatrix);
    this.adjacencyMatrixBuffer.unmap();

    // Anchor buffer: 16 bytes per node (vec2f pos + u32 groupId + u32 pad).
    // Defaults to all-zero (anchor at origin, group 0) when no anchors are supplied,
    // which preserves the original behaviour for spiral and profile views.
    const anchorData = new ArrayBuffer(Math.max(this.nodeCount * 16, 16));
    if (anchors) {
      const anchorF32 = new Float32Array(anchorData);
      const anchorU32 = new Uint32Array(anchorData);
      for (let i = 0; i < this.nodeCount; i++) {
        const a = anchors[i];
        if (a) {
          anchorF32[i * 4 + 0] = a.anchorX;
          anchorF32[i * 4 + 1] = a.anchorY;
          anchorU32[i * 4 + 2] = a.groupId;
        }
      }
    }
    this.anchorBuffer = device.createBuffer({
      size: anchorData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(this.anchorBuffer.getMappedRange()).set(new Uint8Array(anchorData));
    this.anchorBuffer.unmap();

    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.computePipeline = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({ code: forceShaderCode }),
        entryPoint: "main",
      },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: nodeBuffer } },
        { binding: 1, resource: { buffer: this.adjacencyMatrixBuffer } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.anchorBuffer } },
      ],
    });

    this.updateUniforms(device);
  }

  private updateUniforms(device: GPUDevice): void {
    device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([this.nodeCount]));
    device.queue.writeBuffer(this.uniformBuffer, 4, new Float32Array([this.magnitude, this.baseLength]));
    device.queue.writeBuffer(this.uniformBuffer, 12, new Uint32Array([this.characterNodeCount]));
  }

  reset(device: GPUDevice): void {
    this.magnitude = this.initialMagnitude;
    this.updateUniforms(device);
  }

  run(device: GPUDevice): boolean {
    if (this.nodeCount === 0 || this.magnitude < 0.001) {
      return false;
    }

    const commandEncoder = device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.computePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.nodeCount / 64), 1, 1);
    pass.end();
    device.queue.submit([commandEncoder.finish()]);

    this.magnitude *= this.coolingFactor;
    device.queue.writeBuffer(this.uniformBuffer, 4, new Float32Array([this.magnitude]));
    return this.magnitude >= 0.001;
  }
}

function createBlendState(): GPUBlendState {
  return {
    color: {
      srcFactor: "src-alpha",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
    alpha: {
      srcFactor: "one",
      dstFactor: "one-minus-src-alpha",
      operation: "add",
    },
  };
}

function getInitialPositions(graph: GraphDataset): Array<{ x: number; y: number }> {
  const nodes = graph.nodes;
  const nodeCount = nodes.length;
  if (nodeCount === 0) return [];
  if (nodeCount === 1) return [{ x: 0, y: 0 }];
  if (graph.fixedPositions && graph.fixedPositions.length === nodeCount) {
    return graph.fixedPositions.map((position) => ({ x: position.x, y: position.y }));
  }

  if (graph.view === "cardStats") {
    return getCardStatsPositions(graph);
  }

  if (graph.view === "profileOverview") {
    return getProfileOverviewPositions(nodes);
  }

  return getSpiralPositions(nodes);
}

/**
 * Archimedean spiral layout: largest nodes placed at the center, smallest at the outer edge.
 * Checks each placement against ALL previously placed nodes to prevent overlap.
 */
function getSpiralPositions(nodes: GraphNode[]): Array<{ x: number; y: number }> {
  const nodeCount = nodes.length;
  const positions = new Array<{ x: number; y: number }>(nodeCount);

  // Sort indices by radius descending so the biggest node lands at the spiral center.
  const sortedIndices = nodes
    .map((_, i) => i)
    .sort((a, b) => nodes[b].radius - nodes[a].radius);

  positions[sortedIndices[0]] = { x: 0, y: 0 };

  // Arm spacing derived from the largest node so adjacent arms never collide.
  const maxLayoutRadius = Math.max(...nodes.map((n) => n.layoutRadius));
  const b = (maxLayoutRadius * 1.5) / Math.PI;
  const gap = maxLayoutRadius * 0.4;
  let angle = 0;

  for (let i = 1; i < nodeCount; i++) {
    const nodeIdx = sortedIndices[i];
    const nodeLayout = nodes[nodeIdx].layoutRadius;

    // Initial angle advance based on previous consecutive node.
    const prevIdx = sortedIndices[i - 1];
    const minDist = nodeLayout + nodes[prevIdx].layoutRadius + gap;
    const currentR = Math.max(b * angle, minDist * 0.5);
    angle += minDist / currentR;

    // Collision check against every already-placed node; advance if overlapping.
    let r = b * angle;
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      let overlapping = false;

      for (let j = 0; j < i; j++) {
        const otherIdx = sortedIndices[j];
        const other = positions[otherIdx];
        const dx = x - other.x;
        const dy = y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nodeLayout + nodes[otherIdx].layoutRadius + gap * 0.5) {
          overlapping = true;
          break;
        }
      }

      if (!overlapping) break;
      angle += 0.2;
      r = b * angle;
    }

    positions[nodeIdx] = {
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
    };
  }

  return positions;
}

/**
 * Profile Overview: evenly space nodes in a single horizontal row.
 */
function getProfileOverviewPositions(nodes: GraphNode[]): Array<{ x: number; y: number }> {
  const nodeCount = nodes.length;
  const positions = new Array<{ x: number; y: number }>(nodeCount);
  const maxLayoutRadius = Math.max(...nodes.map((n) => n.layoutRadius));
  const spacing = maxLayoutRadius * 2.8;
  const totalWidth = (nodeCount - 1) * spacing;

  for (let i = 0; i < nodeCount; i++) {
    positions[i] = {
      x: -totalWidth / 2 + i * spacing,
      y: 0,
    };
  }

  return positions;
}

export class WebGpuGraphRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly guideLayer: HTMLDivElement | null;
  private readonly labelLayer: HTMLDivElement | null;
  private readonly noWebGpuMessage: (message: string) => void;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private nodePipeline: GPURenderPipeline | null = null;
  private edgePipeline: GPURenderPipeline | null = null;
  private camera: Camera = createCamera();
  private cameraBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private edgeBuffer: GPUBuffer | null = null;
  private edgeCount: number = 0;
  private nodeCount: number = 0;
  private layout: ForceDirectedLayout | null = null;
  private layoutActive: boolean = false;
  private animationHandle: number | null = null;
  private guideBindings: CardStatsGuideBinding[] = [];
  private guideWorldRadius: number = 0;
  private scatterGuideBinding: ScatterGuideBinding | null = null;
  private imageBindings: ImageBinding[] = [];
  private labelBindings: LabelBinding[] = [];
  private nodeSnapshot: Float32Array = new Float32Array();
  private nodeReadbackBuffer: GPUBuffer | null = null;
  private nodeReadbackPending: boolean = false;
  private nodeBufferSize: number = 0;
  private graphVersion: number = 0;
  private frameCount: number = 0;
  private autoFitEnabled: boolean = false;
  private autoFitWarmupFrames: number = 0;
  private autoFitReadbacksRemaining: number = 0;
  private homeCamera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 };
  private showEdges: boolean = false;

  constructor(
    canvas: HTMLCanvasElement,
    guideLayer: HTMLDivElement | null,
    labelLayer: HTMLDivElement | null,
    noWebGpuMessage: (message: string) => void
  ) {
    this.canvas = canvas;
    this.guideLayer = guideLayer;
    this.labelLayer = labelLayer;
    this.noWebGpuMessage = noWebGpuMessage;
  }

  async initialize(): Promise<void> {
    if (!navigator.gpu) {
      this.noWebGpuMessage("This browser does not expose WebGPU. Please open the app in Chromium or Edge.");
      return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      this.noWebGpuMessage("WebGPU is present, but no compatible adapter was returned.");
      return;
    }

    this.device = await adapter.requestDevice();
    this.device.addEventListener("uncapturederror", (event) => {
      const message = event.error?.message ?? "Unknown WebGPU runtime error.";
      this.noWebGpuMessage(`WebGPU runtime error: ${message}`);
      console.error("[WebGPU uncaptured error]", event.error);
    });
    this.device.lost.then((info) => {
      const reason = info.reason ? `${info.reason}: ` : "";
      this.noWebGpuMessage(`WebGPU device was lost. ${reason}${info.message}`);
      console.error("[WebGPU device lost]", info);
    });
    this.context = this.canvas.getContext("webgpu") as GPUCanvasContext | null;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    if (!this.context) {
      this.noWebGpuMessage("The canvas could not create a WebGPU context.");
      return;
    }

    this.configureCanvas();

    this.cameraBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.updateCameraBuffer();
    setupCameraControls(this.canvas, this.camera, () => this.updateCameraBuffer());

    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });
    const blendState = createBlendState();

    this.nodePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: nodeShaderCode }),
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.device.createShaderModule({ code: nodeShaderCode }),
        entryPoint: "fragmentMain",
        targets: [{ format: this.format, blend: blendState }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    this.edgePipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: edgeShaderCode }),
        entryPoint: "vertexMain",
      },
      fragment: {
        module: this.device.createShaderModule({ code: edgeShaderCode }),
        entryPoint: "fragmentMain",
        targets: [{ format: this.format, blend: blendState }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });

    window.addEventListener("resize", () => this.configureCanvas());
    this.startRenderLoop();
  }

  private configureCanvas(): void {
    if (!this.device || !this.context || !this.format) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "premultiplied",
    });
  }

  private updateCameraBuffer(): void {
    if (!this.device || !this.cameraBuffer) {
      return;
    }

    this.device.queue.writeBuffer(
      this.cameraBuffer,
      0,
      new Float32Array([this.camera.x, this.camera.y, this.camera.zoom, 0])
    );
  }

  private clearGuideOverlays(): void {
    this.guideBindings = [];
    this.guideWorldRadius = 0;
    this.scatterGuideBinding = null;
    if (this.guideLayer) {
      this.guideLayer.replaceChildren();
      this.guideLayer.hidden = true;
    }
  }

  private createCardStatsGuides(
    graph: GraphDataset,
    guideWorldRadius: number,
    labelAnchorBySectorId: Map<string, Point>
  ): void {
    if (!this.guideLayer) {
      return;
    }

    if (graph.view !== "cardStats") {
      this.clearGuideOverlays();
      return;
    }

    this.clearGuideOverlays();

    const guideBindings = getCardStatsSectorGuides().map((guide) => {
      const wedge = document.createElement("div");
      wedge.style.position = "absolute";
      wedge.style.inset = "0";
      wedge.style.background = rgbaToCssColor([guide.color[0], guide.color[1], guide.color[2], 0.12]);

      const label = document.createElement("div");
      label.className = "card-stats-guide-label";
      label.textContent = guide.label;
      label.style.borderColor = rgbaToCssColor([guide.color[0], guide.color[1], guide.color[2], 0.18]);
      label.style.background = rgbaToCssColor([1, 0.99, 0.97, 0.74]);

      return {
        labelWorldPosition: labelAnchorBySectorId.get(guide.id) ?? {
          x: Math.cos(guide.angle) * guideWorldRadius,
          y: Math.sin(guide.angle) * guideWorldRadius,
        },
        startAngle: guide.startAngle,
        endAngle: guide.endAngle,
        label,
        wedge,
      };
    });

    this.guideBindings = guideBindings;
    this.guideWorldRadius = guideWorldRadius;
    this.guideLayer.hidden = false;
    this.guideLayer.replaceChildren(
      ...guideBindings.map((binding) => binding.wedge),
      ...guideBindings.map((binding) => binding.label)
    );
    this.renderCardStatsGuides();
  }

  private createScatterGuides(graph: GraphDataset): void {
    if (!this.guideLayer) {
      return;
    }

    if (graph.view !== "runScatter" || !graph.scatterPlot) {
      this.clearGuideOverlays();
      return;
    }

    this.clearGuideOverlays();

    const createLine = (): HTMLDivElement => {
      const element = document.createElement("div");
      element.className = "scatter-guide-line";
      return element;
    };
    const createLabel = (className: string, textContent: string): HTMLDivElement => {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = textContent;
      return element;
    };

    this.scatterGuideBinding = {
      metadata: graph.scatterPlot,
      xAxisLine: createLine(),
      yAxisLine: createLine(),
      xAxisLabel: createLabel("scatter-guide-label", graph.scatterPlot.xAxis.label),
      yAxisLabel: createLabel(
        "scatter-guide-label scatter-guide-label-vertical",
        graph.scatterPlot.yAxis.label
      ),
      xMinLabel: createLabel("scatter-guide-value", graph.scatterPlot.xAxis.minLabel),
      xMaxLabel: createLabel("scatter-guide-value", graph.scatterPlot.xAxis.maxLabel),
      yMinLabel: createLabel("scatter-guide-value", graph.scatterPlot.yAxis.minLabel),
      yMaxLabel: createLabel("scatter-guide-value", graph.scatterPlot.yAxis.maxLabel),
    };

    this.guideLayer.hidden = false;
    this.guideLayer.replaceChildren(
      this.scatterGuideBinding.xAxisLine,
      this.scatterGuideBinding.yAxisLine,
      this.scatterGuideBinding.xAxisLabel,
      this.scatterGuideBinding.yAxisLabel,
      this.scatterGuideBinding.xMinLabel,
      this.scatterGuideBinding.xMaxLabel,
      this.scatterGuideBinding.yMinLabel,
      this.scatterGuideBinding.yMaxLabel
    );
    this.renderScatterGuides();
  }

  private renderCardStatsGuides(): void {
    if (!this.guideLayer || this.guideBindings.length === 0 || this.guideWorldRadius <= 0) {
      return;
    }

    const center = worldToCanvas(0, 0, this.camera, this.canvas);

    for (const binding of this.guideBindings) {
      const arcAngles = [
        binding.startAngle,
        binding.startAngle + (binding.endAngle - binding.startAngle) * 0.33,
        binding.startAngle + (binding.endAngle - binding.startAngle) * 0.66,
        binding.endAngle,
      ];
      const arcPoints = arcAngles.map((angle) =>
        worldToCanvas(
          Math.cos(angle) * this.guideWorldRadius,
          Math.sin(angle) * this.guideWorldRadius,
          this.camera,
          this.canvas
        )
      );
      const polygon = [
        `${center.x}px ${center.y}px`,
        ...arcPoints.map((point) => `${point.x}px ${point.y}px`),
      ];

      binding.wedge.style.clipPath = `polygon(${polygon.join(", ")})`;

      const labelCenter = worldToCanvas(
        binding.labelWorldPosition.x,
        binding.labelWorldPosition.y,
        this.camera,
        this.canvas
      );
      const labelVisible =
        labelCenter.x >= -80 &&
        labelCenter.x <= this.canvas.clientWidth + 80 &&
        labelCenter.y >= -24 &&
        labelCenter.y <= this.canvas.clientHeight + 24;

      binding.label.style.display = labelVisible ? "block" : "none";
      if (!labelVisible) {
        continue;
      }

      binding.label.style.left = `${labelCenter.x}px`;
      binding.label.style.top = `${labelCenter.y}px`;
    }
  }

  private positionGuideLine(element: HTMLDivElement, start: Point, end: Point): void {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    element.style.left = `${start.x}px`;
    element.style.top = `${start.y}px`;
    element.style.width = `${length}px`;
    element.style.transform = `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`;
  }

  private renderScatterGuides(): void {
    if (!this.guideLayer || !this.scatterGuideBinding) {
      return;
    }

    const { worldBounds } = this.scatterGuideBinding.metadata;
    const bottomLeft = worldToCanvas(worldBounds.minX, worldBounds.minY, this.camera, this.canvas);
    const bottomRight = worldToCanvas(worldBounds.maxX, worldBounds.minY, this.camera, this.canvas);
    const topLeft = worldToCanvas(worldBounds.minX, worldBounds.maxY, this.camera, this.canvas);
    const xMid = (bottomLeft.x + bottomRight.x) / 2;
    const yMid = (bottomLeft.y + topLeft.y) / 2;

    this.positionGuideLine(this.scatterGuideBinding.xAxisLine, bottomLeft, bottomRight);
    this.positionGuideLine(this.scatterGuideBinding.yAxisLine, bottomLeft, topLeft);

    this.scatterGuideBinding.xAxisLabel.style.left = `${xMid}px`;
    this.scatterGuideBinding.xAxisLabel.style.top = `${Math.max(bottomLeft.y, bottomRight.y) + 18}px`;
    this.scatterGuideBinding.yAxisLabel.style.left = `${topLeft.x - 28}px`;
    this.scatterGuideBinding.yAxisLabel.style.top = `${yMid}px`;

    this.scatterGuideBinding.xMinLabel.style.left = `${bottomLeft.x}px`;
    this.scatterGuideBinding.xMinLabel.style.top = `${Math.max(bottomLeft.y, bottomRight.y) + 2}px`;
    this.scatterGuideBinding.xMaxLabel.style.left = `${bottomRight.x}px`;
    this.scatterGuideBinding.xMaxLabel.style.top = `${Math.max(bottomLeft.y, bottomRight.y) + 2}px`;
    this.scatterGuideBinding.yMinLabel.style.left = `${topLeft.x - 8}px`;
    this.scatterGuideBinding.yMinLabel.style.top = `${bottomLeft.y}px`;
    this.scatterGuideBinding.yMaxLabel.style.left = `${topLeft.x - 8}px`;
    this.scatterGuideBinding.yMaxLabel.style.top = `${topLeft.y}px`;
  }

  private clearLabels(): void {
    this.imageBindings = [];
    this.labelBindings = [];
    this.nodeSnapshot = new Float32Array();
    if (this.labelLayer) {
      this.labelLayer.replaceChildren();
      this.labelLayer.hidden = true;
    }
  }

  private createLabels(nodes: GraphNode[]): void {
    if (!this.labelLayer) {
      this.imageBindings = [];
      this.labelBindings = [];
      return;
    }

    const imageBindings = nodes
      .map((node, nodeIndex) => ({ node, nodeIndex }))
      .filter(({ node }) => Boolean(node.imageUrl))
      .map(({ node, nodeIndex }) => {
        const element = document.createElement("div");
        element.className = "node-image";

        const image = document.createElement("img");
        image.className = "node-image-img";
        image.src = node.imageUrl as string;
        image.alt = `${node.label} icon`;
        image.decoding = "async";
        image.draggable = false;
        element.append(image);

        return { nodeIndex, element };
      });

    const labelBindings = !SHOW_NODE_LABELS
      ? []
      : nodes
      .map((node, nodeIndex) => ({ node, nodeIndex }))
      .filter(({ node }) => node.kind !== "character")
      .map(({ node, nodeIndex }) => {
        const element = document.createElement("div");
        element.className = "node-label";
        element.textContent = node.label;
        return { nodeIndex, element };
      });

    this.imageBindings = imageBindings;
    this.labelBindings = labelBindings;
    this.labelLayer.hidden = imageBindings.length === 0 && labelBindings.length === 0;
    this.labelLayer.replaceChildren(
      ...imageBindings.map((binding) => binding.element),
      ...labelBindings.map((binding) => binding.element)
    );
  }

  private renderLabels(): void {
    if (
      !this.labelLayer ||
      (this.imageBindings.length === 0 && this.labelBindings.length === 0) ||
      this.nodeSnapshot.length === 0
    ) {
      return;
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const sizeBasis = Math.min(width, height);

    for (const binding of this.imageBindings) {
      const offset = binding.nodeIndex * NODE_STRIDE_FLOATS;
      const worldX = this.nodeSnapshot[offset];
      const worldY = this.nodeSnapshot[offset + 1];
      const radius = this.nodeSnapshot[offset + 2];
      const center = worldToCanvas(worldX, worldY, this.camera, this.canvas);
      const screenRadius = (radius / this.camera.zoom) * (sizeBasis / 2);
      const size = clamp(screenRadius * 2.15, 34, 156);
      const visible =
        center.x >= -(size / 2) &&
        center.x <= width + size / 2 &&
        center.y >= -(size / 2) &&
        center.y <= height + size / 2;

      binding.element.style.display = visible ? "block" : "none";
      if (!visible) {
        continue;
      }

      binding.element.style.left = `${center.x}px`;
      binding.element.style.top = `${center.y}px`;
      binding.element.style.width = `${size}px`;
      binding.element.style.height = `${size}px`;
      binding.element.style.opacity = `${clamp((screenRadius - 5) / 10, 0.45, 1)}`;
    }

    for (const binding of this.labelBindings) {
      const offset = binding.nodeIndex * NODE_STRIDE_FLOATS;
      const worldX = this.nodeSnapshot[offset];
      const worldY = this.nodeSnapshot[offset + 1];
      const radius = this.nodeSnapshot[offset + 2];
      const center = worldToCanvas(worldX, worldY, this.camera, this.canvas);
      const screenRadius = (radius / this.camera.zoom) * (sizeBasis / 2);
      const visible =
        center.x >= -screenRadius &&
        center.x <= width + screenRadius &&
        center.y >= -screenRadius &&
        center.y <= height + screenRadius;

      binding.element.style.display = visible ? "block" : "none";
      if (!visible) {
        continue;
      }

      const fontSize = clamp(screenRadius * 0.58, 11, 26);
      const maxWidth = clamp(screenRadius * 3.2, 90, 240);
      const paddingY = clamp(fontSize * 0.18, 2, 6);
      const paddingX = clamp(fontSize * 0.42, 6, 14);
      binding.element.style.left = `${center.x}px`;
      binding.element.style.top = `${center.y}px`;
      binding.element.style.fontSize = `${fontSize}px`;
      binding.element.style.maxWidth = `${maxWidth}px`;
      binding.element.style.padding = `${paddingY}px ${paddingX}px`;
      binding.element.style.opacity = `${clamp((screenRadius - 8) / 12, 0.35, 1)}`;
    }
  }

  private applyCameraFitToBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 0.32);
    const spanY = Math.max(maxY - minY, 0.32);
    const paddedSpan = Math.max(spanX, spanY) * 0.62;

    this.camera.x = centerX;
    this.camera.y = centerY;
    this.camera.zoom = clamp(paddedSpan, 0.18, 8);
    this.camera.targetX = centerX;
    this.camera.targetY = centerY;
    this.camera.targetZoom = this.camera.zoom;
    this.homeCamera = {
      x: centerX,
      y: centerY,
      zoom: this.camera.zoom,
    };
    this.updateCameraBuffer();
  }

  private applyCameraFitFromNodeData(nodeData: Float32Array, nodeCount: number): void {
    if (nodeData.length === 0 || nodeCount === 0) {
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < nodeCount; index += 1) {
      const offset = index * NODE_STRIDE_FLOATS;
      const worldX = nodeData[offset];
      const worldY = nodeData[offset + 1];
      const layoutRadius = nodeData[offset + 3];
      minX = Math.min(minX, worldX - layoutRadius);
      maxX = Math.max(maxX, worldX + layoutRadius);
      minY = Math.min(minY, worldY - layoutRadius);
      maxY = Math.max(maxY, worldY + layoutRadius);
    }

    this.applyCameraFitToBounds(minX, maxX, minY, maxY);
  }

  private queueNodeReadback(commandEncoder: GPUCommandEncoder): boolean {
    if (
      !this.nodeBuffer ||
      !this.nodeReadbackBuffer ||
      this.nodeReadbackPending ||
      this.nodeBufferSize === 0 ||
      (!this.autoFitEnabled && this.labelBindings.length === 0 && this.imageBindings.length === 0)
    ) {
      return false;
    }

    commandEncoder.copyBufferToBuffer(this.nodeBuffer, 0, this.nodeReadbackBuffer, 0, this.nodeBufferSize);
    this.nodeReadbackPending = true;
    return true;
  }

  private requestNodeReadback(version: number): void {
    if (!this.nodeReadbackBuffer) {
      this.nodeReadbackPending = false;
      return;
    }

    const readbackBuffer = this.nodeReadbackBuffer;
    readbackBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        if (version !== this.graphVersion) {
          return;
        }

        const mappedRange = readbackBuffer.getMappedRange();
        this.nodeSnapshot = new Float32Array(mappedRange.slice(0));
        if (this.autoFitEnabled && this.autoFitWarmupFrames <= 0 && this.autoFitReadbacksRemaining > 0) {
          this.applyCameraFitFromNodeData(this.nodeSnapshot, this.nodeCount);
          this.autoFitReadbacksRemaining -= 1;
          if (this.autoFitReadbacksRemaining <= 0) {
            this.autoFitEnabled = false;
          }
        }
        this.renderCardStatsGuides();
        this.renderScatterGuides();
        this.renderLabels();
      })
      .catch(() => {
        // Ignore transient readback failures during graph switches.
      })
      .finally(() => {
        try {
          readbackBuffer.unmap();
        } catch {
          // The buffer may already be unmapped after a graph swap.
        }
        if (version === this.graphVersion) {
          this.nodeReadbackPending = false;
        }
      });
  }

  resetCamera(): void {
    this.camera.x = this.homeCamera.x;
    this.camera.y = this.homeCamera.y;
    this.camera.zoom = this.homeCamera.zoom;
    this.camera.targetX = this.homeCamera.x;
    this.camera.targetY = this.homeCamera.y;
    this.camera.targetZoom = this.homeCamera.zoom;
    this.camera.isDragging = false;
    this.camera.lastMouseX = 0;
    this.camera.lastMouseY = 0;
    this.updateCameraBuffer();
    this.renderCardStatsGuides();
    this.renderScatterGuides();
    this.renderLabels();
  }

  setGraph(graph: GraphDataset): void {
    if (!this.device || !this.bindGroupLayout || !this.cameraBuffer) {
      return;
    }

    this.graphVersion += 1;
    this.nodeReadbackPending = false;
    console.info("[renderer] setGraph", {
      view: graph.view,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      edgeRenderingEnabled: graph.showEdges ?? false,
    });

    if (graph.nodes.length === 0) {
      this.homeCamera = { x: 0, y: 0, zoom: 1 };
      this.bindGroup = null;
      this.nodeBuffer = null;
      this.edgeBuffer = null;
      this.nodeReadbackBuffer = null;
      this.nodeBufferSize = 0;
      this.nodeCount = 0;
      this.edgeCount = 0;
      this.layout = null;
      this.layoutActive = false;
      this.autoFitEnabled = false;
      this.autoFitWarmupFrames = 0;
      this.autoFitReadbacksRemaining = 0;
      this.showEdges = false;
      this.clearGuideOverlays();
      this.clearLabels();
      this.resetCamera();
      return;
    }

    let positions = getInitialPositions(graph);
    let guideWorldRadius = 0;
    let labelAnchorBySectorId = new Map<string, Point>();
    let cardStatsLayout: ReturnType<typeof buildCardStatsLayout> | null = null;
    if (graph.view === "cardStats") {
      cardStatsLayout = buildCardStatsLayout(graph);
      positions = cardStatsLayout.positions;
      labelAnchorBySectorId = new Map(
        cardStatsLayout.labelAnchors.map((anchor) => [anchor.id, anchor.position] as const)
      );
      guideWorldRadius =
        Math.max(
          ...cardStatsLayout.groupLayouts.map(
            (layout) => Math.hypot(layout.center.x, layout.center.y) + layout.radius
          ),
          1.8
        ) + 0.55;
    }
    const nodeData = new Float32Array(graph.nodes.length * NODE_STRIDE_FLOATS);
    graph.nodes.forEach((node, index) => {
      const offset = index * NODE_STRIDE_FLOATS;
      nodeData[offset] = positions[index].x;
      nodeData[offset + 1] = positions[index].y;
      nodeData[offset + 2] = node.radius;
      nodeData[offset + 3] = node.layoutRadius;
      nodeData[offset + 4] = node.color[0];
      nodeData[offset + 5] = node.color[1];
      nodeData[offset + 6] = node.color[2];
      nodeData[offset + 7] = node.color[3];
    });
    this.nodeSnapshot = nodeData.slice();
    if (graph.view === "runScatter" && graph.scatterPlot) {
      this.applyCameraFitToBounds(
        graph.scatterPlot.worldBounds.minX,
        graph.scatterPlot.worldBounds.maxX,
        graph.scatterPlot.worldBounds.minY,
        graph.scatterPlot.worldBounds.maxY
      );
    } else {
      this.applyCameraFitFromNodeData(this.nodeSnapshot, graph.nodes.length);
    }
    if (graph.view === "cardStats") {
      this.createCardStatsGuides(graph, guideWorldRadius, labelAnchorBySectorId);
    } else if (graph.view === "runScatter") {
      this.createScatterGuides(graph);
    } else {
      this.clearGuideOverlays();
    }
    this.createLabels(graph.nodes);
    this.showEdges = graph.showEdges ?? false;

    const nodeIndexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
    // Edge buffer layout: [sourceIndex(u32), targetIndex(u32), r(f32), g(f32), b(f32), a(f32)]
    // Positions are looked up dynamically from the node buffer in the shader, so edges track moving nodes.
    const edgeRawBuffer = new ArrayBuffer(Math.max(graph.edges.length * EDGE_STRIDE * 4, 16));
    const edgeUint32 = new Uint32Array(edgeRawBuffer);
    const edgeFloat32 = new Float32Array(edgeRawBuffer);
    graph.edges.forEach((edge, index) => {
      const start = nodeIndexById.get(edge.sourceId);
      const end = nodeIndexById.get(edge.targetId);
      if (start === undefined || end === undefined) {
        return;
      }

      const offset = index * EDGE_STRIDE;
      edgeUint32[offset] = start;
      edgeUint32[offset + 1] = end;
      if (edge.color) {
        edgeFloat32[offset + 2] = edge.color[0];
        edgeFloat32[offset + 3] = edge.color[1];
        edgeFloat32[offset + 4] = edge.color[2];
      } else {
        const sn = graph.nodes[start];
        const en = graph.nodes[end];
        edgeFloat32[offset + 2] = (sn.color[0] + en.color[0]) * 0.4;
        edgeFloat32[offset + 3] = (sn.color[1] + en.color[1]) * 0.4;
        edgeFloat32[offset + 4] = (sn.color[2] + en.color[2]) * 0.4;
      }
      edgeFloat32[offset + 5] = clamp(0.18 + edge.weight * 0.08, 0.18, 0.46);
    });

    this.nodeBuffer = this.device.createBuffer({
      size: Math.max(nodeData.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Float32Array(this.nodeBuffer.getMappedRange()).set(nodeData);
    this.nodeBuffer.unmap();
    this.nodeBufferSize = Math.max(nodeData.byteLength, 32);

    this.edgeBuffer = this.device.createBuffer({
      size: Math.max(edgeRawBuffer.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(this.edgeBuffer.getMappedRange()).set(new Uint8Array(edgeRawBuffer));
    this.edgeBuffer.unmap();

    this.nodeReadbackBuffer = this.device.createBuffer({
      size: this.nodeBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.nodeBuffer } },
        { binding: 1, resource: { buffer: this.edgeBuffer } },
        { binding: 2, resource: { buffer: this.cameraBuffer } },
      ],
    });

    this.nodeCount = graph.nodes.length;
    this.edgeCount = graph.edges.length;
    this.frameCount = 0;

    // Enable force-directed layout for all views except the scatter plot
    // (which has fixed data-driven positions).
    if (graph.view !== "runScatter" && graph.nodes.length > 0) {
      const renderNodes: RenderNodeInput[] = graph.nodes.map((node) => ({
        id: node.id,
        radius: node.radius,
        layoutRadius: node.layoutRadius,
        color: node.color,
      }));
      const layoutEdges: EdgeInput[] = graph.layoutEdges ?? graph.edges;

      // Profile Overview: all nodes are characters, so disable the 10x character-pair
      // repulsion — otherwise every node pushes every other node away too strongly.
      const characterNodeCount =
        graph.view === "profileOverview"
          ? 0
          : graph.nodes.filter((n) => n.kind === "character").length;

      // Card Stats: build per-node anchor positions (sector centers) and group IDs so
      // that cards are attracted toward their sector center and only interact with
      // cards from the same character pool.
      let nodeAnchors: NodeAnchorInput[] | undefined;
      if (graph.view === "cardStats" && cardStatsLayout !== null) {
        const anchorByNodeId = new Map<string, NodeAnchorInput>();
        cardStatsLayout.groupLayouts.forEach((group, groupIndex) => {
          for (const nodeId of group.nodeIds) {
            anchorByNodeId.set(nodeId, {
              anchorX: group.center.x,
              anchorY: group.center.y,
              groupId: groupIndex,
            });
          }
        });
        nodeAnchors = graph.nodes.map((node) => {
          const a = anchorByNodeId.get(node.id);
          return { anchorX: a?.anchorX ?? 0, anchorY: a?.anchorY ?? 0, groupId: a?.groupId ?? 0 };
        });
      }

      this.layout = new ForceDirectedLayout(
        this.device,
        this.nodeBuffer!,
        renderNodes,
        layoutEdges,
        characterNodeCount,
        graph.view === "cardStats", // gentleSettle: card positions are already well-placed
        nodeAnchors
      );
      this.layoutActive = true;
    } else {
      this.layout = null;
      this.layoutActive = false;
    }

    this.autoFitEnabled = graph.view !== "runScatter";
    this.autoFitWarmupFrames = graph.view === "runScatter" ? 0 : 2;
    this.autoFitReadbacksRemaining = graph.view === "runScatter" ? 0 : 12;
    this.renderLabels();
  }

  private startRenderLoop(): void {
    const render = (): void => {
      this.animationHandle = window.requestAnimationFrame(render);
      this.renderFrame();
    };

    if (this.animationHandle === null) {
      render();
    }
  }

  private renderFrame(): void {
    if (!this.device || !this.context || !this.nodePipeline || !this.edgePipeline) {
      return;
    }

    this.configureCanvas();
    const cameraChanged = stepCamera(this.camera);
    if (cameraChanged) {
      this.updateCameraBuffer();
    }

    if (this.layout && this.layoutActive) {
      this.layoutActive = this.layout.run(this.device);
    }

    this.frameCount += 1;
    if (this.autoFitEnabled && this.autoFitWarmupFrames > 0) {
      this.autoFitWarmupFrames -= 1;
    }
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
          },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    if (this.showEdges && this.bindGroup && this.edgeCount > 0) {
      pass.setPipeline(this.edgePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6, this.edgeCount);
    }

    if (this.bindGroup && this.nodeCount > 0) {
      pass.setPipeline(this.nodePipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6, this.nodeCount);
    }

    pass.end();
    const shouldReadbackNodes = this.autoFitEnabled
      ? true
      : (this.labelBindings.length > 0 || this.imageBindings.length > 0) &&
        (this.layoutActive || this.frameCount % 18 === 0);
    const queuedReadback = shouldReadbackNodes ? this.queueNodeReadback(commandEncoder) : false;
    this.device.queue.submit([commandEncoder.finish()]);
    if (queuedReadback) {
      this.requestNodeReadback(this.graphVersion);
    }
    if (cameraChanged || this.guideBindings.length > 0 || this.labelBindings.length > 0 || this.imageBindings.length > 0) {
      this.renderCardStatsGuides();
      this.renderScatterGuides();
      this.renderLabels();
    }
  }
}
