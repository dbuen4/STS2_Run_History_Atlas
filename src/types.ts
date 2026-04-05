export type GraphView =
  | "bossDeaths"
  | "relicWinRate"
  | "profileOverview"
  | "cardStats"
  | "encounterStats";

export type GraphNodeKind =
  | "character"
  | "outcome"
  | "boss"
  | "relic"
  | "stat"
  | "card"
  | "encounter";

export interface RunSummary {
  runId: string;
  sourceName: string;
  character: string;
  win: boolean;
  wasAbandoned: boolean;
  killedByEncounter: string | null;
  relicIdsExcludingStarter: string[];
}

export interface LoadResult {
  runs: RunSummary[];
  progress: ProgressSummary | null;
  parsedFiles: number;
  skippedFiles: number;
  warnings: string[];
}

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  value: number;
  radius: number;
  layoutRadius: number;
  color: [number, number, number, number];
  imageUrl?: string;
  secondaryValue?: number;
}

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  weight: number;
  color?: [number, number, number, number];
}

export interface RankingEntry {
  id: string;
  label: string;
  valueLabel: string;
  detail: string;
}

export interface SummaryCard {
  label: string;
  value: string;
}

export interface GraphDataset {
  view: GraphView;
  title: string;
  subtitle: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layoutEdges?: GraphEdge[];
  showEdges?: boolean;
  ranking: RankingEntry[];
  summaryCards: SummaryCard[];
  warnings: string[];
}

export interface GraphBuildOptions {
  topN: number;
  minSupport: number;
}

export interface ParseFileInput {
  fileName: string;
  text: string;
}

export interface ProgressCharacterStat {
  id: string;
  totalWins: number;
  totalLosses: number;
  playtime: number;
  maxAscension: number;
  preferredAscension: number;
  bestWinStreak: number;
  currentStreak: number;
  fastestWinTime: number;
}

export interface ProgressCardStat {
  id: string;
  timesPicked: number;
  timesSkipped: number;
  timesWon: number;
  timesLost: number;
}

export interface ProgressEncounterCharacterStat {
  character: string;
  wins: number;
  losses: number;
}

export interface ProgressEncounterStat {
  encounterId: string;
  fightStats: ProgressEncounterCharacterStat[];
}

export interface ProgressAncientCharacterStat {
  character: string;
  wins: number;
  losses: number;
}

export interface ProgressAncientStat {
  ancientId: string;
  characterStats: ProgressAncientCharacterStat[];
}

export interface ProgressSummary {
  currentScore: number;
  floorsClimbed: number;
  totalPlaytime: number;
  totalUnlocks: number;
  wongoPoints: number;
  maxMultiplayerAscension: number;
  preferredMultiplayerAscension: number;
  uniqueId: string;
  discoveredActs: number;
  discoveredCards: number;
  discoveredEvents: number;
  discoveredPotions: number;
  discoveredRelics: number;
  characterStats: ProgressCharacterStat[];
  cardStats: ProgressCardStat[];
  encounterStats: ProgressEncounterStat[];
  ancientStats: ProgressAncientStat[];
}

export interface ParseRequestMessage {
  type: "parse-files";
  files: File[];
}

export interface ParseSuccessMessage {
  type: "parse-complete";
  result: LoadResult;
}

export interface ParseErrorMessage {
  type: "parse-error";
  message: string;
}

export type ParseWorkerMessage = ParseSuccessMessage | ParseErrorMessage;
