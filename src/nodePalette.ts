import { CHARACTER_LEGEND, getCharacterColor, RgbaColor } from "./characterPalette";
import { GraphDataset, GraphNode } from "./types";

export interface NodeLegendItem {
  id: string;
  label: string;
  color: RgbaColor;
  kind: GraphNode["kind"];
}

export interface PaginatedLegend {
  entries: NodeLegendItem[];
  offset: number;
  total: number;
  startIndex: number;
  endIndex: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export const LEGEND_VISIBLE_COUNT = 5;

const RUN_SCATTER_LEGEND: NodeLegendItem[] = [
  {
    id: "run-scatter-win",
    label: "Wins",
    color: [0.2, 0.52, 0.42, 1],
    kind: "stat",
  },
  {
    id: "run-scatter-loss",
    label: "Losses",
    color: [0.76, 0.27, 0.22, 1],
    kind: "stat",
  },
  {
    id: "run-scatter-abandoned",
    label: "Abandoned",
    color: [0.45, 0.44, 0.44, 1],
    kind: "stat",
  },
];

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function hslToRgba(hue: number, saturation: number, lightness: number): RgbaColor {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = normalizedHue / 60;
  const secondComponent = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = secondComponent;
  } else if (huePrime < 2) {
    red = secondComponent;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondComponent;
  } else if (huePrime < 4) {
    green = secondComponent;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondComponent;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondComponent;
  }

  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match, 1];
}

function getDynamicNodeColor(node: GraphNode, index: number): RgbaColor {
  if (node.kind === "character") {
    return getCharacterColor(node.id, node.color);
  }

  const hash = hashString(`${node.id}:${node.label}:${node.kind}:${index}`);
  const hue = (hash % 360 + index * 41) % 360;
  const saturation = 0.62 + ((hash >>> 9) % 12) / 100;
  const lightness = 0.47 + ((hash >>> 17) % 10) / 100;
  return hslToRgba(hue, saturation, lightness);
}

export function assignGraphNodeColors(graph: GraphDataset): GraphDataset {
  if (graph.view === "runScatter") {
    return graph;
  }

  const nodes = graph.nodes.map((node, index) => ({
    ...node,
    color: getDynamicNodeColor(node, index),
  }));

  return {
    ...graph,
    nodes,
  };
}

export function buildNodeLegend(graph: GraphDataset): NodeLegendItem[] {
  if (graph.view === "profileOverview") {
    return CHARACTER_LEGEND.map((item) => ({
      id: item.id,
      label: item.label,
      color: item.color,
      kind: "character" as const,
    }));
  }

  if (graph.view === "runScatter") {
    return RUN_SCATTER_LEGEND;
  }

  const nodeById = new Map(
    graph.nodes
      .filter((node) => node.kind !== "character")
      .map((node) => [node.id, node] as const)
  );

  return graph.ranking.flatMap((entry) => {
    const node = nodeById.get(entry.id);
    if (!node) {
      return [];
    }

    return [
      {
        id: entry.id,
        label: entry.label,
        color: node.color,
        kind: node.kind,
      },
    ];
  });
}

export function paginateLegendEntries(
  entries: NodeLegendItem[],
  offset: number,
  visibleCount: number = LEGEND_VISIBLE_COUNT
): PaginatedLegend {
  const safeVisibleCount = Math.max(1, Math.floor(visibleCount));
  const maxOffset = Math.max(entries.length - safeVisibleCount, 0);
  const safeOffset = Math.max(0, Math.min(Math.floor(offset), maxOffset));
  const visibleEntries = entries.slice(safeOffset, safeOffset + safeVisibleCount);
  const endIndex = safeOffset + visibleEntries.length;

  return {
    entries: visibleEntries,
    offset: safeOffset,
    total: entries.length,
    startIndex: safeOffset,
    endIndex,
    canMoveUp: safeOffset > 0,
    canMoveDown: endIndex < entries.length,
  };
}
