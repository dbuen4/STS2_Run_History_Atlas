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
} from "../types";
import { assignGraphNodeColors } from "../nodePalette";
import {
  computeLayoutRadius,
  formatPercent,
  formatSecondsAsDuration,
  humanizeToken,
  sortByNumberThenLabel,
  squareRootRadius,
} from "../utils";
import { getCharacterColor } from "../characterPalette";

const COLORS = {
  characterLow: [0.67, 0.43, 0.28, 1] as [number, number, number, number],
  characterHigh: [0.18, 0.49, 0.41, 1] as [number, number, number, number],
  win: [0.2, 0.52, 0.42, 1] as [number, number, number, number],
  loss: [0.76, 0.27, 0.22, 1] as [number, number, number, number],
  abandoned: [0.45, 0.44, 0.44, 1] as [number, number, number, number],
  boss: [0.65, 0.33, 0.2, 1] as [number, number, number, number],
  relic: [0.2, 0.38, 0.65, 1] as [number, number, number, number],
  stat: [0.45, 0.34, 0.2, 1] as [number, number, number, number],
  card: [0.55, 0.3, 0.15, 1] as [number, number, number, number],
  encounter: [0.61, 0.23, 0.2, 1] as [number, number, number, number],
};

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

function addEdge(edgeMap: Map<string, GraphEdge>, sourceId: string, targetId: string, weight: number): void {
  if (weight <= 0) {
    return;
  }

  edgeMap.set(`${sourceId}::${targetId}`, { sourceId, targetId, weight });
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
  minRadius: number = 0.05,
  maxRadius: number = 0.16
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

function makeMissingProgressGraph(view: GraphView, runCount: number): GraphDataset {
  const viewMeta: Record<Exclude<GraphView, "bossDeaths" | "relicWinRate">, { title: string; subtitle: string }> =
    {
      profileOverview: {
        title: "Profile Overview",
        subtitle:
          "Load the profile saves folder that contains progress.save to unlock profile-wide overview graphs.",
      },
      cardStats: {
        title: "Card Stats",
        subtitle:
          "Card effectiveness uses progress.save aggregates. Select the profile saves folder instead of only history.",
      },
      encounterStats: {
        title: "Encounter Stats",
        subtitle:
          "Encounter aggregates come from progress.save and cover more than final run-ending deaths.",
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

function makeMissingRunGraph(view: Extract<GraphView, "bossDeaths" | "relicWinRate">, hasProgress: boolean): GraphDataset {
  const viewMeta: Record<Extract<GraphView, "bossDeaths" | "relicWinRate">, { title: string; subtitle: string }> = {
    bossDeaths: {
      title: "Boss and Elite Deaths",
      subtitle:
        "Boss Deaths needs `.run` history files so it can count which encounters actually ended your runs.",
    },
    relicWinRate: {
      title: "Relic Win Rate",
      subtitle:
        "Relic Win Rate is built from completed `.run` history files, not from progress.save alone.",
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
      { label: "Views Locked", value: "2" },
    ],
    warnings: [
      "No `.run` history files were loaded. Boss Deaths and Relic Win Rate both require the `history` folder.",
    ],
  };
}

function buildBossGraph(runs: RunSummary[], topN: number, hasProgress: boolean): GraphDataset {
  if (runs.length === 0) {
    return makeMissingRunGraph("bossDeaths", hasProgress);
  }

  const deathRuns = runs.filter(
    (run) => run.killedByEncounter !== null && run.killedByEncounter !== "NONE.NONE"
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

  const characterDeathCounts = new Map<string, number>();
  const characterBossEdgeCounts = new Map<string, number>();
  for (const run of deathRuns) {
    const encounter = run.killedByEncounter as string;
    if (!selectedBosses.has(encounter)) {
      continue;
    }

    characterDeathCounts.set(run.character, (characterDeathCounts.get(run.character) ?? 0) + 1);
    characterBossEdgeCounts.set(
      `${run.character}::${encounter}`,
      (characterBossEdgeCounts.get(`${run.character}::${encounter}`) ?? 0) + 1
    );
  }

  const bossNodes = rankedBosses.map((entry) =>
    makeCountNode(
      entry.encounter,
      humanizeToken(entry.encounter),
      "boss",
      entry.count,
      maxBossCount,
      COLORS.boss,
      0.06,
      0.16
    )
  );

  const edges = [...characterBossEdgeCounts.entries()].map(([key, weight]) => {
    const [sourceId, targetId] = key.split("::");
    return { sourceId, targetId, weight };
  });

  const ranking: RankingEntry[] = rankedBosses.map((entry) => ({
    id: entry.encounter,
    label: humanizeToken(entry.encounter),
    valueLabel: `${entry.count} death${entry.count === 1 ? "" : "s"}`,
    detail: "Counted from non-winning runs where this encounter finished the run.",
  }));

  return {
    view: "bossDeaths",
    title: "Boss and Elite Deaths",
    subtitle:
      "Boss nodes grow with total kills and focus on the encounters that most often ended a run.",
    nodes: bossNodes,
    edges,
    ranking,
    summaryCards: [
      { label: "Fatal Runs", value: String(deathRuns.length) },
      { label: "Unique Encounters", value: String(bossCounts.size) },
      { label: "Shown Bosses", value: String(rankedBosses.length) },
      {
        label: "Top Threat",
        value: rankedBosses[0] ? humanizeToken(rankedBosses[0].encounter) : "None",
      },
    ],
    warnings:
      rankedBosses.length === 0 ? ["No lethal encounters were found in the parsed runs."] : [],
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
      radius: squareRootRadius(stat.winRate, maxRelicWinRate, 0.06, 0.15),
      color: COLORS.relic,
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
    edges: [...edgeMap.values()],
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
      radius: squareRootRadius(stat.playtime, maxPlaytime, 0.07, 0.16),
      color: getCharacterColor(
        stat.id,
        blendColor(COLORS.characterLow, COLORS.characterHigh, stat.maxAscension / maxAscension)
      ),
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
      warnings: [`No cards with at least ${minSupport} tracked wins or losses were found.`],
    };
  }

  const maxWinRate = Math.max(...cardAggregates.map((stat) => stat.winRate), 0.01);
  const totals = {
    CARD_PICKED: cardAggregates.reduce((sum, stat) => sum + stat.picked, 0),
    CARD_SKIPPED: cardAggregates.reduce((sum, stat) => sum + stat.skipped, 0),
    CARD_WON: cardAggregates.reduce((sum, stat) => sum + stat.wins, 0),
    CARD_LOST: cardAggregates.reduce((sum, stat) => sum + stat.losses, 0),
  };
  const maxTotal = Math.max(totals.CARD_PICKED, totals.CARD_SKIPPED, totals.CARD_WON, totals.CARD_LOST, 1);

  const nodes: GraphNode[] = cardAggregates.map((stat) =>
    withLayoutRadius({
      id: stat.id,
      label: humanizeToken(stat.id),
      kind: "card",
      value: stat.winRate,
      secondaryValue: stat.support,
      radius: squareRootRadius(stat.winRate, maxWinRate, 0.06, 0.15),
      color: blendColor(COLORS.loss, COLORS.win, stat.winRate),
    })
  );
  nodes.push(
    makeCountNode("CARD_PICKED", "Picked", "stat", totals.CARD_PICKED, maxTotal, COLORS.stat, 0.06, 0.14),
    makeCountNode("CARD_SKIPPED", "Skipped", "stat", totals.CARD_SKIPPED, maxTotal, COLORS.stat, 0.06, 0.14),
    makeCountNode("CARD_WON", "Won With", "stat", totals.CARD_WON, maxTotal, COLORS.win, 0.06, 0.14),
    makeCountNode("CARD_LOST", "Lost With", "stat", totals.CARD_LOST, maxTotal, COLORS.loss, 0.06, 0.14)
  );

  const edgeMap = new Map<string, GraphEdge>();
  for (const stat of cardAggregates) {
    addEdge(edgeMap, stat.id, "CARD_PICKED", stat.picked);
    addEdge(edgeMap, stat.id, "CARD_SKIPPED", stat.skipped);
    addEdge(edgeMap, stat.id, "CARD_WON", stat.wins);
    addEdge(edgeMap, stat.id, "CARD_LOST", stat.losses);
  }

  const ranking: RankingEntry[] = cardAggregates.map((stat) => ({
    id: stat.id,
    label: humanizeToken(stat.id),
    valueLabel: `${formatPercent(stat.winRate)} win rate`,
    detail: `${stat.wins} wins and ${stat.losses} losses, picked ${stat.picked} times, skipped ${stat.skipped} times`,
  }));

  return {
    view: "cardStats",
    title: "Card Stats",
    subtitle:
      "Cards are filtered to non-starter pickups, sized by profile win rate, and linked to picked, skipped, win, and loss totals.",
    nodes,
    edges: [...edgeMap.values()],
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

  const encounterAggregates = loadResult.progress.encounterStats
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
      subtitle: "Encounter aggregates were loaded, but no tracked encounter losses were found.",
      nodes: [],
      edges: [],
      ranking: [],
      summaryCards: [
        { label: "Tracked Encounters", value: String(loadResult.progress.encounterStats.length) },
        { label: "Shown Encounters", value: "0" },
        { label: "Top N", value: String(topN) },
        { label: "Dangerous Fights", value: "0" },
      ],
      warnings: ["No encounter losses were recorded in progress.save."],
    };
  }

  const maxEncounterLosses = Math.max(...encounterAggregates.map((stat) => stat.losses), 1);
  const edgeMap = new Map<string, GraphEdge>();
  for (const encounter of encounterAggregates) {
    for (const [character, losses] of encounter.characterLosses) {
      addEdge(edgeMap, character, encounter.id, losses);
    }
  }

  const encounterNodes = encounterAggregates.map((stat) =>
    withLayoutRadius({
      id: stat.id,
      label: humanizeToken(stat.id),
      kind: "encounter" as const,
      value: stat.losses,
      secondaryValue: stat.lossRate,
      radius: squareRootRadius(stat.losses, maxEncounterLosses, 0.06, 0.16),
      color: blendColor(COLORS.boss, COLORS.loss, stat.lossRate),
    })
  );

  const ranking: RankingEntry[] = encounterAggregates.map((stat) => ({
    id: stat.id,
    label: humanizeToken(stat.id),
    valueLabel: `${stat.losses} losses`,
    detail: `${stat.wins} wins overall, ${formatPercent(stat.lossRate)} loss rate across tracked fights`,
  }));

  const totalRecordedLosses = encounterAggregates.reduce((sum, stat) => sum + stat.losses, 0);

  return {
    view: "encounterStats",
    title: "Encounter Stats",
    subtitle:
      "Encounter nodes come from progress.save fight aggregates and focus on the fights with the most tracked losses.",
    nodes: encounterNodes,
    edges: [...edgeMap.values()],
    ranking,
    summaryCards: [
      {
        label: "Tracked Encounters",
        value: String(loadResult.progress.encounterStats.filter((stat) => stat.fightStats.length > 0).length),
      },
      { label: "Shown Encounters", value: String(encounterAggregates.length) },
      { label: "Recorded Losses", value: String(totalRecordedLosses) },
      { label: "Top Threat", value: humanizeToken(encounterAggregates[0].id) },
    ],
    warnings: [],
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
    }
  })();

  return assignGraphNodeColors(graph);
}
