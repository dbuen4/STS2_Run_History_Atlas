struct Node {
    pos: vec2f,
    renderRadius: f32,
    layoutRadius: f32,
    color: vec4f,
};

struct Edge {
    start: f32,
    end: f32,
    weight: f32,
    padding: f32,
};

struct Camera {
    position: vec2f,
    zoom: f32,
    padding: f32,
};

@group(0) @binding(0) var<storage, read> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> edges: array<Edge>;
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
    let source = nodes[u32(edge.start)];
    let target = nodes[u32(edge.end)];
    let current = select(target, source, vertexIndex == 0u);
    let worldPosition = current.pos;
    let viewPosition = (worldPosition - camera.position) / camera.zoom;

    var output: VertexOutput;
    output.position = vec4f(viewPosition, 0.0, 1.0);
    let mixedColor = mix(source.color, target.color, 0.5);
    output.color = vec4f(mixedColor.rgb * 0.8, clamp(0.18 + edge.weight * 0.08, 0.18, 0.46));
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return input.color;
}
