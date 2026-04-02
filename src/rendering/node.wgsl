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
    @location(1) @interpolate(flat) center: vec2f,
    @location(2) worldPosition: vec2f,
    @location(3) @interpolate(flat) radius: f32,
};

@vertex
fn vertexMain(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
    let node = nodes[instanceIndex];
    var quad = array<vec2f, 6>(
        vec2f(-1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(1.0, -1.0),
        vec2f(-1.0, -1.0)
    );

    let local = quad[vertexIndex] * node.renderRadius;
    let worldPosition = node.pos + local;
    let viewPosition = (worldPosition - camera.position) / camera.zoom;

    var output: VertexOutput;
    output.position = vec4f(viewPosition, 0.0, 1.0);
    output.color = node.color;
    output.center = node.pos;
    output.worldPosition = worldPosition;
    output.radius = node.renderRadius;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let radialDistance = distance(input.worldPosition, input.center);
    if (radialDistance > input.radius) {
        discard;
    }

    return input.color;
}
