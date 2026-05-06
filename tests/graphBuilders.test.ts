import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getBossImageUrl } from "../src/bossImageCatalog";
import { getCardPool } from "../src/cardClassCatalog";
import { getCardImageUrl } from "../src/cardImageCatalog";
import { CHARACTER_LEGEND, getCharacterColor } from "../src/characterPalette";
import { buildGraphDataset } from "../src/data/graphBuilders";
import { getEncounterImageUrl } from "../src/encounterImageCatalog";
import { LEGEND_VISIBLE_COUNT, buildNodeLegend, paginateLegendEntries } from "../src/nodePalette";
import { getRelicImageUrl } from "../src/relicImageCatalog";
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
  const encounterGraphLoad: LoadResult = {
    runs: [],
    progress: {
      ...loadResult.progress!,
      encounterStats: [
        {
          encounterId: "ENCOUNTER.NIBBITS_WEAK",
          fightStats: [{ character: "CHARACTER.NECROBINDER", wins: 5, losses: 3 }],
        },
        {
          encounterId: "ENCOUNTER.ENTOMANCER_ELITE",
          fightStats: [{ character: "CHARACTER.IRONCLAD", wins: 7, losses: 2 }],
        },
        {
          encounterId: "ENCOUNTER.KNOWLEDGE_DEMON_BOSS",
          fightStats: [{ character: "CHARACTER.NECROBINDER", wins: 0, losses: 9 }],
        },
        {
          encounterId: "ENCOUNTER.BATTLEWORN_DUMMY_EVENT_ENCOUNTER",
          fightStats: [{ character: "CHARACTER.SILENT", wins: 0, losses: 1 }],
        },
      ],
    },
    parsedFiles: 0,
    skippedFiles: 0,
    warnings: [],
  };
  const cardClusterLoad: LoadResult = {
    runs: [],
    progress: {
      ...loadResult.progress!,
      cardStats: [
        { id: "CARD.OFFERING", timesPicked: 5, timesSkipped: 0, timesWon: 5, timesLost: 0 },
        { id: "CARD.PYRE", timesPicked: 5, timesSkipped: 0, timesWon: 4, timesLost: 1 },
        { id: "CARD.FEAR", timesPicked: 4, timesSkipped: 0, timesWon: 3, timesLost: 1 },
        { id: "CARD.FLASH_OF_STEEL", timesPicked: 10, timesSkipped: 0, timesWon: 7, timesLost: 3 },
        { id: "CARD.SECRET_WEAPON", timesPicked: 5, timesSkipped: 0, timesWon: 3, timesLost: 2 },
      ],
    },
    parsedFiles: 0,
    skippedFiles: 0,
    warnings: [],
  };
  const scatterRuns: RunSummary[] = [
    {
      runId: "scatter-1",
      sourceName: "scatter-1.run",
      character: "CHARACTER.IRONCLAD",
      win: true,
      wasAbandoned: false,
      killedByEncounter: "NONE.NONE",
      relicIdsExcludingStarter: [],
      floorsClimbed: 10,
      elitesEncountered: 1,
      overallEncounters: 5,
      restSitesVisited: 1,
      maxHealth: 70,
    },
    {
      runId: "scatter-2",
      sourceName: "scatter-2.run",
      character: "CHARACTER.SILENT",
      win: false,
      wasAbandoned: false,
      killedByEncounter: "ENCOUNTER.NIBBITS_WEAK",
      relicIdsExcludingStarter: [],
      floorsClimbed: 18,
      elitesEncountered: 2,
      overallEncounters: 8,
      restSitesVisited: 2,
      maxHealth: 78,
    },
    {
      runId: "scatter-3",
      sourceName: "scatter-3.run",
      character: "CHARACTER.DEFECT",
      win: false,
      wasAbandoned: true,
      killedByEncounter: "NONE.NONE",
      relicIdsExcludingStarter: [],
      floorsClimbed: 6,
      elitesEncountered: 0,
      overallEncounters: 3,
      restSitesVisited: 1,
      maxHealth: 66,
    },
    {
      runId: "scatter-4",
      sourceName: "scatter-4.run",
      character: "CHARACTER.NECROBINDER",
      win: true,
      wasAbandoned: false,
      killedByEncounter: "NONE.NONE",
      relicIdsExcludingStarter: [],
      floorsClimbed: 24,
      elitesEncountered: 4,
      overallEncounters: 11,
      restSitesVisited: 3,
      maxHealth: 92,
    },
  ];
  const scatterGraphLoad: LoadResult = {
    runs: scatterRuns,
    progress: null,
    parsedFiles: scatterRuns.length,
    skippedFiles: 0,
    warnings: [],
  };

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

  it("keeps the card-stats legend aligned with the ranked cards", () => {
    const graph = build("cardStats", loadResult, { topN: 5, minSupport: 2 });
    const legend = buildNodeLegend(graph);

    expect(legend.map((entry) => entry.label)).toEqual(graph.ranking.map((entry) => entry.label));
    expect(legend.every((entry) => entry.kind === "card")).toBe(true);
  });

  it("builds a fixed outcome legend for the run scatter plot", () => {
    const graph = build("runScatter", scatterGraphLoad, {
      topN: 5,
      minSupport: 2,
      scatterXMetric: "floorsClimbed",
      scatterYMetric: "elitesEncountered",
    });
    const legend = buildNodeLegend(graph);

    expect(legend.map((entry) => entry.label)).toEqual(["Wins", "Losses", "Abandoned"]);
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

    expect(graph.nodes.some((node) => node.label === "Knowledge Demon")).toBe(true);
    expect(graph.nodes.some((node) => node.label === "Doormaker")).toBe(true);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.every((node) => node.kind !== "character")).toBe(true);
    expect(graph.ranking.every((entry) => !entry.label.endsWith(" Boss"))).toBe(true);

    const bossNode = graph.nodes.find((node) => node.kind === "boss");

    expect(bossNode?.layoutRadius).toBeGreaterThan(bossNode?.radius ?? 0);
  });

  it("adds local boss images for known boss encounters", () => {
    const graph = build("bossDeaths", loadResult, { topN: 5, minSupport: 2 });
    const knowledgeDemonNode = graph.nodes.find((node) => node.id === "ENCOUNTER.KNOWLEDGE_DEMON_BOSS");
    const doormakerNode = graph.nodes.find((node) => node.id === "ENCOUNTER.DOORMAKER_BOSS");

    expect(getBossImageUrl("ENCOUNTER.KNOWLEDGE_DEMON_BOSS")).toBeTruthy();
    expect(knowledgeDemonNode?.imageUrl).toBeTruthy();
    expect(doormakerNode?.imageUrl).toBeTruthy();
  });

  it("excludes non-boss encounters from boss death graphs", () => {
    const eliteOnlyLoad: LoadResult = {
      runs: [
        {
          runId: "elite-loss-1",
          sourceName: "elite-loss-1.run",
          character: "CHARACTER.IRONCLAD",
          win: false,
          wasAbandoned: false,
          killedByEncounter: "ENCOUNTER.NIBBITS_WEAK",
          relicIdsExcludingStarter: [],
          floorsClimbed: 0,
          elitesEncountered: 0,
          overallEncounters: 0,
          restSitesVisited: 0,
          maxHealth: 0,
        },
        {
          runId: "boss-loss-1",
          sourceName: "boss-loss-1.run",
          character: "CHARACTER.SILENT",
          win: false,
          wasAbandoned: false,
          killedByEncounter: "ENCOUNTER.KNOWLEDGE_DEMON_BOSS",
          relicIdsExcludingStarter: [],
          floorsClimbed: 0,
          elitesEncountered: 0,
          overallEncounters: 0,
          restSitesVisited: 0,
          maxHealth: 0,
        },
      ],
      progress: null,
      parsedFiles: 2,
      skippedFiles: 0,
      warnings: [],
    };

    const graph = build("bossDeaths", eliteOnlyLoad, { topN: 5, minSupport: 2 });

    expect(graph.nodes.map((node) => node.id)).toEqual(["ENCOUNTER.KNOWLEDGE_DEMON_BOSS"]);
    expect(graph.ranking.map((entry) => entry.id)).toEqual(["ENCOUNTER.KNOWLEDGE_DEMON_BOSS"]);
  });

  it("maps Kaiser Crab to a local boss image", () => {
    const kaiserCrabLoad: LoadResult = {
      runs: [
        {
          runId: "kaiser-loss-1",
          sourceName: "kaiser-loss-1.run",
          character: "CHARACTER.IRONCLAD",
          win: false,
          wasAbandoned: false,
          killedByEncounter: "ENCOUNTER.KAISER_CRAB_BOSS",
          relicIdsExcludingStarter: [],
          floorsClimbed: 0,
          elitesEncountered: 0,
          overallEncounters: 0,
          restSitesVisited: 0,
          maxHealth: 0,
        },
        {
          runId: "kaiser-loss-2",
          sourceName: "kaiser-loss-2.run",
          character: "CHARACTER.SILENT",
          win: false,
          wasAbandoned: false,
          killedByEncounter: "ENCOUNTER.KAISER_CRAB_BOSS",
          relicIdsExcludingStarter: [],
          floorsClimbed: 0,
          elitesEncountered: 0,
          overallEncounters: 0,
          restSitesVisited: 0,
          maxHealth: 0,
        },
      ],
      progress: null,
      parsedFiles: 2,
      skippedFiles: 0,
      warnings: [],
    };

    const graph = build("bossDeaths", kaiserCrabLoad, { topN: 5, minSupport: 2 });
    const kaiserNode = graph.nodes.find((node) => node.id === "ENCOUNTER.KAISER_CRAB_BOSS");

    expect(getBossImageUrl("ENCOUNTER.KAISER_CRAB_BOSS")).toBeTruthy();
    expect(kaiserNode?.imageUrl).toBeTruthy();
    expect(graph.summaryCards.some((card) => card.label === "Kaiser Crab")).toBe(false);
    expect(graph.warnings).toHaveLength(0);
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

  it("adds local relic images for known relics", () => {
    const graph = build("relicWinRate", loadResult, { topN: 5, minSupport: 2 });
    const cloakClaspNode = graph.nodes.find((node) => node.id === "RELIC.CLOAK_CLASP");

    expect(getRelicImageUrl("RELIC.CLOAK_CLASP")).toBeTruthy();
    expect(cloakClaspNode?.imageUrl).toBeTruthy();
  });

  it("maps fake relic ids to local relic images", () => {
    expect(getRelicImageUrl("RELIC.FAKE_BLOOD_VIAL")).toBe(getRelicImageUrl("RELIC.BLOOD_VIAL"));
    expect(getRelicImageUrl("RELIC.FAKE_MERCHANTS_RUG")).toBeTruthy();
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
    expect(graph.nodes).toHaveLength(graph.ranking.length);
    expect(graph.edges).toHaveLength(0);
    expect(graph.showEdges).toBe(false);
    expect(graph.nodes.every((node) => node.kind === "card")).toBe(true);

    const cardNode = graph.nodes.find((node) => node.id === "CARD.OFFERING");
    expect(cardNode?.layoutRadius).toBeGreaterThan(cardNode?.radius ?? 0);
  });

  it("adds local card images for known cards", () => {
    const graph = build("cardStats", loadResult, { topN: 5, minSupport: 2 });
    const offeringNode = graph.nodes.find((node) => node.id === "CARD.OFFERING");

    expect(getCardImageUrl("CARD.OFFERING")).toBeTruthy();
    expect(offeringNode?.imageUrl).toBeTruthy();
  });

  it("keeps card stats as a card-only graph without class spokes", () => {
    const graph = build("cardStats", cardClusterLoad, { topN: 5, minSupport: 2 });

    expect(graph.showEdges).toBe(false);
    expect(getCardPool("CARD.OFFERING")).toBe("ironclad");
    expect(getCardPool("CARD.FLASH_OF_STEEL")).toBe("colorless");
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.every((node) => node.kind === "card")).toBe(true);
  });

  it("builds encounter stats graphs from normal and elite encounters only", () => {
    const graph = build("encounterStats", encounterGraphLoad, { topN: 5, minSupport: 2 });

    expect(graph.ranking.map((entry) => entry.id)).toEqual([
      "ENCOUNTER.NIBBITS_WEAK",
      "ENCOUNTER.ENTOMANCER_ELITE",
    ]);
    expect(graph.ranking[0].label).toBe("Nibbits Weak");
    expect(graph.ranking[0].valueLabel).toBe("3 losses");
    expect(graph.nodes.every((node) => node.kind !== "character")).toBe(true);
    expect(graph.nodes.every((node) => !node.id.endsWith("_BOSS"))).toBe(true);
    expect(graph.nodes.every((node) => !node.id.endsWith("_EVENT_ENCOUNTER"))).toBe(true);
    expect(graph.summaryCards[3].value).toBe("Nibbits Weak");

    const encounterNode = graph.nodes.find((node) => node.kind === "encounter");
    expect(encounterNode?.layoutRadius).toBeGreaterThan(encounterNode?.radius ?? 0);
  });

  it("builds a flexible run scatter graph from per-run metrics", () => {
    const graph = build("runScatter", scatterGraphLoad, {
      topN: 5,
      minSupport: 2,
      scatterXMetric: "floorsClimbed",
      scatterYMetric: "elitesEncountered",
    });

    expect(graph.nodes).toHaveLength(scatterRuns.length);
    expect(graph.edges).toHaveLength(0);
    expect(graph.fixedPositions).toHaveLength(scatterRuns.length);
    expect(graph.scatterPlot?.xAxis.label).toBe("Floors Climbed");
    expect(graph.scatterPlot?.yAxis.label).toBe("Elites Encountered");
    expect(graph.summaryCards[0].value).toBe("4");
    expect(graph.summaryCards[3].value).toContain("r =");
    expect(graph.ranking[0].label).toContain("Necrobinder");
    expect(graph.ranking[0].valueLabel).toBe("Elites Encountered: 4");
    expect(graph.warnings).toHaveLength(0);
    expect(graph.nodes[0]?.color).toEqual([0.2, 0.52, 0.42, 1]);
    expect(graph.nodes[1]?.color).toEqual([0.76, 0.27, 0.22, 1]);
    expect(graph.nodes[2]?.color).toEqual([0.45, 0.44, 0.44, 1]);
  });

  it("adds encounter images for known normal and elite encounters", () => {
    const graph = build("encounterStats", encounterGraphLoad, { topN: 5, minSupport: 2 });
    const nibbitsNode = graph.nodes.find((node) => node.id === "ENCOUNTER.NIBBITS_WEAK");
    const entomancerNode = graph.nodes.find((node) => node.id === "ENCOUNTER.ENTOMANCER_ELITE");

    expect(getEncounterImageUrl("ENCOUNTER.NIBBITS_WEAK")).toBeTruthy();
    expect(getEncounterImageUrl("ENCOUNTER.ENTOMANCER_ELITE")).toBeTruthy();
    expect(nibbitsNode?.imageUrl).toBeTruthy();
    expect(entomancerNode?.imageUrl).toBeTruthy();
  });

  it("maps the remaining missing normal encounter art", () => {
    expect(getEncounterImageUrl("ENCOUNTER.SLITHERING_STRANGLER_NORMAL")).toContain("StS2_Slithering_Strangler");
    expect(getEncounterImageUrl("ENCOUNTER.THE_LOST_AND_FORGOTTEN_NORMAL")).toContain("StS2_The_Lost");
    expect(getEncounterImageUrl("ENCOUNTER.TURRET_OPERATOR_WEAK")).toContain("StS2_Turret_Operator");
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
