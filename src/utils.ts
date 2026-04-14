import { GraphNodeKind } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function squareRootRadius(
  value: number,
  maxValue: number,
  minRadius: number = 0.05,
  maxRadius: number = 0.15,
  power: number = 0.5
): number {
  if (maxValue <= 0 || value <= 0) {
    return minRadius;
  }

  const normalized = Math.pow(value / maxValue, power);
  return clamp(minRadius + normalized * (maxRadius - minRadius), minRadius, maxRadius);
}

export function computeLayoutRadius(label: string, kind: GraphNodeKind, radius: number): number {
  if (kind === "character") {
    return radius;
  }

  const estimatedLines = clamp(Math.ceil(label.length / 10), 1, 3);
  const estimatedHalfWidth = radius * clamp(1.4 + 0.08 * Math.min(label.length, 10), 1.8, 2.2);
  const estimatedHalfHeight = radius * (0.95 + 0.55 * (estimatedLines - 1));
  return Math.max(radius, Math.hypot(estimatedHalfWidth, estimatedHalfHeight));
}

export function humanizeToken(token: string): string {
  const withoutPrefix = token.includes(".") ? token.split(".").slice(1).join(".") : token;
  return withoutPrefix
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatSecondsAsDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "No recorded win";
  }

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

export function sortByNumberThenLabel<T>(
  entries: T[],
  getNumber: (entry: T) => number,
  getLabel: (entry: T) => string
): T[] {
  return [...entries].sort((left, right) => {
    const numberDifference = getNumber(right) - getNumber(left);
    if (numberDifference !== 0) {
      return numberDifference;
    }

    return getLabel(left).localeCompare(getLabel(right));
  });
}
