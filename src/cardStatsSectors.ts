import { getCardPool } from "./cardClassCatalog";
import { CHARACTER_LEGEND, type CharacterLegendItem, type RgbaColor } from "./characterPalette";

export const COLORLESS_CARD_STATS_GROUP_ID = "colorless";

export type CardStatsSectorId = CharacterLegendItem["id"];
export type CardStatsGroupId = CardStatsSectorId | typeof COLORLESS_CARD_STATS_GROUP_ID;

export interface CardStatsSectorGuide {
  id: CardStatsSectorId;
  index: number;
  label: string;
  color: RgbaColor;
  angle: number;
  startAngle: number;
  endAngle: number;
}

const CHARACTER_ID_BY_POOL: Record<string, CardStatsSectorId | null> = {
  ironclad: "CHARACTER.IRONCLAD",
  silent: "CHARACTER.SILENT",
  defect: "CHARACTER.DEFECT",
  necrobinder: "CHARACTER.NECROBINDER",
  regent: "CHARACTER.REGENT",
  colorless: null,
};

export const CARD_STATS_CHARACTER_ORDER = CHARACTER_LEGEND.map((item) => item.id);
export const CARD_STATS_SECTOR_STEP = (Math.PI * 2) / CARD_STATS_CHARACTER_ORDER.length;

export function getCardStatsCharacterIdForPool(pool: string | undefined): CardStatsSectorId | null | undefined {
  if (pool === undefined) {
    return undefined;
  }

  return CHARACTER_ID_BY_POOL[pool];
}

export function getCardStatsGroupId(cardId: string): CardStatsGroupId | undefined {
  const pool = getCardPool(cardId);
  if (pool === undefined) {
    return undefined;
  }

  const characterId = getCardStatsCharacterIdForPool(pool);
  return characterId ?? COLORLESS_CARD_STATS_GROUP_ID;
}

export function getCardStatsSectorGuides(): CardStatsSectorGuide[] {
  return CHARACTER_LEGEND.map((item, index) => {
    const angle = -Math.PI / 2 + CARD_STATS_SECTOR_STEP * index;
    const halfStep = CARD_STATS_SECTOR_STEP / 2;

    return {
      id: item.id,
      index,
      label: item.label,
      color: item.color,
      angle,
      startAngle: angle - halfStep,
      endAngle: angle + halfStep,
    };
  });
}
