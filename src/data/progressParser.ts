import {
  ProgressAncientCharacterStat,
  ProgressAncientStat,
  ProgressCardStat,
  ProgressCharacterStat,
  ProgressEncounterCharacterStat,
  ProgressEncounterStat,
  ProgressSummary,
} from "../types";

interface RawProgressCharacterStat {
  id?: unknown;
  total_wins?: unknown;
  total_losses?: unknown;
  playtime?: unknown;
  max_ascension?: unknown;
  preferred_ascension?: unknown;
  best_win_streak?: unknown;
  current_streak?: unknown;
  fastest_win_time?: unknown;
}

interface RawProgressCardStat {
  id?: unknown;
  times_picked?: unknown;
  times_skipped?: unknown;
  times_won?: unknown;
  times_lost?: unknown;
}

interface RawProgressEncounterCharacterStat {
  character?: unknown;
  wins?: unknown;
  losses?: unknown;
}

interface RawProgressEncounterStat {
  encounter_id?: unknown;
  fight_stats?: RawProgressEncounterCharacterStat[];
}

interface RawProgressAncientCharacterStat {
  character?: unknown;
  wins?: unknown;
  losses?: unknown;
}

interface RawProgressAncientStat {
  ancient_id?: unknown;
  character_stats?: RawProgressAncientCharacterStat[];
}

interface RawProgressRecord {
  current_score?: unknown;
  floors_climbed?: unknown;
  total_playtime?: unknown;
  total_unlocks?: unknown;
  wongo_points?: unknown;
  max_multiplayer_ascension?: unknown;
  preferred_multiplayer_ascension?: unknown;
  unique_id?: unknown;
  discovered_acts?: unknown[];
  discovered_cards?: unknown[];
  discovered_events?: unknown[];
  discovered_potions?: unknown[];
  discovered_relics?: unknown[];
  character_stats?: RawProgressCharacterStat[];
  card_stats?: RawProgressCardStat[];
  encounter_stats?: RawProgressEncounterStat[];
  ancient_stats?: RawProgressAncientStat[];
}

function numberOrDefault(value: unknown, defaultValue: number = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeProgressCharacterStat(rawStat: RawProgressCharacterStat): ProgressCharacterStat | null {
  const id = stringOrEmpty(rawStat.id);
  if (!id) {
    return null;
  }

  return {
    id,
    totalWins: numberOrDefault(rawStat.total_wins),
    totalLosses: numberOrDefault(rawStat.total_losses),
    playtime: numberOrDefault(rawStat.playtime),
    maxAscension: numberOrDefault(rawStat.max_ascension),
    preferredAscension: numberOrDefault(rawStat.preferred_ascension),
    bestWinStreak: numberOrDefault(rawStat.best_win_streak),
    currentStreak: numberOrDefault(rawStat.current_streak),
    fastestWinTime: numberOrDefault(rawStat.fastest_win_time, -1),
  };
}

function normalizeProgressCardStat(rawStat: RawProgressCardStat): ProgressCardStat | null {
  const id = stringOrEmpty(rawStat.id);
  if (!id) {
    return null;
  }

  return {
    id,
    timesPicked: numberOrDefault(rawStat.times_picked),
    timesSkipped: numberOrDefault(rawStat.times_skipped),
    timesWon: numberOrDefault(rawStat.times_won),
    timesLost: numberOrDefault(rawStat.times_lost),
  };
}

function normalizeEncounterFightStat(
  rawStat: RawProgressEncounterCharacterStat
): ProgressEncounterCharacterStat | null {
  const character = stringOrEmpty(rawStat.character);
  if (!character) {
    return null;
  }

  return {
    character,
    wins: numberOrDefault(rawStat.wins),
    losses: numberOrDefault(rawStat.losses),
  };
}

function normalizeEncounterStat(rawStat: RawProgressEncounterStat): ProgressEncounterStat | null {
  const encounterId = stringOrEmpty(rawStat.encounter_id);
  if (!encounterId) {
    return null;
  }

  return {
    encounterId,
    fightStats: Array.isArray(rawStat.fight_stats)
      ? rawStat.fight_stats
          .map(normalizeEncounterFightStat)
          .filter((stat): stat is ProgressEncounterCharacterStat => stat !== null)
      : [],
  };
}

function normalizeAncientCharacterStat(
  rawStat: RawProgressAncientCharacterStat
): ProgressAncientCharacterStat | null {
  const character = stringOrEmpty(rawStat.character);
  if (!character) {
    return null;
  }

  return {
    character,
    wins: numberOrDefault(rawStat.wins),
    losses: numberOrDefault(rawStat.losses),
  };
}

function normalizeAncientStat(rawStat: RawProgressAncientStat): ProgressAncientStat | null {
  const ancientId = stringOrEmpty(rawStat.ancient_id);
  if (!ancientId) {
    return null;
  }

  return {
    ancientId,
    characterStats: Array.isArray(rawStat.character_stats)
      ? rawStat.character_stats
          .map(normalizeAncientCharacterStat)
          .filter((stat): stat is ProgressAncientCharacterStat => stat !== null)
      : [],
  };
}

export function normalizeProgressRecord(rawProgress: unknown): ProgressSummary {
  if (!rawProgress || typeof rawProgress !== "object") {
    throw new Error("progress.save is not a JSON object");
  }

  const record = rawProgress as RawProgressRecord;

  return {
    currentScore: numberOrDefault(record.current_score),
    floorsClimbed: numberOrDefault(record.floors_climbed),
    totalPlaytime: numberOrDefault(record.total_playtime),
    totalUnlocks: numberOrDefault(record.total_unlocks),
    wongoPoints: numberOrDefault(record.wongo_points),
    maxMultiplayerAscension: numberOrDefault(record.max_multiplayer_ascension),
    preferredMultiplayerAscension: numberOrDefault(record.preferred_multiplayer_ascension),
    uniqueId: stringOrEmpty(record.unique_id),
    discoveredActs: Array.isArray(record.discovered_acts) ? record.discovered_acts.length : 0,
    discoveredCards: Array.isArray(record.discovered_cards) ? record.discovered_cards.length : 0,
    discoveredEvents: Array.isArray(record.discovered_events) ? record.discovered_events.length : 0,
    discoveredPotions: Array.isArray(record.discovered_potions) ? record.discovered_potions.length : 0,
    discoveredRelics: Array.isArray(record.discovered_relics) ? record.discovered_relics.length : 0,
    characterStats: Array.isArray(record.character_stats)
      ? record.character_stats
          .map(normalizeProgressCharacterStat)
          .filter((stat): stat is ProgressCharacterStat => stat !== null)
      : [],
    cardStats: Array.isArray(record.card_stats)
      ? record.card_stats
          .map(normalizeProgressCardStat)
          .filter((stat): stat is ProgressCardStat => stat !== null)
      : [],
    encounterStats: Array.isArray(record.encounter_stats)
      ? record.encounter_stats
          .map(normalizeEncounterStat)
          .filter((stat): stat is ProgressEncounterStat => stat !== null)
      : [],
    ancientStats: Array.isArray(record.ancient_stats)
      ? record.ancient_stats
          .map(normalizeAncientStat)
          .filter((stat): stat is ProgressAncientStat => stat !== null)
      : [],
  };
}

export function parseProgressJsonText(text: string): ProgressSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(message);
  }

  return normalizeProgressRecord(parsed);
}
