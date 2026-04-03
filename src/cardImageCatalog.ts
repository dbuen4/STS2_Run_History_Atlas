interface WebpackAssetContext {
  keys(): string[];
  (request: string): string;
}

declare const require: {
  context(directory: string, useSubdirectories?: boolean, regExp?: RegExp): WebpackAssetContext;
};

const offeringImageUrl = new URL("./assets/card-icons/offering.webp", import.meta.url).toString();
const fearImageUrl = new URL("./assets/card-icons/fear.webp", import.meta.url).toString();
const bombardmentImageUrl = new URL("./assets/card-icons/bombardment.webp", import.meta.url).toString();

const fallbackCardImageUrlById = new Map<string, string>([
  ["CARD.OFFERING", offeringImageUrl],
  ["CARD.FEAR", fearImageUrl],
  ["CARD.BOMBARDMENT", bombardmentImageUrl],
]);

function buildCardImageUrlById(): Map<string, string> {
  try {
    const context = require.context("./assets/card-icons", false, /\.webp$/);
    const imageUrlById = new Map<string, string>();

    for (const key of context.keys()) {
      const id = `CARD.${key
        .replace(/^\.\//, "")
        .replace(/\.webp$/, "")
        .toUpperCase()}`;
      imageUrlById.set(id, context(key));
    }

    for (const [id, imageUrl] of fallbackCardImageUrlById) {
      if (!imageUrlById.has(id)) {
        imageUrlById.set(id, imageUrl);
      }
    }

    return imageUrlById;
  } catch {
    return fallbackCardImageUrlById;
  }
}

const cardImageUrlById = buildCardImageUrlById();

export function getCardImageUrl(cardId: string): string | undefined {
  return cardImageUrlById.get(cardId);
}
