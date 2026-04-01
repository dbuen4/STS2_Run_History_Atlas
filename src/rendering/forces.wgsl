struct Node {
    pos: vec2f,
    renderRadius: f32,
    layoutRadius: f32,
    color: vec4f,
};

struct Uniforms {
    nodesLength: u32,
    magnitude: f32,
    baseLength: f32,
    padding: f32,
};

@group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> adjacencyMatrix: array<u32>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let nodeIndex = globalId.x;
    if (nodeIndex >= uniforms.nodesLength) {
        return;
    }

    var force = vec2f(0.0, 0.0);
    let current = nodes[nodeIndex];

    for (var i: u32 = 0u; i < uniforms.nodesLength; i = i + 1u) {
        if (i == nodeIndex) {
            continue;
        }

        let other = nodes[i];
        let delta = other.pos - current.pos;
        let dist = max(length(delta), 0.001);
        let direction = delta / dist;
        let desired = current.layoutRadius + other.layoutRadius + uniforms.baseLength;
        let connected = adjacencyMatrix[nodeIndex * uniforms.nodesLength + i] == 1u;

        if (connected) {
            let attraction = (dist - desired) * 0.22;
            force += direction * attraction;
        } else {
            let overlap = max(desired - dist, 0.0);
            let repulsion = ((desired * desired) / (dist * dist)) * 0.012 + overlap * 0.55;
            force -= direction * repulsion;
        }
    }

    force += -current.pos * 0.014;

    let forceLength = length(force);
    if (forceLength > 0.0001) {
        let step = min(forceLength, uniforms.magnitude);
        let nextPos = current.pos + normalize(force) * step;
        nodes[nodeIndex].pos = clamp(nextPos, vec2f(-1.45, -1.45), vec2f(1.45, 1.45));
    }
}
