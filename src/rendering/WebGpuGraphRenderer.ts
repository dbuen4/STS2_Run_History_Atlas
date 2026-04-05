import { Camera, createCamera, setupCameraControls, stepCamera, worldToCanvas } from "../camera";
import { clamp } from "../utils";
import { GraphDataset, GraphNode } from "../types";
import edgeShaderCode from "./edge.wgsl";
import forceShaderCode from "./forces.wgsl";
import nodeShaderCode from "./node.wgsl";

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

interface LabelBinding {
  nodeIndex: number;
  element: HTMLDivElement;
}

interface ImageBinding {
  nodeIndex: number;
  element: HTMLDivElement;
}

const SHOW_NODE_LABELS = false;
const NODE_STRIDE_FLOATS = 8;

class ForceDirectedLayout {
  private readonly adjacencyMatrixBuffer: GPUBuffer;
  private readonly computePipeline: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformBuffer: GPUBuffer;
  private readonly nodeCount: number;
  private readonly baseLength: number;
  private readonly initialMagnitude: number;
  private readonly coolingFactor: number = 0.985;
  private magnitude: number;

  constructor(device: GPUDevice, nodeBuffer: GPUBuffer, nodes: RenderNodeInput[], edges: EdgeInput[]) {
    this.nodeCount = nodes.length;
    const maxLabelExpansion = Math.max(...nodes.map((node) => node.layoutRadius - node.radius), 0);
    this.baseLength = 0.1 + Math.min(0.12, maxLabelExpansion * 0.35);
    this.initialMagnitude = maxLabelExpansion > 0 ? 0.072 : 0.06;
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
      ],
    });

    this.updateUniforms(device);
  }

  private updateUniforms(device: GPUDevice): void {
    device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([this.nodeCount]));
    device.queue.writeBuffer(this.uniformBuffer, 4, new Float32Array([this.magnitude, this.baseLength]));
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

function getInitialPositions(nodes: RenderNodeInput[]): Array<{ x: number; y: number }> {
  const nodeCount = nodes.length;
  if (nodeCount === 0) {
    return [];
  }

  const baseRing = nodeCount <= 8 ? 0.52 : 0.68;
  const maxLayoutRadius = Math.max(...nodes.map((node) => node.layoutRadius), 0);
  const radius = clamp(baseRing + maxLayoutRadius * Math.sqrt(nodeCount), baseRing, 1.05);
  return Array.from({ length: nodeCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / nodeCount - Math.PI / 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

export class WebGpuGraphRenderer {
  private readonly canvas: HTMLCanvasElement;
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
    labelLayer: HTMLDivElement | null,
    noWebGpuMessage: (message: string) => void
  ) {
    this.canvas = canvas;
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
      this.clearLabels();
      this.resetCamera();
      return;
    }

    const positions = getInitialPositions(graph.nodes);
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
    this.applyCameraFitFromNodeData(this.nodeSnapshot, graph.nodes.length);
    this.createLabels(graph.nodes);
    this.showEdges = graph.showEdges ?? false;

    const nodeIndexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const edgeData = new Float32Array(graph.edges.length * 8);
    graph.edges.forEach((edge, index) => {
      const start = nodeIndexById.get(edge.sourceId);
      const end = nodeIndexById.get(edge.targetId);
      if (start === undefined || end === undefined) {
        return;
      }

      const sourceOffset = start * NODE_STRIDE_FLOATS;
      const targetOffset = end * NODE_STRIDE_FLOATS;
      const offset = index * 8;
      edgeData[offset] = nodeData[sourceOffset];
      edgeData[offset + 1] = nodeData[sourceOffset + 1];
      edgeData[offset + 2] = nodeData[targetOffset];
      edgeData[offset + 3] = nodeData[targetOffset + 1];
      const colorStrength = this.showEdges ? 0.65 : 0.4;
      edgeData[offset + 4] = (nodeData[sourceOffset + 4] + nodeData[targetOffset + 4]) * colorStrength;
      edgeData[offset + 5] = (nodeData[sourceOffset + 5] + nodeData[targetOffset + 5]) * colorStrength;
      edgeData[offset + 6] = (nodeData[sourceOffset + 6] + nodeData[targetOffset + 6]) * colorStrength;
      edgeData[offset + 7] = this.showEdges
        ? clamp(0.36 + edge.weight * 0.12, 0.36, 0.82)
        : clamp(0.18 + edge.weight * 0.08, 0.18, 0.46);
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
      size: Math.max(edgeData.byteLength, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.edgeBuffer.getMappedRange()).set(edgeData);
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

    const layoutEdges = graph.layoutEdges ?? graph.edges;
    if (graph.edges.length === 0 || layoutEdges.length > 0) {
      this.layout = new ForceDirectedLayout(this.device, this.nodeBuffer, graph.nodes, layoutEdges);
      this.layout.reset(this.device);
      this.layoutActive = true;
      this.autoFitEnabled = true;
      this.autoFitWarmupFrames = 2;
      this.autoFitReadbacksRemaining = 12;
    } else {
      this.layout = null;
      this.layoutActive = false;
      this.autoFitEnabled = false;
      this.autoFitWarmupFrames = 0;
      this.autoFitReadbacksRemaining = 0;
    }
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
            r: 0.96,
            g: 0.93,
            b: 0.88,
            a: 1,
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
    if (cameraChanged || this.labelBindings.length > 0 || this.imageBindings.length > 0) {
      this.renderLabels();
    }
  }
}
