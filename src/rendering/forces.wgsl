struct Node {
    pos: vec2f,
    renderRadius: f32,
    layoutRadius: f32,
    color: vec4f,
};

// Per-node anchor: the position this node is gravitationally attracted toward,
// and a group ID so that only same-group nodes interact with each other.
// Struct size is 16 bytes (vec2f = 8, u32 = 4, pad u32 = 4).
struct NodeAnchor {
    pos: vec2f,
    groupId: u32,
    _pad: u32,
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
@group(0) @binding(3) var<storage, read> anchors: array<NodeAnchor>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let nodeIndex = globalId.x;
    if (nodeIndex >= uniforms.nodesLength) {
        return;
    }

    var force = vec2f(0.0, 0.0);
    let current = nodes[nodeIndex];
    let currentAnchor = anchors[nodeIndex];

    for (var i: u32 = 0u; i < uniforms.nodesLength; i = i + 1u) {
        if (i == nodeIndex) {
            continue;
        }
        // Nodes in different groups (e.g. cards from different character sectors) do not
        // interact, which naturally keeps them within their own region.
        if (anchors[i].groupId != currentAnchor.groupId) {
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

    // Importance-weighted gravity toward this node's anchor position.
    // For most views the anchor is the origin; for card stats it is the sector center,
    // which keeps cards pulled into their own region.
    // Quadratic scaling exaggerates the gap between top-ranked and lower-ranked nodes.
    let fromAnchor = current.pos - currentAnchor.pos;
    let importancePull = 0.012 + current.renderRadius * current.renderRadius * 0.28;
    force += -fromAnchor * importancePull;

    let forceLength = length(force);
    if (forceLength > 0.0001) {
        // Use max(magnitude, 0.012) so overlap resolution always has enough step budget.
        let stepBudget = max(uniforms.magnitude, 0.012);
        let step = min(forceLength, stepBudget);
        nodes[nodeIndex].pos = current.pos + normalize(force) * step;
    }
}
