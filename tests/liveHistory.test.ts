import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildGraphDataset } from "../src/data/graphBuilders";
import { parseAnalyticsTexts } from "../src/data/runParser";

const liveSavesDirectory =
  process.env.STS_SAVES_DIR ??
  path.join(
    process.env.APPDATA ?? "",
    "SlayTheSpire2",
    "steam",
    "76561199164980572",
    "profile1",
    "saves"
  );
const liveHistoryDirectory = path.join(liveSavesDirectory, "history");
const liveProgressPath = path.join(liveSavesDirectory, "progress.save");

const hasLiveData = existsSync(liveHistoryDirectory) && existsSync(liveProgressPath);

describe.skipIf(!hasLiveData)("live saves acceptance", () => {
  const fileNames = readdirSync(liveHistoryDirectory).filter((fileName) => fileName.endsWith(".run"));
  const loadResult = parseAnalyticsTexts([
    ...fileNames.map((fileName) => ({
      fileName,
      text: readFileSync(path.join(liveHistoryDirectory, fileName), "utf8"),
    })),
    {
      fileName: "progress.save",
      text: readFileSync(liveProgressPath, "utf8"),
    },
  ]);

  it("parses the current run history folder", () => {
    expect(loadResult.parsedFiles).toBe(102);
    expect(loadResult.runs.filter((run) => run.win).length).toBe(32);
    expect(new Set(loadResult.runs.map((run) => run.character)).size).toBe(5);
    expect(loadResult.progress).not.toBeNull();
  });

  it("matches the current top boss death count", () => {
    const graph = buildGraphDataset("bossDeaths", loadResult, { topN: 12, minSupport: 5 });

    expect(graph.ranking[0].label).toBe("Knowledge Demon");
    expect(graph.ranking[0].valueLabel).toBe("9 deaths");
  });

  it("matches the current qualifying top relics", () => {
    const graph = buildGraphDataset("relicWinRate", loadResult, { topN: 12, minSupport: 5 });

    const labels = graph.ranking.slice(0, 2).map((entry) => entry.label);
    expect(labels).toEqual(["Fragrant Mushroom", "Cloak Clasp"]);
    expect(graph.ranking[0].detail).toContain("5 completed runs");
  });

  it("matches the current profile overview leader", () => {
    const graph = buildGraphDataset("profileOverview", loadResult, { topN: 12, minSupport: 5 });

    expect(graph.ranking[0].label).toBe("Necrobinder");
    expect(graph.summaryCards[1].value).toBe("3279");
    expect(graph.summaryCards[2].value).toBe("18");
  });

  it("matches the current top card stat", () => {
    const graph = buildGraphDataset("cardStats", loadResult, { topN: 12, minSupport: 5 });

    expect(graph.ranking[0].label).toBe("Offering");
    expect(graph.ranking[0].valueLabel).toBe("100% win rate");
  });

  it("keeps encounter stats focused on non-boss fights", () => {
    const graph = buildGraphDataset("encounterStats", loadResult, { topN: 12, minSupport: 5 });

    expect(graph.ranking.length).toBeGreaterThan(0);
    expect(graph.ranking[0].valueLabel).toMatch(/losses$/);
    expect(graph.nodes.every((node) => !node.id.endsWith("_BOSS"))).toBe(true);
    expect(graph.nodes.every((node) => !node.id.endsWith("_EVENT_ENCOUNTER"))).toBe(true);
  });
});
