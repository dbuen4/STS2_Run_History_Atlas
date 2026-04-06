import { RunSummary, ScatterMetricId } from "../types";

export interface ScatterMetricDefinition {
  id: ScatterMetricId;
  label: string;
  getValue: (run: RunSummary) => number;
}

export const DEFAULT_SCATTER_X_METRIC: ScatterMetricId = "floorsClimbed";
export const DEFAULT_SCATTER_Y_METRIC: ScatterMetricId = "elitesEncountered";

export const RUN_SCATTER_METRICS: readonly ScatterMetricDefinition[] = [
  {
    id: "floorsClimbed",
    label: "Floors Climbed",
    getValue: (run) => run.floorsClimbed,
  },
  {
    id: "elitesEncountered",
    label: "Elites Encountered",
    getValue: (run) => run.elitesEncountered,
  },
  {
    id: "overallEncounters",
    label: "Overall Encounters",
    getValue: (run) => run.overallEncounters,
  },
  {
    id: "restSitesVisited",
    label: "No. of Rest Sites",
    getValue: (run) => run.restSitesVisited,
  },
  {
    id: "maxHealth",
    label: "Max Health for the Run",
    getValue: (run) => run.maxHealth,
  },
] as const;

const SCATTER_METRIC_BY_ID = new Map(
  RUN_SCATTER_METRICS.map((metric) => [metric.id, metric] as const)
);

export function getScatterMetricDefinition(metricId: ScatterMetricId): ScatterMetricDefinition {
  return SCATTER_METRIC_BY_ID.get(metricId) ?? SCATTER_METRIC_BY_ID.get(DEFAULT_SCATTER_X_METRIC)!;
}

export function coerceScatterMetricId(
  rawValue: string | null | undefined,
  fallback: ScatterMetricId
): ScatterMetricId {
  return rawValue && SCATTER_METRIC_BY_ID.has(rawValue as ScatterMetricId)
    ? (rawValue as ScatterMetricId)
    : fallback;
}
