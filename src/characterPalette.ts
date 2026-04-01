export type RgbaColor = [number, number, number, number];

export interface CharacterLegendItem {
  id: string;
  label: string;
  color: RgbaColor;
}

export const CHARACTER_LEGEND: CharacterLegendItem[] = [
  {
    id: "CHARACTER.IRONCLAD",
    label: "Ironclad",
    color: [0.78, 0.2, 0.2, 1],
  },
  {
    id: "CHARACTER.SILENT",
    label: "Silent",
    color: [0.18, 0.58, 0.29, 1],
  },
  {
    id: "CHARACTER.REGENT",
    label: "Regent",
    color: [0.86, 0.51, 0.15, 1],
  },
  {
    id: "CHARACTER.DEFECT",
    label: "Defect",
    color: [0.21, 0.47, 0.83, 1],
  },
  {
    id: "CHARACTER.NECROBINDER",
    label: "Necrobinder",
    color: [0.5, 0.31, 0.75, 1],
  },
];

const DEFAULT_CHARACTER_COLOR: RgbaColor = [0.44, 0.34, 0.24, 1];

const characterColorById = new Map(CHARACTER_LEGEND.map((item) => [item.id, item.color] as const));

export function getCharacterColor(characterId: string, fallbackColor: RgbaColor = DEFAULT_CHARACTER_COLOR): RgbaColor {
  const color = characterColorById.get(characterId) ?? fallbackColor;
  return [color[0], color[1], color[2], color[3]];
}

export function rgbaToCssColor([red, green, blue, alpha]: RgbaColor): string {
  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}
