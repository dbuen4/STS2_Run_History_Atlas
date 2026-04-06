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
    characterNodeCount: u32,
};

@group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> adjacencyMatrix: array<f32>;
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
        let connectionStrength = adjacencyMatrix[nodeIndex * uniforms.nodesLength + i];

        if (connectionStrength > 0.0) {
            let attraction = (dist - desired) * (0.18 + connectionStrength * 0.12);
            force += direction * attraction;
        } else {
            let overlap = max(desired - dist, 0.0);
            // overlap * 2.5: strong enough to separate nodes even when magnitude is near 0.
            let baseRepulsion = ((desired * desired) / (dist * dist)) * 0.045 + overlap * 2.5;
            // Character hubs repel each other strongly to keep clusters separated.
            let characterPair = (nodeIndex < uniforms.characterNodeCount) && (i < uniforms.characterNodeCount);
            let repulsionMult = select(1.0, 10.0, characterPair);
            force -= direction * baseRepulsion * repulsionMult;
        }
    }

    force += -current.pos * 0.014;

    let forceLength = length(force);
    if (forceLength > 0.0001) {
        // Use max(magnitude, 0.012) so overlap resolution always has enough step budget.
        let stepBudget = max(uniforms.magnitude, 0.012);
        let step = min(forceLength, stepBudget);
        nodes[nodeIndex].pos = current.pos + normalize(force) * step;
    }
}
