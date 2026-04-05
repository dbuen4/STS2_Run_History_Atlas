const STS_GG_MONSTER_IMAGE_ROOT = "https://sts.gg/images/sts2/monsters";

function buildMonsterImageUrl(fileName: string): string {
  return `${STS_GG_MONSTER_IMAGE_ROOT}/${fileName}`;
}

const encounterImageUrlByBaseId = new Map<string, string>([
  ["AXEBOT", buildMonsterImageUrl("axe_bot.png")],
  ["BOWLBUG_ROCK", buildMonsterImageUrl("bowlbug_rock.png")],
  ["BYGONE_EFFIGY", buildMonsterImageUrl("bygone_effigy.png")],
  ["BYRDONIS", buildMonsterImageUrl("byrdonis.png")],
  ["CALCIFIED_CULTIST", buildMonsterImageUrl("cultists.png")],
  ["CHOMPER", buildMonsterImageUrl("chomper.png")],
  ["CORPSE_SLUG", buildMonsterImageUrl("corpse_slug.png")],
  ["CROSSBOW_RAIDER", buildMonsterImageUrl("crossbow_ruby_raider.png")],
  ["CUBEX_CONSTRUCT", buildMonsterImageUrl("cubex_construct.png")],
  ["DECIMILLIPEDE", buildMonsterImageUrl("decimillipede.png")],
  ["DEVOTED_SCULPTOR", buildMonsterImageUrl("devoted_sculptor.png")],
  ["ENTOMANCER", buildMonsterImageUrl("entomancer.png")],
  ["EXOSKELETON", buildMonsterImageUrl("exoskeleton.png")],
  ["FABRICATOR", buildMonsterImageUrl("fabricator.png")],
  ["FLAIL_KNIGHT", buildMonsterImageUrl("flailknight.png")],
  ["FLYCONID", buildMonsterImageUrl("flying_mushrooms.png")],
  ["FOGMOG", buildMonsterImageUrl("fogmog.png")],
  ["FOSSIL_STALKER", buildMonsterImageUrl("fossil_stalker.png")],
  ["FROG_KNIGHT", buildMonsterImageUrl("frog_knight.png")],
  ["FUZZY_WURM_CRAWLER", buildMonsterImageUrl("fuzzy_wurm_crawler.png")],
  ["GLOBE_HEAD", buildMonsterImageUrl("orb_head.png")],
  ["GREMLIN_MERC", buildMonsterImageUrl("gremlin_merc.png")],
  ["HAUNTED_SHIP", buildMonsterImageUrl("haunted_ship.png")],
  ["HUNTER_KILLER", buildMonsterImageUrl("hunterkiller.png")],
  ["INKLET", buildMonsterImageUrl("inklet.png")],
  ["INFESTED_PRISM", buildMonsterImageUrl("infested_prism.png")],
  ["LEAF_SLIME_M", buildMonsterImageUrl("leaf_slime_m.png")],
  ["LIVING_FOG", buildMonsterImageUrl("living_smog.png")],
  ["LOUSE_PROGENITOR", buildMonsterImageUrl("louse_progenitor.png")],
  ["MAGI_KNIGHT", buildMonsterImageUrl("magi_knight.png")],
  ["MAWLER", buildMonsterImageUrl("mawler.png")],
  ["MECHA_KNIGHT", buildMonsterImageUrl("mecha_knight.png")],
  ["MYTE", buildMonsterImageUrl("myte.png")],
  ["NIBBIT", buildMonsterImageUrl("nibbit.png")],
  ["OWL_MAGISTRATE", buildMonsterImageUrl("owl_magistrate.png")],
  ["OVICOPTER", buildMonsterImageUrl("ovicopter.png")],
  ["PHANTASMAL_GARDENER", buildMonsterImageUrl("phantasmal_gardener.png")],
  ["PHROG_PARASITE", buildMonsterImageUrl("phrog_parasite.png")],
  ["PUNCH_CONSTRUCT", buildMonsterImageUrl("punch_construct.png")],
  ["SCROLL_OF_BITING", buildMonsterImageUrl("scroll_of_biting.png")],
  ["SEAPUNK", buildMonsterImageUrl("seapunk.png")],
  ["SEWER_CLAM", buildMonsterImageUrl("sewer_clam.png")],
  ["SHRINKER_BEETLE", buildMonsterImageUrl("shrinker_beetle.png")],
  ["SKULKING_COLONY", buildMonsterImageUrl("skulkling_colomy.png")],
  ["SLIMED_BERSERKER", buildMonsterImageUrl("slimed_berserker.png")],
  ["SLUDGE_SPINNER", buildMonsterImageUrl("oil_spill.png")],
  ["SLUMBERING_BEETLE", buildMonsterImageUrl("slumberingbeetle.png")],
  ["SNAPPING_JAXFRUIT", buildMonsterImageUrl("snapping_jaxfruit.png")],
  ["SOUL_NEXUS", buildMonsterImageUrl("soulnexus.png")],
  ["SPINY_TOAD", buildMonsterImageUrl("spinytoad.png")],
  ["SPECTRAL_KNIGHT", buildMonsterImageUrl("spectral_knight.png")],
  ["TERROR_EEL", buildMonsterImageUrl("terror_eel.png")],
  ["THE_OBSCURA", buildMonsterImageUrl("the_obscura.png")],
  ["THIEVING_HOPPER", buildMonsterImageUrl("thievinghopper.png")],
  ["TOADPOLE", buildMonsterImageUrl("toadpole.png")],
  ["TUNNELER", buildMonsterImageUrl("tunneler.png")],
  ["TWO_TAILED_RAT", buildMonsterImageUrl("two_tailed_rat.png")],
  ["VINE_SHAMBLER", buildMonsterImageUrl("vine_shambler.png")],
  ["WRIGGLER", buildMonsterImageUrl("wriggler.png")],
]);

const encounterBaseIdAliases = new Map<string, string>([
  ["AXEBOTS", "AXEBOT"],
  ["BOWLBUGS", "BOWLBUG_ROCK"],
  ["CHOMPERS", "CHOMPER"],
  ["CONSTRUCT_MENAGERIE", "PUNCH_CONSTRUCT"],
  ["CORPSE_SLUGS", "CORPSE_SLUG"],
  ["CULTISTS", "CALCIFIED_CULTIST"],
  ["EXOSKELETONS", "EXOSKELETON"],
  ["INKLETS", "INKLET"],
  ["INFESTED_PRISMS", "INFESTED_PRISM"],
  ["KNIGHTS", "FLAIL_KNIGHT"],
  ["MYTES", "MYTE"],
  ["NIBBITS", "NIBBIT"],
  ["OVERGROWTH_CRAWLERS", "FUZZY_WURM_CRAWLER"],
  ["PHANTASMAL_GARDENERS", "PHANTASMAL_GARDENER"],
  ["RUBY_RAIDERS", "CROSSBOW_RAIDER"],
  ["SCROLLS_OF_BITING", "SCROLL_OF_BITING"],
  ["SLIMES", "LEAF_SLIME_M"],
  ["TOADPOLES", "TOADPOLE"],
  ["TWO_TAILED_RATS", "TWO_TAILED_RAT"],
]);

function getEncounterBaseId(encounterId: string): string {
  return encounterId
    .toUpperCase()
    .replace(/^ENCOUNTER\./, "")
    .replace(/(?:_EVENT_ENCOUNTER|_WEAK|_NORMAL|_ELITE|_BOSS)$/, "");
}

export function getEncounterImageUrl(encounterId: string): string | undefined {
  const baseId = getEncounterBaseId(encounterId);
  const imageKey = encounterBaseIdAliases.get(baseId) ?? baseId;
  return encounterImageUrlByBaseId.get(imageKey);
}
