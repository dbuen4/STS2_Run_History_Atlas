import {
  CARD_STATS_SECTOR_STEP,
  COLORLESS_CARD_STATS_GROUP_ID,
  type CardStatsGroupId,
  type CardStatsSectorId,
  getCardStatsGroupId,
  getCardStatsSectorGuides,
} from "../cardStatsSectors";
import { GraphDataset, GraphNode } from "../types";

export interface Point {
  x: number;
  y: number;
}

export interface CardStatsGroupLayout {
  id: CardStatsGroupId;
  center: Point;
  radius: number;
  nodeIds: string[];
}

export interface CardStatsSectorLabelAnchor {
  id: CardStatsSectorId;
  position: Point;
}

export interface CardStatsLayoutResult {
  positions: Point[];
  groupLayouts: CardStatsGroupLayout[];
  labelAnchors: CardStatsSectorLabelAnchor[];
}

const CLUSTER_PADDING = 0.12;
const SECTOR_CLEARANCE = 0.34;
const HUB_CLEARANCE = 0.32;
const USABLE_SECTOR_HALF_SPAN = CARD_STATS_SECTOR_STEP * 0.43;

function createEmptyPositions(count: number): Point[] {
  return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
}

function getDistance(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function getSpiralPositions(nodes: GraphNode[]): Point[] {
  const nodeCount = nodes.length;
  if (nodeCount === 0) {
    return [];
  }

  if (nodeCount === 1) {
    return [{ x: 0, y: 0 }];
  }

  const positions = new Array<Point>(nodeCount);
  const sortedIndices = nodes
    .map((_, index) => index)
    .sort((left, right) => nodes[right].radius - nodes[left].radius);

  positions[sortedIndices[0]] = { x: 0, y: 0 };

  const maxLayoutRadius = Math.max(...nodes.map((node) => node.layoutRadius));
  const spiralScale = (maxLayoutRadius * 1.5) / Math.PI;
  const gap = maxLayoutRadius * 0.4;
  let angle = 0;

  for (let sortedIndex = 1; sortedIndex < nodeCount; sortedIndex += 1) {
    const nodeIndex = sortedIndices[sortedIndex];
    const nodeLayout = nodes[nodeIndex].layoutRadius;
    const previousIndex = sortedIndices[sortedIndex - 1];
    const minDistance = nodeLayout + nodes[previousIndex].layoutRadius + gap;
    const currentRadius = Math.max(spiralScale * angle, minDistance * 0.5);
    angle += minDistance / currentRadius;

    let radius = spiralScale * angle;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      let overlapping = false;

      for (let placedIndex = 0; placedIndex < sortedIndex; placedIndex += 1) {
        const otherIndex = sortedIndices[placedIndex];
        const other = positions[otherIndex];
        const dx = x - other.x;
        const dy = y - other.y;
        const distance = Math.hypot(dx, dy);
        if (distance < nodeLayout + nodes[otherIndex].layoutRadius + gap * 0.5) {
          overlapping = true;
          break;
        }
      }

      if (!overlapping) {
        break;
      }

      angle += 0.2;
      radius = spiralScale * angle;
    }

    positions[nodeIndex] = {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    };
  }

  return positions;
}

function buildClusterLayout(nodes: GraphNode[]): { positions: Point[]; radius: number } {
  const positions = getSpiralPositions(nodes);
  const radius = nodes.reduce((maxRadius, node, index) => {
    return Math.max(maxRadius, getDistance(positions[index]) + node.layoutRadius + CLUSTER_PADDING);
  }, 0);

  return { positions, radius };
}

export function buildCardStatsLayout(graph: GraphDataset): CardStatsLayoutResult {
  const positions = createEmptyPositions(graph.nodes.length);
  const groupLayouts: CardStatsGroupLayout[] = [];
  const labelAnchors: CardStatsSectorLabelAnchor[] = [];
  if (graph.nodes.length === 0) {
    return { positions, groupLayouts, labelAnchors };
  }

  const sectorGuides = getCardStatsSectorGuides();
  const hubIndexBySectorId = new Map<CardStatsSectorId, number>();
  const cardIndicesByGroupId = new Map<CardStatsGroupId, number[]>(
    sectorGuides.map((guide) => [guide.id, []] as const)
  );
  cardIndicesByGroupId.set(COLORLESS_CARD_STATS_GROUP_ID, []);

  graph.nodes.forEach((node, index) => {
    if (node.kind === "character") {
      const sectorId = sectorGuides.find((guide) => guide.id === node.id)?.id;
      if (sectorId) {
        hubIndexBySectorId.set(sectorId, index);
      }
      return;
    }

    if (node.kind !== "card") {
      return;
    }

    const groupId = getCardStatsGroupId(node.id) ?? COLORLESS_CARD_STATS_GROUP_ID;
    cardIndicesByGroupId.get(groupId)?.push(index);
  });

  const sectorLayouts = new Map<CardStatsSectorId, { indices: number[]; positions: Point[]; radius: number }>();
  let maxSectorRadius = 0;
  for (const guide of sectorGuides) {
    const indices = cardIndicesByGroupId.get(guide.id) ?? [];
    const nodes = indices.map((index) => graph.nodes[index]);
    const clusterLayout = buildClusterLayout(nodes);
    sectorLayouts.set(guide.id, {
      indices,
      positions: clusterLayout.positions,
      radius: clusterLayout.radius,
    });
    maxSectorRadius = Math.max(maxSectorRadius, clusterLayout.radius);
  }

  const colorlessIndices = cardIndicesByGroupId.get(COLORLESS_CARD_STATS_GROUP_ID) ?? [];
  const colorlessNodes = colorlessIndices.map((index) => graph.nodes[index]);
  const colorlessLayout = buildClusterLayout(colorlessNodes);

  const sectorCenterDistance = Math.max(
    maxSectorRadius > 0 ? maxSectorRadius / Math.sin(USABLE_SECTOR_HALF_SPAN) : 0,
    colorlessLayout.radius + maxSectorRadius + SECTOR_CLEARANCE,
    1.2
  );
  const hubDistance = sectorCenterDistance + maxSectorRadius + HUB_CLEARANCE;

  for (const guide of sectorGuides) {
    const directionX = Math.cos(guide.angle);
    const directionY = Math.sin(guide.angle);
    const center = {
      x: directionX * sectorCenterDistance,
      y: directionY * sectorCenterDistance,
    };
    const sectorLayout = sectorLayouts.get(guide.id);
    const hubIndex = hubIndexBySectorId.get(guide.id);
    const labelAnchor = {
      x: directionX * hubDistance,
      y: directionY * hubDistance,
    };

    labelAnchors.push({
      id: guide.id,
      position: labelAnchor,
    });

    if (hubIndex !== undefined) {
      positions[hubIndex] = labelAnchor;
    }

    if (sectorLayout) {
      sectorLayout.indices.forEach((nodeIndex, cardIndex) => {
        positions[nodeIndex] = {
          x: center.x + sectorLayout.positions[cardIndex].x,
          y: center.y + sectorLayout.positions[cardIndex].y,
        };
      });

      if (sectorLayout.indices.length > 0 || hubIndex !== undefined) {
        groupLayouts.push({
          id: guide.id,
          center,
          radius: sectorLayout.radius,
          nodeIds: [
            ...(hubIndex !== undefined ? [graph.nodes[hubIndex].id] : []),
            ...sectorLayout.indices.map((nodeIndex) => graph.nodes[nodeIndex].id),
          ],
        });
      }
    }
  }

  colorlessIndices.forEach((nodeIndex, colorlessIndex) => {
    positions[nodeIndex] = colorlessLayout.positions[colorlessIndex];
  });

  if (colorlessIndices.length > 0) {
    groupLayouts.push({
      id: COLORLESS_CARD_STATS_GROUP_ID,
      center: { x: 0, y: 0 },
      radius: colorlessLayout.radius,
      nodeIds: colorlessIndices.map((nodeIndex) => graph.nodes[nodeIndex].id),
    });
  }

  return { positions, groupLayouts, labelAnchors };
}

export function getCardStatsPositions(graph: GraphDataset): Point[] {
  return buildCardStatsLayout(graph).positions;
}
