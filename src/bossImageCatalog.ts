const ceremonialBeastImageUrl = new URL("./assets/boss-icons/ceremonial_beast.webp", import.meta.url).toString();
const crusherImageUrl = new URL("./assets/boss-icons/crusher.webp", import.meta.url).toString();
const doorImageUrl = new URL("./assets/boss-icons/door.webp", import.meta.url).toString();
const doormakerImageUrl = new URL("./assets/boss-icons/doormaker.webp", import.meta.url).toString();
const kaiserCrabImageUrl = new URL("./assets/boss-icons/kaiser_crab.png", import.meta.url).toString();
const kinFollowerImageUrl = new URL("./assets/boss-icons/kin_follower.webp", import.meta.url).toString();
const kinPriestImageUrl = new URL("./assets/boss-icons/kin_priest.webp", import.meta.url).toString();
const knowledgeDemonImageUrl = new URL("./assets/boss-icons/knowledge_demon.webp", import.meta.url).toString();
const lagavulinMatriarchImageUrl = new URL(
  "./assets/boss-icons/lagavulin_matriarch.webp",
  import.meta.url
).toString();
const queenImageUrl = new URL("./assets/boss-icons/queen.webp", import.meta.url).toString();
const rocketImageUrl = new URL("./assets/boss-icons/rocket.webp", import.meta.url).toString();
const soulFyshImageUrl = new URL("./assets/boss-icons/soul_fysh.webp", import.meta.url).toString();
const testSubjectImageUrl = new URL("./assets/boss-icons/test_subject.webp", import.meta.url).toString();
const theInsatiableImageUrl = new URL("./assets/boss-icons/the_insatiable.webp", import.meta.url).toString();
const torchHeadAmalgamImageUrl = new URL(
  "./assets/boss-icons/torch_head_amalgam.webp",
  import.meta.url
).toString();
const vantomImageUrl = new URL("./assets/boss-icons/vantom.webp", import.meta.url).toString();
const waterfallGiantImageUrl = new URL(
  "./assets/boss-icons/waterfall_giant.webp",
  import.meta.url
).toString();

const bossImageUrlBySlug = new Map<string, string>([
  ["ceremonial_beast", ceremonialBeastImageUrl],
  ["crusher", crusherImageUrl],
  ["door", doorImageUrl],
  ["doormaker", doormakerImageUrl],
  ["kaiser_crab", kaiserCrabImageUrl],
  ["kin_follower", kinFollowerImageUrl],
  ["kin_priest", kinPriestImageUrl],
  ["knowledge_demon", knowledgeDemonImageUrl],
  ["lagavulin_matriarch", lagavulinMatriarchImageUrl],
  ["queen", queenImageUrl],
  ["rocket", rocketImageUrl],
  ["soul_fysh", soulFyshImageUrl],
  ["test_subject", testSubjectImageUrl],
  ["the_insatiable", theInsatiableImageUrl],
  ["torch_head_amalgam", torchHeadAmalgamImageUrl],
  ["vantom", vantomImageUrl],
  ["waterfall_giant", waterfallGiantImageUrl],
]);

export function isBossEncounterId(encounterId: string): boolean {
  return encounterId.endsWith("_BOSS");
}

export function getBossImageUrl(encounterId: string): string | undefined {
  const slug = encounterId
    .toLowerCase()
    .replace(/^encounter\./, "")
    .replaceAll(".", "_")
    .replace(/_boss$/, "");

  return bossImageUrlBySlug.get(slug);
}
