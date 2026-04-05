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

const HALF_WIDTH: f32 = 0.006;

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let edge = edges[instanceIndex];
    let sourcePos = nodes[edge.sourceIndex].pos;
    let targetPos = nodes[edge.targetIndex].pos;

    let lineDir = normalize(targetPos - sourcePos);
    let perp = vec2f(-lineDir.y, lineDir.x) * HALF_WIDTH;

    // Quad layout (triangle-list, 6 vertices = 2 triangles):
    //   A(src+perp), B(src-perp), C(tgt+perp), C, B, D(tgt-perp)
    // Vertex → corner mapping: 0→A, 1→B, 2→C, 3→C, 4→B, 5→D
    let useTarget = vertexIndex >= 2u && vertexIndex != 4u;
    let useNegPerp = (vertexIndex == 1u) || (vertexIndex >= 4u);
    let basePos = select(sourcePos, targetPos, useTarget);
    let worldPosition = basePos + select(perp, -perp, useNegPerp);
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
