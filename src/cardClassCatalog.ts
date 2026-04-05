export type CardPool = "ironclad" | "silent" | "defect" | "necrobinder" | "regent" | "colorless";

const CARD_BASE_IDS_BY_POOL: Record<CardPool, string> = {
  ironclad: `
    aggression anger armaments ashen_strike barricade bash battle_trance blood_wall bloodletting
    bludgeon body_slam brand break breakthrough bully burning_pact cascade cinder colossus
    conflagration corruption crimson_mantle cruelty dark_embrace defend_ironclad demon_form
    demonic_shield dismantle dominate drum_of_battle evil_eye expect_a_fight feed feel_no_pain
    fiend_fire fight_me flame_barrier forgotten_ritual grapple havoc headbutt hellraiser
    hemokinesis howl_from_beyond impervious infernal_blade inferno inflame iron_wave juggernaut
    juggling mangle molten_fist offering one_two_punch pacts_end perfected_strike pillage
    pommel_strike primal_force pyre rage rampage rupture second_wind setup_strike shrug_it_off
    spite stampede stoke stomp stone_armor strike_ironclad sword_boomerang tank taunt
    tear_asunder thrash thunderclap tremble true_grit twin_strike unmovable unrelenting
    uppercut vicious whirlwind
  `,
  silent: `
    abrasive accelerant accuracy acrobatics adrenaline afterimage anticipate assassinate backflip
    backstab blade_dance blade_of_ink blur bouncing_flask bubble_bubble bullet_time burst
    calculated_gamble cloak_and_dagger corrosive_wave dagger_spray dagger_throw dash deadly_poison
    defend_silent deflect dodge_and_roll echoing_slash envenom escape_plan expertise expose
    fan_of_knives finisher flanking flechettes flick_flack follow_through footwork grand_finale
    hand_trick haze hidden_daggers infinite_blades knife_trap leading_strike leg_sweep malaise
    master_planner memento_mori mirage murder neutralize nightmare noxious_fumes outbreak
    phantom_blades piercing_wail pinpoint poisoned_stab pounce precise_cut predator prepared
    reflex ricochet serpent_form shadow_step shadowmeld skewer slice snakebite sneaky speedster
    storm_of_steel strangle strike_silent sucker_punch suppress survivor tactician the_hunt
    tools_of_the_trade tracking untouchable up_my_sleeve well_laid_plans wraith_form
  `,
  defect: `
    adaptive_strike all_for_one ball_lightning barrage beam_cell biased_cognition boost_away
    boot_sequence buffer bulk_up capacitor chaos charge_battery chill claw cold_snap compact
    compile_driver consuming_shadow coolant coolheaded creative_ai darkness defend_defect
    defragment double_energy dualcast echo_form energy_surge feral fight_through flak_cannon
    focused_strike ftl fusion genetic_algorithm glacier glasswork go_for_the_eyes gunk_up
    hailstorm helix_drill hologram hotfix hyperbeam ice_lance ignition iteration leap
    lightning_rod loop machine_learning meteor_strike modded momentum_strike multi_cast null
    overclock quadcast rainbow reboot refract rocket_punch scavenge scrape shadow_shield
    shatter signal_boost skim smokestack spinner storm strike_defect subroutine sunder
    supercritical sweeping_beam synchronize synthesis tempest tesla_coil thunder
    trash_to_treasure turbo uproar voltaic white_noise zap
  `,
  necrobinder: `
    afterlife banshees_cry blight_strike bodyguard bone_shards borrowed_time bury calcify
    call_of_the_void capture_spirit cleanse countdown danse_macabre death_march deathbringer
    deaths_door debilitate defend_necrobinder defile defy delay demesne devour_life dirge
    drain_power dredge eidolon end_of_days enfeebling_touch eradicate fear fetch flatten
    forbidden_grimoire friendship glimpse_beyond grave_warden graveblast hang haunt high_five
    invoke legion_of_bone lethality melancholy misery necro_mastery negative_pulse neurosurge
    no_escape oblivion pagestorm parse poke protector pull_aggro pull_from_below putrefy
    rattle reanimate reap reaper_form reave right_hand_hand sacrifice scourge sculpting_strike
    seance sentry_mode severance shared_fate shroud sic_em sleight_of_flesh snap soul_storm
    sow spirit_of_ash spur squeeze strike_necrobinder the_scythe times_up transfigure
    undeath unleash veilpiercer wisp
  `,
  regent: `
    alignment arsenal astral_pulse beat_into_shape begone big_bang black_hole bombardment
    bulwark bundle_of_joy celestial_might charge child_of_the_stars cloak_of_stars
    collision_course comet conqueror convergence cosmic_indifference crash_landing crescent_spear
    crush_under decisions_decisions defend_regent devastate dying_star falling_star
    foregone_conclusion furnace gamma_blast gather_light genesis glimmer glitterstream glow
    guards guiding_star hammer_time heavenly_drill hegemony heirloom_hammer hidden_cache
    i_am_invincible kingly_kick kingly_punch knockout_blow know_thy_place largesse lunar_blast
    make_it_so manifest_authority meteor_shower monarchs_gaze monologue neutron_aegis orbit
    pale_blue_dot parry particle_wall patter photon_cut pillar_of_creation prophesize quasar
    radiate refine_blade reflect resonance royal_gamble royalties seeking_edge seven_stars
    shining_strike solar_strike spectrum_shift spoils_of_battle stardust strike_regent
    summon_forth supermassive sword_sage terraforming the_sealed_throne the_smith tyranny
    venerate void_form wrought_in_war
  `,
  colorless: `
    alchemize anointed automation beacon_of_hope beat_down believe_in_you bolas calamity
    catastrophe coordinate dark_shackles discovery dramatic_entrance entropy equilibrium
    eternal_armor fasten finesse fisticuffs flash_of_steel gang_up gold_axe hand_of_greed
    hidden_gem huddle_up impatience intercept jack_of_all_trades jackpot knockdown lift
    master_of_strategy mayhem mimic mind_blast nostalgia omnislice panache panic_button
    prep_time production prolong prowess purity rally rend restlessness rolling_boulder salvo
    scrawl secret_technique secret_weapon seeker_strike shockwave splash stratagem tag_team
    the_bomb the_gambit thinking_ahead thrumming_hatchet ultimate_defend ultimate_strike volley
  `,
};

const cardPoolByBaseId = new Map<string, CardPool>();

for (const pool of Object.keys(CARD_BASE_IDS_BY_POOL) as CardPool[]) {
  for (const baseId of CARD_BASE_IDS_BY_POOL[pool].trim().split(/\s+/)) {
    cardPoolByBaseId.set(baseId, pool);
  }
}

export function getCardPool(cardId: string): CardPool | undefined {
  return cardPoolByBaseId.get(cardId.toLowerCase().replace(/^card\./, ""));
}
