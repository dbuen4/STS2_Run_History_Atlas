import {
  GraphBuildOptions,
  GraphDataset,
  GraphEdge,
  GraphNode,
  GraphView,
  LoadResult,
  ProgressCardStat,
  ProgressCharacterStat,
  ProgressEncounterStat,
  RankingEntry,
  RunSummary,
  ScatterMetricId,
} from "../types";
import { getBossImageUrl, isBossEncounterId } from "../bossImageCatalog";
import { getCardStatsCharacterIdForPool } from "../cardStatsSectors";
import { getCardPool } from "../cardClassCatalog";
import { getCardImageUrl } from "../cardImageCatalog";
import {
  DEFAULT_SCATTER_X_METRIC,
  DEFAULT_SCATTER_Y_METRIC,
  getScatterMetricDefinition,
} from "./runScatterMetrics";
import { getEncounterImageUrl } from "../encounterImageCatalog";
import { getRelicImageUrl } from "../relicImageCatalog";
import { assignGraphNodeColors } from "../nodePalette";
import {
  computeLayoutRadius,
  formatPercent,
  formatSecondsAsDuration,
  humanizeToken,
  sortByNumberThenLabel,
  squareRootRadius,
} from "../utils";
import { getCharacterColor, getCharacterImageUrl } from "../characterPalette";

const COLORS = {
  characterLow: [0.67, 0.43, 0.28, 1] as [number, number, number, number],
  characterHigh: [0.18, 0.49, 0.41, 1] as [number, number, number, number],
  win: [0.2, 0.52, 0.42, 1] as [number, number, number, number],
  loss: [0.76, 0.27, 0.22, 1] as [number, number, number, number],
  abandoned: [0.45, 0.44, 0.44, 1] as [number, number, number, number],
  boss: [0.65, 0.33, 0.2, 1] as [number, number, number, number],
  relic: [0.2, 0.38, 0.65, 1] as [number, number, number, number],
  card: [0.55, 0.3, 0.15, 1] as [number, number, number, number],
  encounter: [0.61, 0.23, 0.2, 1] as [number, number, number, number],
};

const COLORLESS_EDGE_COLOR: [number, number, number, number] = [0.62, 0.62, 0.62, 1];

interface RelicStat {
  id: string;
  support: number;
  wins: number;
  winRate: number;
  firstSeenIndex: number;
  winningCharacterCounts: Map<string, number>;
}

interface CardAggregate {
  id: string;
  support: number;
  winRate: number;
  picked: number;
  skipped: number;
  wins: number;
  losses: number;
}

interface EncounterAggregate {
  id: string;
  wins: number;
  losses: number;
  lossRate: number;
  characterLosses: Map<string, number>;
}

function blendColor(
  start: [number, number, number, number],
  end: [number, number, number, number],
  amount: number
): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, amount));
  return [
    start[0] + (end[0] - start[0]) * clamped,
    start[1] + (end[1] - start[1]) * clamped,
    start[2] + (end[2] - start[2]) * clamped,
    1,
  ];
}

function addEdge(
  edgeMap: Map<string, GraphEdge>,
  sourceId: string,
  targetId: string,
  weight: number,
  color?: [number, number, number, number]
): void {
  if (weight <= 0) {
    return;
  }

  edgeMap.set(`${sourceId}::${targetId}`, { sourceId, targetId, weight, color });
}

function withLayoutRadius(node: Omit<GraphNode, "layoutRadius">): GraphNode {
  return {
    ...node,
    layoutRadius: computeLayoutRadius(node.label, node.kind, node.radius),
  };
}

function makeCountNode(
  id: string,
  label: string,
  kind: GraphNode["kind"],
  count: number,
  maxCount: number,
  color: [number, number, number, number],
  minRadius: number = 0.12,
  maxRadius: number = 0.28
): GraphNode {
  const radius = squareRootRadius(count, maxCount || 1, minRadius, maxRadius);
  return withLayoutRadius({
    id,
    label,
    kind,
    value: count,
    radius,
    color,
  });
}

function formatEncounterLabel(encounterId: string): string {
  const label = humanizeToken(encounterId);
  return isBossEncounterId(encounterId) ? label.replace(/ Boss$/, "") : label;
}

function isTrackedEncounterStatsId(encounterId: string): boolean {
  return !isBossEncounterId(encounterId) && !encounterId.endsWith("_EVENT_ENCOUNTER");
}

function makeMissingProgressGraph(view: GraphView, runCount: number): GraphDataset {
  const viewMeta: Record<
    Extract<GraphView, "profileOverview" | "cardStats" | "encounterStats">,
    { title: string; subtitle: string }
  > =
    {
      profileOverview: {
        title: "Profile Overview",
        subtitle:
          "Load the profile saves folder that contains progress.save to unlock profile-wide overview graphs.",
      },
      cardStats: {
        title: "Card Stats",
        subtitle:
          "Card effectiveness uses progress.save aggregates, including the five class sectors and centered Colorless grouping.",
      },
      encounterStats: {
        title: "Encounter Stats",
        subtitle:
          "Encounter aggregates come from progress.save and focus on normal and elite fights rather than bosses.",
      },
    };

  const meta = viewMeta[view as keyof typeof viewMeta];
  return {
    view,
    title: meta.title,
    subtitle: meta.subtitle,
    nodes: [],
    edges: [],
    ranking: [],
    summaryCards: [
      { label: "Parsed Runs", value: String(runCount) },
      { label: "Progress File", value: "Missing" },
      { label: "Action", value: "Load Saves Folder" },
      { label: "Views Locked", value: "3" },
    ],
    warnings: [
      "No progress.save file was loaded. Select the profile saves folder to enable Profile Overview, Card Stats, and Encounter Stats.",
    ],
  };
}

function makeMissingRunGraph(
  view: Extract<GraphView, "bossDeaths" | "relicWinRate" | "runScatter">,
  hasProgress: boolean
): GraphDataset {
  const viewMeta: Record<
    Extract<GraphView, "bossDeaths" | "relicWinRate" | "runScatter">,
    { title: string; subtitle: string }
  > = {
    bossDeaths: {
      title: "Boss Deaths",
      subtitle:
        "Boss Deaths needs `.run` history files so it can count which boss encounters actually ended your runs.",
    },
    relicWinRate: {
      title: "Relic Win Rate",
      subtitle:
        "Relic Win Rate is built from completed `.run` history files, not from progress.save alone.",
    },
    runScatter: {
      title: "Run Scatter Plot",
      subtitle:
        "Run Scatter Plot needs `.run` history files so it can compare per-run values like floors climbed, elites, rests, and max health.",
    },
  };

  const meta = viewMeta[view];
  return {
    view,
    title: meta.title,
    subtitle: meta.subtitle,
    nodes: [],
    edges: [],
    ranking: [],
    summaryCards: [
      { label: "Parsed Runs", value: "0" },
      { label: "progress.save", value: hasProgress ? "Loaded" : "Missing" },
      { label: "Action", value: "Load History Files" },
      { label: "Views Locked", value: "3" },
    ],
    warnings: [
      "No `.run` history files were loaded. Boss Deaths, Relic Win Rate, and Run Scatter Plot all require the `history` folder.",
    ],
  };
}

function formatScatterMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function getRunOutcomeLabel(run: RunSummary): string {
  if (run.wasAbandoned) {
    return "Abandoned";
  }

  return run.win ? "Win" : "Loss";
}

function getRunOutcomeColor(run: RunSummary): [number, number, number, number] {
  if (run.wasAbandoned) {
    return COLORS.abandoned;
  }

  return run.win ? COLORS.win : COLORS.loss;
}

function scaleScatterValue(
  value: number,
  minValue: number,
  maxValue: number,
  minWorld: number,
  maxWorld: number
): number {
  if (Math.abs(maxValue - minValue) < 0.0001) {
    return (minWorld + maxWorld) / 2;
  }

  const normalized = (value - minValue) / (maxValue - minValue);
  return minWorld + normalized * (maxWorld - minWorld);
}

function computePearsonCorrelation(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 2) {
    return null;
  }

  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;

  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (const point of points) {
    const deltaX = point.x - meanX;
    const deltaY = point.y - meanY;
    numerator += deltaX * deltaY;
    xVariance += deltaX * deltaX;
    yVariance += deltaY * deltaY;
  }

  if (xVariance <= 0.0000001 || yVariance <= 0.0000001) {
    return null;
  }

  return numerator / Math.sqrt(xVariance * yVariance);
}

function buildBossGraph(runs: RunSummary[], topN: number, hasProgress: boolean): GraphDataset {
  if (runs.length === 0) {
    return makeMissingRunGraph("bossDeaths", hasProgress);
  }

  const deathRuns = runs.filter(
    (run) =>
      run.killedByEncounter !== null &&
      run.killedByEncounter !== "NONE.NONE" &&
      isBossEncounterId(run.killedByEncounter)
  );
  const bossCounts = new Map<string, number>();

  for (const run of deathRuns) {
    const encounter = run.killedByEncounter as string;
    bossCounts.set(encounter, (bossCounts.get(encounter) ?? 0) + 1);
  }

  const rankedBosses = sortByNumberThenLabel(
    [...bossCounts.entries()].map(([encounter, count]) => ({ encounter, count })),
    (entry) => entry.count,
    (entry) => entry.encounter
  ).slice(0, topN);
  const selectedBosses = new Set(rankedBosses.map((entry) => entry.encounter));
  const maxBossCount = Math.max(...rankedBosses.map((entry) => entry.count), 1);

  const bossNodes = rankedBosses.map((entry) =>
    makeCountNode(
      entry.encounter,
      formatEncounterLabel(entry.encounter),
      "boss",
      entry.count,
      maxBossCount,
      COLORS.boss,
      0.12,
      0.28
    )
  );
  bossNodes.forEach((node) => {
    node.imageUrl = getBossImageUrl(node.id);
  });

  const ranking: RankingEntry[] = rankedBosses.map((entry) => ({
    id: entry.encounter,
    label: formatEncounterLabel(entry.encounter),
    valueLabel: `${entry.count} death${entry.count === 1 ? "" : "s"}`,
    detail: "Counted from non-winning runs where this encounter finished the run.",
  }));

  const summaryCards = [
    { label: "Fatal Runs", value: String(deathRuns.length) },
    { label: "Unique Bosses", value: String(bossCounts.size) },
    { label: "Shown Bosses", value: String(rankedBosses.length) },
    {
      label: "Top Threat",
      value: rankedBosses[0] ? formatEncounterLabel(rankedBosses[0].encounter) : "None",
    },
  ];

  const warnings: string[] = [];
  if (rankedBosses.length === 0) {
    warnings.push("No boss deaths were found in the parsed runs.");
  }

  return {
    view: "bossDeaths",
    title: "Boss Deaths",
    subtitle:
      "Boss nodes grow with total deaths and focus on the true boss encounters that most often ended a run.",
    nodes: bossNodes,
    edges: [],
    ranking,
    summaryCards,
    warnings,
  };
}

function getRelicStats(runs: RunSummary[]): RelicStat[] {
  const completedRuns = runs.filter((run) => !run.wasAbandoned);
  const relicMap = new Map<string, RelicStat>();
  let seenCounter = 0;

  for (const run of completedRuns) {
    for (const relicId of run.relicIdsExcludingStarter) {
      const current = relicMap.get(relicId) ?? {
        id: relicId,
        support: 0,
        wins: 0,
        winRate: 0,
        firstSeenIndex: seenCounter,
        winningCharacterCounts: new Map<string, number>(),
      };

      if (!relicMap.has(relicId)) {
        seenCounter += 1;
      }

      current.support += 1;
      if (run.win) {
        current.wins += 1;
        current.winningCharacterCounts.set(
          run.character,
          (current.winningCharacterCounts.get(run.character) ?? 0) + 1
        );
      }

      relicMap.set(relicId, current);
    }
  }

  return [...relicMap.values()].map((stat) => ({
    ...stat,
    winRate: stat.support > 0 ? stat.wins / stat.support : 0,
  }));
}

function buildRelicGraph(
  runs: RunSummary[],
  topN: number,
  minSupport: number,
  hasProgress: boolean
): GraphDataset {
  if (runs.length === 0) {
    return makeMissingRunGraph("relicWinRate", hasProgress);
  }

  const relicStats = getRelicStats(runs);
  const filteredStats = relicStats.filter((stat) => stat.support >= minSupport);
  const rankedRelics = [...filteredStats]
    .sort((left, right) => {
      const winRateDifference = right.winRate - left.winRate;
      if (Math.abs(winRateDifference) > 0.0001) {
        return winRateDifference;
      }

      const supportDifference = right.support - left.support;
      if (supportDifference !== 0) {
        return supportDifference;
      }

      return left.firstSeenIndex - right.firstSeenIndex;
    })
    .slice(0, topN);

  const maxRelicWinRate = Math.max(...rankedRelics.map((entry) => entry.winRate), 0.01);
  const completedRuns = runs.filter((run) => !run.wasAbandoned);
  const relicNodes = rankedRelics.map((stat) =>
    withLayoutRadius({
      id: stat.id,
      label: humanizeToken(stat.id),
      kind: "relic" as const,
      value: stat.winRate,
      secondaryValue: stat.support,
      radius: squareRootRadius(stat.winRate, maxRelicWinRate, 0.12, 0.28),
      color: COLORS.relic,
      imageUrl: getRelicImageUrl(stat.id),
    })
  );

  const edgeMap = new Map<string, GraphEdge>();
  for (const stat of rankedRelics) {
    for (const [character, wins] of stat.winningCharacterCounts) {
      addEdge(edgeMap, character, stat.id, wins);
    }
  }

  const ranking: RankingEntry[] = rankedRelics.map((stat) => ({
    id: stat.id,
    label: humanizeToken(stat.id),
    valueLabel: `${formatPercent(stat.winRate)} win rate`,
    detail: `${stat.wins} wins across ${stat.support} completed runs with this relic`,
  }));

  const warnings: string[] = [];
  if (rankedRelics.length === 0) {
    warnings.push(`No relics met the minimum support threshold of ${minSupport}.`);
  }

  return {
    view: "relicWinRate",
    title: "Relic Win Rate",
    subtitle:
      "Starter relics are removed, and relic nodes grow with win rate across qualifying completed runs.",
    nodes: relicNodes,
    edges: [],
    ranking,
    summaryCards: [
      { label: "Completed Runs", value: String(completedRuns.length) },
      { label: "Qualified Relics", value: String(rankedRelics.length) },
      { label: "Min Support", value: String(minSupport) },
      {
        label: "Top Relic",
        value: rankedRelics[0] ? humanizeToken(rankedRelics[0].id) : "None",
      },
    ],
    warnings,
  };
}

function getProfileCharacters(loadResult: LoadResult): ProgressCharacterStat[] {
  return (loadResult.progress?.characterStats ?? []).filter(
    (stat) => stat.id !== "CHARACTER.RANDOM_CHARACTER"
  );
}

function buildProfileOverviewGraph(loadResult: LoadResult): GraphDataset {
  if (!loadResult.progress) {
    return makeMissingProgressGraph("profileOverview", loadResult.runs.length);
  }

  const characterStats = getProfileCharacters(loadResult);
  const rankedCharacters = [...characterStats].sort((left, right) => {
    const winDifference = right.totalWins - left.totalWins;
    if (winDifference !== 0) {
      return winDifference;
    }

    const playtimeDifference = right.playtime - left.playtime;
    if (playtimeDifference !== 0) {
      return playtimeDifference;
    }

    return left.id.localeCompare(right.id);
  });

  const maxPlaytime = Math.max(...characterStats.map((stat) => stat.playtime), 1);
  const maxAscension = Math.max(...characterStats.map((stat) => stat.maxAscension), 1);
  const nodes: GraphNode[] = characterStats.map((stat) => {
    const completedRuns = stat.totalWins + stat.totalLosses;
    const winRate = completedRuns > 0 ? stat.totalWins / completedRuns : 0;
    return withLayoutRadius({
      id: stat.id,
      label: humanizeToken(stat.id),
      kind: "character",
      value: stat.playtime,
      secondaryValue: stat.maxAscension,
      radius: squareRootRadius(stat.playtime, maxPlaytime, 0.12, 0.28),
      color: getCharacterColor(
        stat.id,
        blendColor(COLORS.characterLow, COLORS.characterHigh, stat.maxAscension / maxAscension)
      ),
      imageUrl: getCharacterImageUrl(stat.id),
    });
  });

  const ranking: RankingEntry[] = rankedCharacters.map((stat) => {
    const completedRuns = stat.totalWins + stat.totalLosses;
    const winRate = completedRuns > 0 ? stat.totalWins / completedRuns : 0;
    return {
      id: stat.id,
      label: humanizeToken(stat.id),
      valueLabel: `${stat.totalWins} wins`,
      detail: `${formatPercent(winRate)} win rate, Asc ${stat.maxAscension}, best streak ${stat.bestWinStreak}, fastest win ${formatSecondsAsDuration(
        stat.fastestWinTime
      )}`,
    };
  });

  return {
    view: "profileOverview",
    title: "Profile Overview",
    subtitle:
      "Bubble size tracks total playtime per character, while the ranking details call out ascension and streak milestones.",
    nodes,
    edges: [],
    ranking,
    summaryCards: [
      { label: "Total Playtime", value: formatSecondsAsDuration(loadResult.progress.totalPlaytime) },
      { label: "Floors Climbed", value: String(loadResult.progress.floorsClimbed) },
      { label: "Unlocks", value: String(loadResult.progress.totalUnlocks) },
      { label: "Wongo Points", value: String(loadResult.progress.wongoPoints) },
    ],
    warnings: [],
  };
}

function toCardAggregate(stat: ProgressCardStat): CardAggregate {
  const support = stat.timesWon + stat.timesLost;
  return {
    id: stat.id,
    support,
    winRate: support > 0 ? stat.timesWon / support : 0,
    picked: stat.timesPicked,
    skipped: stat.timesSkipped,
    wins: stat.timesWon,
    losses: stat.timesLost,
  };
}

function buildCardStatsGraph(loadResult: LoadResult, topN: number, minSupport: number): GraphDataset {
  if (!loadResult.progress) {
    return makeMissingProgressGraph("cardStats", loadResult.runs.length);
  }

  const cardAggregates = loadResult.progress.cardStats
    .map(toCardAggregate)
    .filter((stat) => stat.picked > 0 && stat.support >= minSupport)
    .sort((left, right) => {
      const winRateDifference = right.winRate - left.winRate;
      if (Math.abs(winRateDifference) > 0.0001) {
        return winRateDifference;
      }

      const supportDifference = right.support - left.support;
      if (supportDifference !== 0) {
        return supportDifference;
      }

      const pickDifference = right.picked - left.picked;
      if (pickDifference !== 0) {
        return pickDifference;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, topN);

  if (cardAggregates.length === 0) {
    return {
      view: "cardStats",
      title: "Card Stats",
      subtitle:
        "Card effectiveness uses progress.save aggregate counts, but no cards met the current support threshold.",
      nodes: [],
      edges: [],
      ranking: [],
      summaryCards: [
        { label: "Tracked Cards", value: String(loadResult.progress.cardStats.length) },
        { label: "Qualified Cards", value: "0" },
        { label: "Min Support", value: String(minSupport) },
        { label: "Action", value: "Lower Threshold" },
      ],
      showEdges: false,
      warnings: [`No cards with at least ${minSupport} tracked wins or losses were found.`],
    };
  }

  const maxWinRate = Math.max(...cardAggregates.map((stat) => stat.winRate), 0.01);
  const nodes: GraphNode[] = cardAggregates.map((stat) => {
    const label = humanizeToken(stat.id);
    const layoutRadiusSeed = squareRootRadius(stat.winRate, maxWinRate, 0.15, 0.34);
    return {
      id: stat.id,
      label,
      kind: "card",
      value: stat.winRate,
      secondaryValue: stat.support,
      radius: squareRootRadius(stat.winRate, maxWinRate, 0.3, 0.68),
      layoutRadius: computeLayoutRadius(label, "card", layoutRadiusSeed),
      color: blendColor(COLORS.loss, COLORS.win, stat.winRate),
      imageUrl: getCardImageUrl(stat.id),
    };
  });

  const ranking: RankingEntry[] = cardAggregates.map((stat) => ({
    id: stat.id,
    label: humanizeToken(stat.id),
    valueLabel: `${formatPercent(stat.winRate)} win rate`,
    detail: `${stat.wins} wins and ${stat.losses} losses, picked ${stat.picked} times, skipped ${stat.skipped} times`,
  }));

  // Group cards by character pool, then build hub nodes + colored edges per pool.
  const cardsByPool = new Map<string, CardAggregate[]>();
  for (const stat of cardAggregates) {
    const pool = getCardPool(stat.id);
    if (pool === undefined) {
      continue;
    }
    const group = cardsByPool.get(pool) ?? [];
    group.push(stat);
    cardsByPool.set(pool, group);
  }

  // One character hub node per pool that has qualifying cards.
  const characterNodes: GraphNode[] = [];
  for (const [pool, group] of cardsByPool) {
    const characterId = getCardStatsCharacterIdForPool(pool);
    if (characterId === null || characterId === undefined || group.length === 0) {
      continue;
    }
    characterNodes.push(
      withLayoutRadius({
        id: characterId,
        label: humanizeToken(characterId),
        kind: "character",
        value: group.length,
        radius: 0.24,
        color: getCharacterColor(characterId),
        imageUrl: getCharacterImageUrl(characterId),
      })
    );
  }

  const edgeMap = new Map<string, GraphEdge>();
  for (const [pool, group] of cardsByPool) {
    const characterId = getCardStatsCharacterIdForPool(pool);
    const edgeColor: [number, number, number, number] =
      characterId != null ? getCharacterColor(characterId) : COLORLESS_EDGE_COLOR;

    // Hub spoke: character → each card in the pool.
    if (characterId != null) {
      for (const stat of group) {
        addEdge(edgeMap, characterId, stat.id, 2, edgeColor);
      }
    }
  }

  return {
    view: "cardStats",
    title: "Card Stats",
    subtitle:
      "Cards are filtered to non-starter pickups, sized by profile win rate, and placed directly into five fixed class sectors with Colorless centered.",
    nodes,
    edges: [],
    showEdges: false,
    ranking,
    summaryCards: [
      {
        label: "Tracked Cards",
        value: String(loadResult.progress.cardStats.filter((stat) => stat.timesPicked > 0).length),
      },
      { label: "Qualified Cards", value: String(cardAggregates.length) },
      { label: "Min Support", value: String(minSupport) },
      { label: "Top Card", value: humanizeToken(cardAggregates[0].id) },
    ],
    warnings: [],
  };
}

function toEncounterAggregate(stat: ProgressEncounterStat): EncounterAggregate {
  const characterLosses = new Map<string, number>();
  let wins = 0;
  let losses = 0;

  for (const fightStat of stat.fightStats) {
    wins += fightStat.wins;
    losses += fightStat.losses;
    if (fightStat.losses > 0) {
      characterLosses.set(fightStat.character, fightStat.losses);
    }
  }

  const total = wins + losses;
  return {
    id: stat.encounterId,
    wins,
    losses,
    lossRate: total > 0 ? losses / total : 0,
    characterLosses,
  };
}

function buildEncounterStatsGraph(loadResult: LoadResult, topN: number): GraphDataset {
  if (!loadResult.progress) {
    return makeMissingProgressGraph("encounterStats", loadResult.runs.length);
  }

  const eligibleEncounterStats = loadResult.progress.encounterStats.filter((stat) =>
    isTrackedEncounterStatsId(stat.encounterId)
  );

  const encounterAggregates = eligibleEncounterStats
    .map(toEncounterAggregate)
    .filter((stat) => stat.losses > 0)
    .sort((left, right) => {
      const lossDifference = right.losses - left.losses;
      if (lossDifference !== 0) {
        return lossDifference;
      }

      const rateDifference = right.lossRate - left.lossRate;
      if (Math.abs(rateDifference) > 0.0001) {
        return rateDifference;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, topN);

  if (encounterAggregates.length === 0) {
    return {
      view: "encounterStats",
      title: "Encounter Stats",
      subtitle: "Encounter aggregates were loaded, but no normal or elite encounter losses were found.",
      nodes: [],
      edges: [],
      ranking: [],
      summaryCards: [
        {
          label: "Tracked Encounters",
          value: String(eligibleEncounterStats.filter((stat) => stat.fightStats.length > 0).length),
        },
        { label: "Shown Encounters", value: "0" },
        { label: "Top N", value: String(topN) },
        { label: "Dangerous Fights", value: "0" },
      ],
      warnings: [
        "No normal or elite encounter losses were recorded in progress.save after excluding bosses and event fights.",
      ],
    };
  }

  const maxEncounterLosses = Math.max(...encounterAggregates.map((stat) => stat.losses), 1);

  const encounterNodes = encounterAggregates.map((stat) =>
    withLayoutRadius({
      id: stat.id,
      label: formatEncounterLabel(stat.id),
      kind: "encounter" as const,
      value: stat.losses,
      secondaryValue: stat.lossRate,
      radius: squareRootRadius(stat.losses, maxEncounterLosses, 0.12, 0.28),
      color: blendColor(COLORS.encounter, COLORS.loss, stat.lossRate),
      imageUrl: getEncounterImageUrl(stat.id),
    })
  );

  const ranking: RankingEntry[] = encounterAggregates.map((stat) => ({
    id: stat.id,
    label: formatEncounterLabel(stat.id),
    valueLabel: `${stat.losses} losses`,
    detail: `${stat.wins} wins overall, ${formatPercent(stat.lossRate)} loss rate across tracked fights`,
  }));

  const totalRecordedLosses = encounterAggregates.reduce((sum, stat) => sum + stat.losses, 0);

  return {
    view: "encounterStats",
    title: "Encounter Stats",
    subtitle:
      "Encounter nodes come from progress.save fight aggregates and focus on the normal and elite fights with the most tracked losses.",
    nodes: encounterNodes,
    edges: [],
    ranking,
    summaryCards: [
      {
        label: "Tracked Encounters",
        value: String(eligibleEncounterStats.filter((stat) => stat.fightStats.length > 0).length),
      },
      { label: "Shown Encounters", value: String(encounterAggregates.length) },
      { label: "Recorded Losses", value: String(totalRecordedLosses) },
      { label: "Top Threat", value: formatEncounterLabel(encounterAggregates[0].id) },
    ],
    warnings: [],
  };
}

function buildRunScatterGraph(
  runs: RunSummary[],
  xMetric: ScatterMetricId,
  yMetric: ScatterMetricId,
  hasProgress: boolean
): GraphDataset {
  if (runs.length === 0) {
    return makeMissingRunGraph("runScatter", hasProgress);
  }

  const xAxis = getScatterMetricDefinition(xMetric);
  const yAxis = getScatterMetricDefinition(yMetric);
  const points = runs.map((run) => ({
    run,
    xValue: xAxis.getValue(run),
    yValue: yAxis.getValue(run),
  }));
  const xValues = points.map((point) => point.xValue);
  const yValues = points.map((point) => point.yValue);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);
  const worldBounds = {
    minX: -0.84,
    maxX: 0.84,
    minY: -0.84,
    maxY: 0.84,
  };

  const fixedPositions = points.map((point) => ({
    x: scaleScatterValue(point.xValue, xMin, xMax, worldBounds.minX, worldBounds.maxX),
    y: scaleScatterValue(point.yValue, yMin, yMax, worldBounds.minY, worldBounds.maxY),
  }));
  const nodes: GraphNode[] = points.map((point, index) => ({
    id: `run:${point.run.runId}:${index}`,
    label: point.run.sourceName,
    kind: "stat",
    value: point.yValue,
    secondaryValue: point.xValue,
    radius: 0.048,
    layoutRadius: 0.048,
    color: getRunOutcomeColor(point.run),
  }));
  const correlation = computePearsonCorrelation(
    points.map((point) => ({
      x: point.xValue,
      y: point.yValue,
    }))
  );
  const ranking: RankingEntry[] = [...points]
    .sort((left, right) => {
      const yDifference = right.yValue - left.yValue;
      if (yDifference !== 0) {
        return yDifference;
      }

      const xDifference = right.xValue - left.xValue;
      if (xDifference !== 0) {
        return xDifference;
      }

      return left.run.sourceName.localeCompare(right.run.sourceName);
    })
    .map((point) => ({
      id: point.run.runId,
      label: `${humanizeToken(point.run.character)} · ${point.run.sourceName}`,
      valueLabel: `${yAxis.label}: ${formatScatterMetricValue(point.yValue)}`,
      detail: `${xAxis.label}: ${formatScatterMetricValue(point.xValue)} · ${getRunOutcomeLabel(point.run)}`,
    }));

  const warnings: string[] = [];
  if (xMetric === yMetric) {
    warnings.push("The same metric is selected for both axes, so every run will lie on a diagonal.");
  }
  if (correlation === null) {
    warnings.push(
      runs.length < 2
        ? "At least two parsed runs are needed before a correlation value can be calculated."
        : "One of the selected axes has no spread in the current runs, so correlation is unavailable."
    );
  }

  return {
    view: "runScatter",
    title: "Run Scatter Plot",
    subtitle: `Comparing ${xAxis.label} on the x-axis against ${yAxis.label} on the y-axis across parsed run-history files.`,
    nodes,
    edges: [],
    fixedPositions,
    scatterPlot: {
      xAxis: {
        metric: xMetric,
        label: xAxis.label,
        minValue: xMin,
        maxValue: xMax,
        minLabel: formatScatterMetricValue(xMin),
        maxLabel: formatScatterMetricValue(xMax),
      },
      yAxis: {
        metric: yMetric,
        label: yAxis.label,
        minValue: yMin,
        maxValue: yMax,
        minLabel: formatScatterMetricValue(yMin),
        maxLabel: formatScatterMetricValue(yMax),
      },
      correlation,
      worldBounds,
    },
    ranking,
    summaryCards: [
      { label: "Runs Plotted", value: String(runs.length) },
      { label: "X Axis", value: xAxis.label },
      { label: "Y Axis", value: yAxis.label },
      {
        label: "Correlation",
        value: correlation === null ? "Unavailable" : `r = ${correlation.toFixed(2)}`,
      },
    ],
    warnings,
  };
}

export function buildGraphDataset(
  view: GraphView,
  loadResult: LoadResult,
  options: GraphBuildOptions
): GraphDataset {
  const graph = (() => {
    switch (view) {
      case "bossDeaths":
        return buildBossGraph(loadResult.runs, options.topN, loadResult.progress !== null);
      case "relicWinRate":
        return buildRelicGraph(
          loadResult.runs,
          options.topN,
          options.minSupport,
          loadResult.progress !== null
        );
      case "profileOverview":
        return buildProfileOverviewGraph(loadResult);
      case "cardStats":
        return buildCardStatsGraph(loadResult, options.topN, options.minSupport);
      case "encounterStats":
        return buildEncounterStatsGraph(loadResult, options.topN);
      case "runScatter":
        return buildRunScatterGraph(
          loadResult.runs,
          options.scatterXMetric ?? DEFAULT_SCATTER_X_METRIC,
          options.scatterYMetric ?? DEFAULT_SCATTER_Y_METRIC,
          loadResult.progress !== null
        );
    }
  })();

  return assignGraphNodeColors(graph);
}
