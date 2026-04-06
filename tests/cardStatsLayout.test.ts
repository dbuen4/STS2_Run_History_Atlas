import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  COLORLESS_CARD_STATS_GROUP_ID,
  getCardStatsGroupId,
  getCardStatsSectorGuides,
} from "../src/cardStatsSectors";
import { CHARACTER_LEGEND } from "../src/characterPalette";
import { buildGraphDataset } from "../src/data/graphBuilders";
import { parseAnalyticsTexts } from "../src/data/runParser";
import { buildCardStatsLayout } from "../src/rendering/cardStatsLayout";
import { GraphBuildOptions, LoadResult, ProgressCardStat } from "../src/types";

const fixturesDir = path.join(__dirname, "fixtures");
const defaultOptions: GraphBuildOptions = {
  topN: 12,
  minSupport: 2,
};

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), "utf8");
}

function angleDelta(left: number, right: number): number {
  const rawDelta = left - right;
  return Math.atan2(Math.sin(rawDelta), Math.cos(rawDelta));
}

const baseLoadResult = parseAnalyticsTexts([
  { fileName: "solo-win.run", text: readFixture("solo-win.run") },
  { fileName: "solo-loss.run", text: readFixture("solo-loss.run") },
  { fileName: "coop-loss.run", text: readFixture("coop-loss.run") },
  { fileName: "abandoned.run", text: readFixture("abandoned.run") },
  { fileName: "progress.save", text: readFixture("progress.save") },
]);

function buildCardGraph(cardStats: ProgressCardStat[], options: GraphBuildOptions = defaultOptions) {
  const loadResult: LoadResult = {
    runs: [],
    progress: {
      ...baseLoadResult.progress!,
      cardStats,
    },
    parsedFiles: 0,
    skippedFiles: 0,
    warnings: [],
  };

  return buildGraphDataset("cardStats", loadResult, options);
}

describe("cardStatsLayout", () => {
  it("maps cards into the expected class sector ids", () => {
    expect(getCardStatsGroupId("CARD.OFFERING")).toBe("CHARACTER.IRONCLAD");
    expect(getCardStatsGroupId("CARD.FEAR")).toBe("CHARACTER.NECROBINDER");
    expect(getCardStatsGroupId("CARD.FLASH_OF_STEEL")).toBe(COLORLESS_CARD_STATS_GROUP_ID);
  });

  it("keeps sector anchors in fixed character order, clockwise from the top", () => {
    const guides = getCardStatsSectorGuides();

    expect(guides.map((guide) => guide.id)).toEqual(CHARACTER_LEGEND.map((item) => item.id));
    expect(guides[0]?.angle).toBeCloseTo(-Math.PI / 2);
    for (let index = 1; index < guides.length; index += 1) {
      expect(guides[index].angle).toBeGreaterThan(guides[index - 1].angle);
    }
  });

  it("keeps colorless cards centered without overlapping", () => {
    const graph = buildCardGraph([
      { id: "CARD.FLASH_OF_STEEL", timesPicked: 10, timesSkipped: 0, timesWon: 7, timesLost: 3 },
      { id: "CARD.SECRET_WEAPON", timesPicked: 5, timesSkipped: 0, timesWon: 3, timesLost: 2 },
      { id: "CARD.THE_BOMB", timesPicked: 4, timesSkipped: 0, timesWon: 2, timesLost: 2 },
      { id: "CARD.OFFERING", timesPicked: 5, timesSkipped: 0, timesWon: 5, timesLost: 0 },
    ]);
    const layout = buildCardStatsLayout(graph);
    const colorlessGroup = layout.groupLayouts.find((group) => group.id === COLORLESS_CARD_STATS_GROUP_ID);

    expect(colorlessGroup).toBeTruthy();
    expect(colorlessGroup?.center.x).toBeCloseTo(0);
    expect(colorlessGroup?.center.y).toBeCloseTo(0);

    const nodeIndexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const colorlessIndices = colorlessGroup!.nodeIds.map((nodeId) => nodeIndexById.get(nodeId) as number);
    for (let leftIndex = 0; leftIndex < colorlessIndices.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < colorlessIndices.length; rightIndex += 1) {
        const leftNodeIndex = colorlessIndices[leftIndex];
        const rightNodeIndex = colorlessIndices[rightIndex];
        const leftPosition = layout.positions[leftNodeIndex];
        const rightPosition = layout.positions[rightNodeIndex];
        const minimumDistance =
          graph.nodes[leftNodeIndex].layoutRadius + graph.nodes[rightNodeIndex].layoutRadius;
        const actualDistance = Math.hypot(
          leftPosition.x - rightPosition.x,
          leftPosition.y - rightPosition.y
        );

        expect(actualDistance).toBeGreaterThan(minimumDistance * 0.98);
      }
    }
  });

  it("keeps populated sectors stable even when some characters are missing", () => {
    const graph = buildCardGraph(
      [
        { id: "CARD.OFFERING", timesPicked: 5, timesSkipped: 0, timesWon: 5, timesLost: 0 },
        { id: "CARD.PYRE", timesPicked: 4, timesSkipped: 0, timesWon: 3, timesLost: 1 },
        { id: "CARD.ACROBATICS", timesPicked: 5, timesSkipped: 0, timesWon: 3, timesLost: 2 },
      ],
      { topN: 6, minSupport: 2 }
    );
    const layout = buildCardStatsLayout(graph);
    const guideById = new Map(getCardStatsSectorGuides().map((guide) => [guide.id, guide]));
    const ironcladGroup = layout.groupLayouts.find((group) => group.id === "CHARACTER.IRONCLAD");
    const silentGroup = layout.groupLayouts.find((group) => group.id === "CHARACTER.SILENT");

    expect(ironcladGroup).toBeTruthy();
    expect(silentGroup).toBeTruthy();
    expect(layout.groupLayouts.some((group) => group.id === "CHARACTER.DEFECT")).toBe(false);

    const ironcladAngle = Math.atan2(ironcladGroup!.center.y, ironcladGroup!.center.x);
    const silentAngle = Math.atan2(silentGroup!.center.y, silentGroup!.center.x);
    expect(Math.abs(angleDelta(ironcladAngle, guideById.get("CHARACTER.IRONCLAD")!.angle))).toBeLessThan(0.001);
    expect(Math.abs(angleDelta(silentAngle, guideById.get("CHARACTER.SILENT")!.angle))).toBeLessThan(0.001);
  });
});
