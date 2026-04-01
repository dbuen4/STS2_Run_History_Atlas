import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnalyticsTexts, parseManyRunTexts, parseRunJsonText } from "../src/data/runParser";
import { parseProgressJsonText } from "../src/data/progressParser";

const fixturesDir = path.join(__dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

describe("runParser", () => {
  it("parses a normal solo run and removes the starter relic", () => {
    const result = parseRunJsonText(readFixture("solo-win.run"), "solo-win.run");

    expect(result.runId).toBe("1001");
    expect(result.character).toBe("CHARACTER.NECROBINDER");
    expect(result.win).toBe(true);
    expect(result.wasAbandoned).toBe(false);
    expect(result.relicIdsExcludingStarter).toEqual([
      "RELIC.FRAGRANT_MUSHROOM",
      "RELIC.CLOAK_CLASP",
    ]);
  });

  it("only uses players[0] for co-op runs", () => {
    const result = parseRunJsonText(readFixture("coop-loss.run"), "coop-loss.run");

    expect(result.character).toBe("CHARACTER.SILENT");
    expect(result.relicIdsExcludingStarter).toEqual(["RELIC.ANCHOR", "RELIC.CLOAK_CLASP"]);
  });

  it("collects warnings and skip counts for malformed or incomplete files", () => {
    const result = parseManyRunTexts([
      { fileName: "solo-loss.run", text: readFixture("solo-loss.run") },
      { fileName: "missing-player.run", text: readFixture("missing-player.run") },
      { fileName: "malformed.run", text: readFixture("malformed.run") },
    ]);

    expect(result.parsedFiles).toBe(1);
    expect(result.skippedFiles).toBe(2);
    expect(result.progress).toBeNull();
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("missing-player.run");
    expect(result.warnings[1]).toContain("malformed.run");
  });
});

describe("progressParser", () => {
  it("parses progress.save profile aggregates", () => {
    const progress = parseProgressJsonText(readFixture("progress.save"));

    expect(progress.characterStats[0].id).toBe("CHARACTER.NECROBINDER");
    expect(progress.cardStats[0].id).toBe("CARD.OFFERING");
    expect(progress.encounterStats[0].encounterId).toBe("ENCOUNTER.KNOWLEDGE_DEMON_BOSS");
    expect(progress.totalPlaytime).toBe(7200);
  });

  it("loads run history and progress data together", () => {
    const result = parseAnalyticsTexts([
      { fileName: "solo-win.run", text: readFixture("solo-win.run") },
      { fileName: "solo-loss.run", text: readFixture("solo-loss.run") },
      { fileName: "progress.save", text: readFixture("progress.save") },
    ]);

    expect(result.parsedFiles).toBe(2);
    expect(result.skippedFiles).toBe(0);
    expect(result.progress?.characterStats).toHaveLength(4);
    expect(result.runs).toHaveLength(2);
  });
});
