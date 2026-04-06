import { LoadResult, ParseFileInput, RunSummary } from "../types";
import { parseProgressJsonText } from "./progressParser";

interface RawRelic {
  id?: unknown;
}

interface RawPlayer {
  character?: unknown;
  relics?: RawRelic[];
}

interface RawMapPointPlayerStat {
  max_hp?: unknown;
}

interface RawRoomRecord {
  model_id?: unknown;
  room_type?: unknown;
}

interface RawMapPoint {
  map_point_type?: unknown;
  player_stats?: RawMapPointPlayerStat[];
  rooms?: RawRoomRecord[];
}

interface RawRunRecord {
  start_time?: unknown;
  win?: unknown;
  was_abandoned?: unknown;
  killed_by_encounter?: unknown;
  map_point_history?: unknown;
  players?: RawPlayer[];
}

function numberOrDefault(value: unknown, defaultValue: number = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

function flattenMapPointHistory(rawHistory: unknown): RawMapPoint[] {
  const points: RawMapPoint[] = [];

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }

    for (const entry of value) {
      if (Array.isArray(entry)) {
        visit(entry);
        continue;
      }

      if (entry && typeof entry === "object") {
        points.push(entry as RawMapPoint);
      }
    }
  };

  visit(rawHistory);
  return points;
}

function isCombatRoom(room: RawRoomRecord): boolean {
  const roomType = typeof room.room_type === "string" ? room.room_type : "";
  const modelId = typeof room.model_id === "string" ? room.model_id : "";
  return (roomType === "monster" || roomType === "elite" || roomType === "boss") && modelId.startsWith("ENCOUNTER.");
}

function isEliteRoom(room: RawRoomRecord): boolean {
  const roomType = typeof room.room_type === "string" ? room.room_type : "";
  const modelId = typeof room.model_id === "string" ? room.model_id : "";
  return roomType === "elite" || modelId.endsWith("_ELITE");
}

function extractRunMetrics(rawHistory: unknown): Pick<
  RunSummary,
  "floorsClimbed" | "elitesEncountered" | "overallEncounters" | "restSitesVisited" | "maxHealth"
> {
  const points = flattenMapPointHistory(rawHistory);
  const rooms = points.flatMap((point) => (Array.isArray(point.rooms) ? point.rooms : []));
  const playerStats = points.flatMap((point) =>
    Array.isArray(point.player_stats) ? point.player_stats : []
  );

  return {
    floorsClimbed: points.length,
    elitesEncountered: rooms.filter((room) => isEliteRoom(room)).length,
    overallEncounters: rooms.filter((room) => isCombatRoom(room)).length,
    restSitesVisited: points.filter((point) => {
      if (point.map_point_type === "rest_site") {
        return true;
      }

      const pointRooms = Array.isArray(point.rooms) ? point.rooms : [];
      return pointRooms.some((room) => room.room_type === "rest_site");
    }).length,
    maxHealth: playerStats.reduce(
      (highest, stat) => Math.max(highest, numberOrDefault(stat.max_hp)),
      0
    ),
  };
}

function extractRunId(rawRun: RawRunRecord, fileName: string): string {
  if (typeof rawRun.start_time === "number" || typeof rawRun.start_time === "string") {
    return String(rawRun.start_time);
  }

  return fileName.replace(/\.run$/i, "");
}

export function normalizeRunRecord(rawRun: unknown, fileName: string): RunSummary {
  if (!rawRun || typeof rawRun !== "object") {
    throw new Error("file is not a JSON object");
  }

  const record = rawRun as RawRunRecord;
  if (!Array.isArray(record.players) || record.players.length === 0 || !record.players[0]) {
    throw new Error("players[0] is missing");
  }

  const primaryPlayer = record.players[0];
  if (typeof primaryPlayer.character !== "string" || primaryPlayer.character.length === 0) {
    throw new Error("players[0].character is missing");
  }

  const relicIdsExcludingStarter = Array.isArray(primaryPlayer.relics)
    ? Array.from(
        new Set(
          primaryPlayer.relics
            .slice(1)
            .map((relic) => (typeof relic?.id === "string" ? relic.id : null))
            .filter((relicId): relicId is string => relicId !== null)
        )
      )
    : [];
  const runMetrics = extractRunMetrics(record.map_point_history);

  return {
    runId: extractRunId(record, fileName),
    sourceName: fileName,
    character: primaryPlayer.character,
    win: record.win === true,
    wasAbandoned: record.was_abandoned === true,
    killedByEncounter:
      typeof record.killed_by_encounter === "string" ? record.killed_by_encounter : null,
    relicIdsExcludingStarter,
    floorsClimbed: runMetrics.floorsClimbed,
    elitesEncountered: runMetrics.elitesEncountered,
    overallEncounters: runMetrics.overallEncounters,
    restSitesVisited: runMetrics.restSitesVisited,
    maxHealth: runMetrics.maxHealth,
  };
}

export function parseRunJsonText(text: string, fileName: string): RunSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(message);
  }

  return normalizeRunRecord(parsed, fileName);
}

export function parseManyRunTexts(files: ParseFileInput[]): LoadResult {
  const warnings: string[] = [];
  const runs: RunSummary[] = [];
  let skippedFiles = 0;

  for (const file of files) {
    try {
      runs.push(parseRunJsonText(file.text, file.fileName));
    } catch (error) {
      skippedFiles += 1;
      const message = error instanceof Error ? error.message : "unknown parsing error";
      warnings.push(`${file.fileName}: ${message}`);
    }
  }

  return {
    runs,
    progress: null,
    parsedFiles: runs.length,
    skippedFiles,
    warnings,
  };
}

export function parseAnalyticsTexts(files: ParseFileInput[]): LoadResult {
  const runFiles = files.filter((file) => file.fileName.toLowerCase().endsWith(".run"));
  const progressFiles = files.filter((file) => file.fileName.toLowerCase() === "progress.save");
  const runResult = parseManyRunTexts(runFiles);
  const warnings = [...runResult.warnings];
  let skippedFiles = runResult.skippedFiles;
  let progress = null;

  if (progressFiles.length > 1) {
    warnings.push(
      `Multiple progress.save files were found. Using the first one: ${progressFiles[0].fileName}.`
    );
  }

  const progressFile = progressFiles[0];
  if (progressFile) {
    try {
      progress = parseProgressJsonText(progressFile.text);
    } catch (error) {
      skippedFiles += 1;
      const message = error instanceof Error ? error.message : "unknown parsing error";
      warnings.push(`${progressFile.fileName}: ${message}`);
    }
  }

  return {
    runs: runResult.runs,
    progress,
    parsedFiles: runResult.parsedFiles,
    skippedFiles,
    warnings,
  };
}
