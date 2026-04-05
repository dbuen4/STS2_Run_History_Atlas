struct Node {
    pos: vec2f,
    renderRadius: f32,
    layoutRadius: f32,
    color: vec4f,
};

struct EdgeSegment {
    sourcePos: vec2f,
    targetPos: vec2f,
    color: vec4f,
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
    let delta = edge.targetPos - edge.sourcePos;
    let segmentLength = length(delta);
    var direction = vec2f(1.0, 0.0);
    if (segmentLength > 0.0001) {
        direction = delta / segmentLength;
    }
    let normal = vec2f(-direction.y, direction.x);
    let halfWidth = 0.008;
    var quad = array<vec2f, 6>(
        vec2f(0.0, -1.0),
        vec2f(0.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(1.0, -1.0),
        vec2f(0.0, -1.0)
    );
    let local = quad[vertexIndex];
    let worldPosition = edge.sourcePos + delta * local.x + normal * local.y * halfWidth;
    let viewPosition = (worldPosition - camera.position) / camera.zoom;

    var output: VertexOutput;
    output.position = vec4f(viewPosition, 0.0, 1.0);
    output.color = edge.color;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    return input.color;
}
