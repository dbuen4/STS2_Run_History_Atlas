struct Node {
    pos: vec2f,
    renderRadius: f32,
    layoutRadius: f32,
    color: vec4f,
};

struct EdgeSegment {
    sourceIndex: u32,
    targetIndex: u32,
    colorR: f32,
    colorG: f32,
    colorB: f32,
    colorA: f32,
};

struct Camera {
    position: vec2f,
    zoom: f32,
    padding: f32,
};

@group(0) @binding(0) var<storage, read> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> edges: array<EdgeSegment>;
@group(0) @binding(2) var<uniform> camera: Camera;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
};

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let edge = edges[instanceIndex];
    let sourceNode = nodes[edge.sourceIndex];
    let targetNode = nodes[edge.targetIndex];
    let worldPosition = select(targetNode.pos, sourceNode.pos, vertexIndex == 0u);
    let viewPosition = (worldPosition - camera.position) / camera.zoom;

    var output: VertexOutput;
    output.position = vec4f(viewPosition, 0.0, 1.0);
    output.color = vec4f(edge.colorR, edge.colorG, edge.colorB, edge.colorA);
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return input.color;
}
