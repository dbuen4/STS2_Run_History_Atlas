import { LoadResult, ParseFileInput, RunSummary } from "../types";
import { parseProgressJsonText } from "./progressParser";

interface RawRelic {
  id?: unknown;
}

interface RawPlayer {
  character?: unknown;
  relics?: RawRelic[];
}

interface RawRunRecord {
  start_time?: unknown;
  win?: unknown;
  was_abandoned?: unknown;
  killed_by_encounter?: unknown;
  players?: RawPlayer[];
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

  return {
    runId: extractRunId(record, fileName),
    sourceName: fileName,
    character: primaryPlayer.character,
    win: record.win === true,
    wasAbandoned: record.was_abandoned === true,
    killedByEncounter:
      typeof record.killed_by_encounter === "string" ? record.killed_by_encounter : null,
    relicIdsExcludingStarter,
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
