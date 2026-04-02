import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CHARACTER_LEGEND, getCharacterColor } from "../src/characterPalette";
import { buildGraphDataset } from "../src/data/graphBuilders";
import { LEGEND_VISIBLE_COUNT, buildNodeLegend, paginateLegendEntries } from "../src/nodePalette";
import { parseAnalyticsTexts, parseRunJsonText } from "../src/data/runParser";
import { GraphBuildOptions, GraphDataset, LoadResult, RunSummary } from "../src/types";
import { computeLayoutRadius } from "../src/utils";

const fixturesDir = path.join(__dirname, "fixtures");
const defaultOptions: GraphBuildOptions = {
  topN: 12,
  minSupport: 2,
};

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function readRun(name: string): RunSummary {
  return parseRunJsonText(readFixture(name), name);
}

function build(
  view: GraphDataset["view"],
  loadResult: LoadResult,
  options: GraphBuildOptions = defaultOptions
): GraphDataset {
  return buildGraphDataset(view, loadResult, options);
}

describe("graphBuilders", () => {
  const runs = [
    readRun("solo-win.run"),
    readRun("solo-loss.run"),
    readRun("coop-loss.run"),
    readRun("abandoned.run"),
  ];
  const loadResult = parseAnalyticsTexts([
    { fileName: "solo-win.run", text: readFixture("solo-win.run") },
    { fileName: "solo-loss.run", text: readFixture("solo-loss.run") },
    { fileName: "coop-loss.run", text: readFixture("coop-loss.run") },
    { fileName: "abandoned.run", text: readFixture("abandoned.run") },
    { fileName: "progress.save", text: readFixture("progress.save") },
  ]);

  it("uses fixed character colors in profile overview", () => {
    const profileGraph = build("profileOverview", loadResult);
    const ironcladNode = profileGraph.nodes.find((node) => node.id === "CHARACTER.IRONCLAD");

    expect(ironcladNode?.color).toEqual(getCharacterColor("CHARACTER.IRONCLAD"));
  });

  it("assigns distinct graph colors to non-character nodes", () => {
    const graph = build("bossDeaths", loadResult, { topN: 5, minSupport: 2 });
    const nonCharacterNodes = graph.nodes.filter((node) => node.kind !== "character");
    const uniqueColors = new Set(nonCharacterNodes.map((node) => node.color.join(",")));

    expect(nonCharacterNodes.length).toBeGreaterThan(1);
    expect(uniqueColors.size).toBe(nonCharacterNodes.length);
  });

  it("builds a fixed profile overview legend from the main class palette", () => {
    const graph = build("profileOverview", loadResult);
    const legend = buildNodeLegend(graph);

    expect(legend).toHaveLength(CHARACTER_LEGEND.length);
    expect(legend.map((entry) => entry.label)).toEqual(CHARACTER_LEGEND.map((entry) => entry.label));
    expect(legend.map((entry) => entry.color)).toEqual(CHARACTER_LEGEND.map((entry) => entry.color));
  });

  it("builds ranked legends for non-profile views without character anchors", () => {
    const graph = build("bossDeaths", loadResult, { topN: 5, minSupport: 2 });
    const legend = buildNodeLegend(graph);

    expect(legend.map((entry) => entry.label)).toEqual(graph.ranking.map((entry) => entry.label));
    expect(legend.every((entry) => entry.kind !== "character")).toBe(true);
  });

  it("excludes auxiliary card stat nodes from the legend", () => {
    const graph = build("cardStats", loadResult, { topN: 5, minSupport: 2 });
    const legend = buildNodeLegend(graph);

    expect(legend.map((entry) => entry.label)).toEqual(graph.ranking.map((entry) => entry.label));
    expect(legend.some((entry) => entry.label === "Picked")).toBe(false);
    expect(legend.some((entry) => entry.label === "Skipped")).toBe(false);
    expect(legend.some((entry) => entry.label === "Won With")).toBe(false);
    expect(legend.some((entry) => entry.label === "Lost With")).toBe(false);
  });

  it("paginates legend entries in a sliding five-item window", () => {
    const entries = Array.from({ length: 7 }, (_, index) => ({
      id: `node-${index + 1}`,
      label: `Node ${index + 1}`,
      color: [index / 10, 0.2, 0.3, 1] as [number, number, number, number],
      kind: "boss" as const,
    }));

    const firstPage = paginateLegendEntries(entries, 0);
    expect(firstPage.entries).toHaveLength(LEGEND_VISIBLE_COUNT);
    expect(firstPage.entries[0]?.label).toBe("Node 1");
    expect(firstPage.entries.at(-1)?.label).toBe("Node 5");
    expect(firstPage.canMoveUp).toBe(false);
    expect(firstPage.canMoveDown).toBe(true);

    const shiftedPage = paginateLegendEntries(entries, 1);
    expect(shiftedPage.entries[0]?.label).toBe("Node 2");
    expect(shiftedPage.entries.at(-1)?.label).toBe("Node 6");
    expect(shiftedPage.canMoveUp).toBe(true);
    expect(shiftedPage.canMoveDown).toBe(true);

    const finalPage = paginateLegendEntries(entries, 99);
    expect(finalPage.offset).toBe(2);
    expect(finalPage.entries[0]?.label).toBe("Node 3");
    expect(finalPage.entries.at(-1)?.label).toBe("Node 7");
    expect(finalPage.canMoveDown).toBe(false);
  });

  it("computes larger layout radii for labeled non-character nodes", () => {
    const visibleRadius = 0.1;

    expect(computeLayoutRadius("Ironclad", "character", visibleRadius)).toBe(visibleRadius);
    expect(computeLayoutRadius("Win", "outcome", visibleRadius)).toBeCloseTo(
      Math.hypot(visibleRadius * 1.8, visibleRadius * 0.95)
    );
    expect(computeLayoutRadius("Knowledge Demon", "boss", visibleRadius)).toBeCloseTo(
      Math.hypot(visibleRadius * 2.2, visibleRadius * 1.5)
    );
    expect(computeLayoutRadius("Knowledge Demon Boss Elite", "encounter", visibleRadius)).toBeCloseTo(
      Math.hypot(visibleRadius * 2.2, visibleRadius * 2.05)
    );
  });

  it("builds boss death graphs with top encounters", () => {
    const graph = build("bossDeaths", loadResult, { topN: 5, minSupport: 2 });

    expect(graph.nodes.some((node) => node.label === "Knowledge Demon Boss")).toBe(true);
    expect(graph.nodes.some((node) => node.label === "Doormaker Boss")).toBe(true);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.every((node) => node.kind !== "character")).toBe(true);

    const bossNode = graph.nodes.find((node) => node.kind === "boss");

    expect(bossNode?.layoutRadius).toBeGreaterThan(bossNode?.radius ?? 0);
  });

  it("builds relic win-rate graphs with support filtering", () => {
    const graph = build("relicWinRate", loadResult, { topN: 5, minSupport: 2 });

    expect(graph.nodes.some((node) => node.label === "Cloak Clasp")).toBe(true);
    expect(graph.nodes.some((node) => node.label === "Fragrant Mushroom")).toBe(false);
    expect(graph.ranking[0].label).toBe("Cloak Clasp");
    expect(graph.ranking[0].valueLabel).toContain("50%");
    expect(graph.nodes.every((node) => node.kind !== "character")).toBe(true);

    const relicNode = graph.nodes.find((node) => node.kind === "relic");
    expect(relicNode?.layoutRadius).toBeGreaterThan(relicNode?.radius ?? 0);
  });

  it("builds profile overview graphs from progress.save", () => {
    const graph = build("profileOverview", loadResult);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(0);
    expect(graph.ranking[0].label).toBe("Necrobinder");
    expect(graph.summaryCards[0].value).toBe("2h 0m");
  });

  it("builds card stats graphs from progress.save", () => {
    const graph = build("cardStats", loadResult, { topN: 5, minSupport: 2 });

    expect(graph.ranking[0].label).toBe("Offering");
    expect(graph.ranking[0].valueLabel).toBe("100% win rate");
    expect(graph.nodes.some((node) => node.label === "Picked")).toBe(true);

    const statNode = graph.nodes.find((node) => node.kind === "stat");
    expect(statNode?.layoutRadius).toBeGreaterThan(statNode?.radius ?? 0);
  });

  it("builds encounter stats graphs from progress.save", () => {
    const graph = build("encounterStats", loadResult, { topN: 5, minSupport: 2 });

    expect(graph.ranking[0].label).toBe("Knowledge Demon Boss");
    expect(graph.ranking[0].valueLabel).toBe("3 losses");
    expect(graph.nodes.some((node) => node.label === "Doormaker Boss")).toBe(true);
    expect(graph.nodes.every((node) => node.kind !== "character")).toBe(true);

    const encounterNode = graph.nodes.find((node) => node.kind === "encounter");
    expect(encounterNode?.layoutRadius).toBeGreaterThan(encounterNode?.radius ?? 0);
  });

  it("returns a helpful warning when progress.save is missing", () => {
    const runOnlyLoad: LoadResult = {
      runs,
      progress: null,
      parsedFiles: runs.length,
      skippedFiles: 0,
      warnings: [],
    };

    const graph = build("profileOverview", runOnlyLoad);
    expect(graph.warnings[0]).toContain("No progress.save file was loaded");
    expect(graph.summaryCards[1].value).toBe("Missing");
  });

  it("returns a helpful warning when run history is missing for run-based graphs", () => {
    const progressOnlyLoad: LoadResult = {
      runs: [],
      progress: loadResult.progress,
      parsedFiles: 0,
      skippedFiles: 0,
      warnings: [],
    };

    const bossGraph = build("bossDeaths", progressOnlyLoad);
    const relicGraph = build("relicWinRate", progressOnlyLoad, { topN: 5, minSupport: 2 });

    expect(bossGraph.warnings[0]).toContain("No `.run` history files were loaded");
    expect(bossGraph.summaryCards[1].value).toBe("Loaded");
    expect(relicGraph.warnings[0]).toContain("No `.run` history files were loaded");
    expect(relicGraph.summaryCards[1].value).toBe("Loaded");
  });
});
