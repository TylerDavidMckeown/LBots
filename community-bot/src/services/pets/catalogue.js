/**
 * The pet catalogue: species, abilities, traits, variants, expedition destinations,
 * eggs and collection milestones. Keys are stored in the database, so never rename one.
 * New species, destinations and abilities can be added here without other changes.
 */

const MINUTE = 60_000;

export const STATS = Object.freeze({
  power: { label: 'Power', emoji: '⚔️', description: 'Damage dealt in battles' },
  guard: { label: 'Guard', emoji: '🛡️', description: 'Damage resisted in battles' },
  agility: { label: 'Agility', emoji: '💨', description: 'Moves first and lands critical hits' },
  vitality: { label: 'Vitality', emoji: '❤️', description: 'Health in battles' },
});

/**
 * Battle abilities. kind: strike (power × damage), pierce (strike that ignores half the
 * target's guard and any shield), drain (strike that heals by `heal` × damage dealt),
 * heal (restores `heal` × max health), shield (blocks `block` of the next hit),
 * focus (the next damaging move deals `boost` × damage). Cooldowns count the pet's own turns.
 */
export const ABILITIES = Object.freeze({
  hop_kick: { name: 'Hop Kick', emoji: '🦶', kind: 'strike', power: 1.4, cooldown: 2 },
  clover_heal: { name: 'Clover Heal', emoji: '🍀', kind: 'heal', heal: 0.25, cooldown: 3 },
  stampede: { name: 'Stampede', emoji: '🐾', kind: 'strike', power: 1.9, cooldown: 3 },
  shell_bash: { name: 'Shell Bash', emoji: '🐚', kind: 'strike', power: 1.3, cooldown: 2 },
  stone_shell: { name: 'Stone Shell', emoji: '🪨', kind: 'shield', block: 0.75, cooldown: 3 },
  rockslide: { name: 'Rockslide', emoji: '⛰️', kind: 'strike', power: 1.85, cooldown: 3 },
  quick_bite: { name: 'Quick Bite', emoji: '🦷', kind: 'strike', power: 1.35, cooldown: 2 },
  scout: { name: 'Scout Ahead', emoji: '🔭', kind: 'focus', boost: 1.8, cooldown: 3 },
  pounce: { name: 'Pounce', emoji: '💥', kind: 'pierce', power: 1.7, cooldown: 3 },
  bounce: { name: 'Bounce', emoji: '🫧', kind: 'strike', power: 1.3, cooldown: 2 },
  lucky_charm: { name: 'Lucky Charm', emoji: '🎲', kind: 'focus', boost: 2, cooldown: 4 },
  gooey_burst: { name: 'Gooey Burst', emoji: '🟩', kind: 'drain', power: 1.4, heal: 0.5, cooldown: 3 },
  fire_fang: { name: 'Fire Fang', emoji: '🔥', kind: 'strike', power: 1.5, cooldown: 2 },
  warm_up: { name: 'Warm Up', emoji: '♨️', kind: 'focus', boost: 1.7, cooldown: 3 },
  flame_tail: { name: 'Flame Tail', emoji: '🌋', kind: 'pierce', power: 1.8, cooldown: 3 },
  ice_slide: { name: 'Ice Slide', emoji: '❄️', kind: 'strike', power: 1.35, cooldown: 2 },
  snow_wall: { name: 'Snow Wall', emoji: '🧊', kind: 'shield', block: 0.75, cooldown: 3 },
  blizzard: { name: 'Blizzard', emoji: '🌨️', kind: 'strike', power: 1.9, cooldown: 3 },
  shadow_swipe: { name: 'Shadow Swipe', emoji: '🌑', kind: 'strike', power: 1.45, cooldown: 2 },
  vanish: { name: 'Vanish', emoji: '👻', kind: 'shield', block: 0.9, cooldown: 4 },
  night_strike: { name: 'Night Strike', emoji: '🌙', kind: 'pierce', power: 1.9, cooldown: 3 },
  gust: { name: 'Gust', emoji: '🌬️', kind: 'strike', power: 1.4, cooldown: 2 },
  focus_feathers: { name: 'Focus Feathers', emoji: '🪶', kind: 'focus', boost: 1.8, cooldown: 3 },
  thunderclap: { name: 'Thunderclap', emoji: '⚡', kind: 'strike', power: 2, cooldown: 4 },
  ember_breath: { name: 'Ember Breath', emoji: '🔥', kind: 'strike', power: 1.5, cooldown: 2 },
  dragon_scales: { name: 'Dragon Scales', emoji: '🛡️', kind: 'shield', block: 0.7, cooldown: 3 },
  inferno: { name: 'Inferno', emoji: '☄️', kind: 'drain', power: 1.7, heal: 0.4, cooldown: 3 },
  star_horn: { name: 'Star Horn', emoji: '🦄', kind: 'strike', power: 1.45, cooldown: 2 },
  moon_blessing: { name: 'Moon Blessing', emoji: '🌕', kind: 'heal', heal: 0.3, cooldown: 3 },
  cosmic_ray: { name: 'Cosmic Ray', emoji: '🌌', kind: 'pierce', power: 1.9, cooldown: 3 },
});

/** Pet levels at which a species' first, second and third abilities unlock. */
export const ABILITY_LEVELS = Object.freeze([1, 10, 25]);

/**
 * Species. Base stats add up to 24 (common) through 29 (mythic), so rarity is a small edge;
 * levels, training and traits matter more. `starter` species can be a member's free first pet.
 */
export const SPECIES = Object.freeze({
  meadow_bunny: {
    name: 'Meadow Bunny', emoji: '🐰', rarity: 'common', theme: 'Friendly starter', starter: true,
    stages: ['Meadow Bunny', 'Meadow Hare', 'Meadow Guardian'],
    base: { power: 5, guard: 6, agility: 8, vitality: 5 }, abilities: ['hop_kick', 'clover_heal', 'stampede'],
  },
  pebble_turtle: {
    name: 'Pebble Turtle', emoji: '🐢', rarity: 'common', theme: 'Steady defender', starter: true,
    stages: ['Pebble Turtle', 'Boulder Tortoise', 'Mountain Shell'],
    base: { power: 5, guard: 9, agility: 3, vitality: 7 }, abilities: ['shell_bash', 'stone_shell', 'rockslide'],
  },
  copper_fox: {
    name: 'Copper Fox', emoji: '🦊', rarity: 'uncommon', theme: 'Explorer', starter: true,
    stages: ['Copper Fox', 'Bronze Fox', 'Gilded Fox'],
    base: { power: 7, guard: 5, agility: 8, vitality: 5 }, abilities: ['quick_bite', 'scout', 'pounce'],
  },
  lucky_slime: {
    name: 'Lucky Slime', emoji: '🫧', rarity: 'uncommon', theme: 'Fortune', starter: true,
    stages: ['Lucky Slime', 'Fortune Slime', 'Jackpot Jelly'],
    base: { power: 5, guard: 7, agility: 5, vitality: 8 }, abilities: ['bounce', 'lucky_charm', 'gooey_burst'],
  },
  ember_fox: {
    name: 'Ember Fox', emoji: '🔥', rarity: 'rare', theme: 'Adventure',
    stages: ['Ember Fox', 'Blaze Fox', 'Inferno Kitsune'],
    base: { power: 9, guard: 5, agility: 7, vitality: 5 }, abilities: ['fire_fang', 'warm_up', 'flame_tail'],
  },
  frost_penguin: {
    name: 'Frost Penguin', emoji: '🐧', rarity: 'rare', theme: 'Winter',
    stages: ['Frost Penguin', 'Glacier Penguin', 'Emperor of Ice'],
    base: { power: 6, guard: 8, agility: 5, vitality: 7 }, abilities: ['ice_slide', 'snow_wall', 'blizzard'],
  },
  shadow_cat: {
    name: 'Shadow Cat', emoji: '🐈‍⬛', rarity: 'epic', theme: 'Stealth',
    stages: ['Shadow Cat', 'Night Stalker', 'Umbral Panther'],
    base: { power: 8, guard: 5, agility: 9, vitality: 5 }, abilities: ['shadow_swipe', 'vanish', 'night_strike'],
  },
  storm_owl: {
    name: 'Storm Owl', emoji: '🦉', rarity: 'epic', theme: 'Wisdom',
    stages: ['Storm Owl', 'Thunder Owl', 'Tempest Sage'],
    base: { power: 7, guard: 6, agility: 8, vitality: 6 }, abilities: ['gust', 'focus_feathers', 'thunderclap'],
  },
  baby_dragon: {
    name: 'Baby Dragon', emoji: '🐉', rarity: 'legendary', theme: 'Fire',
    stages: ['Baby Dragon', 'Young Dragon', 'Elder Dragon'],
    base: { power: 9, guard: 7, agility: 5, vitality: 7 }, abilities: ['ember_breath', 'dragon_scales', 'inferno'],
  },
  celestial_unicorn: {
    name: 'Celestial Unicorn', emoji: '🦄', rarity: 'mythic', theme: 'Magical',
    stages: ['Celestial Unicorn', 'Starlight Unicorn', 'Astral Alicorn'],
    base: { power: 7, guard: 7, agility: 7, vitality: 8 }, abilities: ['star_horn', 'moon_blessing', 'cosmic_ray'],
  },
});

/** Coins to adopt from the adoption centre. Legendary and mythic pets only hatch from eggs. */
export const ADOPTION_PRICES = Object.freeze({ common: 2_000, uncommon: 6_000, rare: 20_000, epic: 60_000 });

/** Cosmetic colour variants, rolled at adoption. Weights are out of 1,000. */
export const VARIANTS = Object.freeze({
  classic: { label: 'Classic', prefix: '', weight: 900 },
  pastel: { label: 'Pastel', prefix: '🎨 Pastel ', weight: 80 },
  shiny: { label: 'Shiny', prefix: '✨ Shiny ', weight: 17 },
  prismatic: { label: 'Prismatic', prefix: '🌈 Prismatic ', weight: 3 },
});

/** Traits, rolled at adoption. `minRarity` keeps the strongest perks for rarer pets. */
export const TRAITS = Object.freeze({
  brave: { name: 'Brave', emoji: '🦁', description: '+8% battle damage' },
  sturdy: { name: 'Sturdy', emoji: '🪨', description: '+10% battle health' },
  swift: { name: 'Swift', emoji: '💨', description: '+3 agility' },
  playful: { name: 'Playful', emoji: '🎾', description: '+25% XP and happiness from playing' },
  foodie: { name: 'Foodie', emoji: '🍽️', description: '+50% happiness from food' },
  sleepy: { name: 'Sleepy', emoji: '😴', description: 'Naps restore energy twice as fast' },
  studious: { name: 'Studious', emoji: '📚', description: '+25% XP from training' },
  curious: { name: 'Curious', emoji: '🔍', description: '+20% coins from exploring and expeditions' },
  energetic: { name: 'Energetic', emoji: '⚡', description: 'Activities use 25% less energy' },
  gentle: { name: 'Gentle', emoji: '🌸', description: 'Happiness fades half as fast' },
  lucky: { name: 'Lucky', emoji: '🍀', description: 'Rare finds are 50% more likely', minRarity: 'rare' },
});

/** How many traits a pet of each rarity rolls. */
export const TRAIT_COUNT = Object.freeze({ common: 1, uncommon: 1, rare: 2, epic: 2, legendary: 2, mythic: 3 });

/**
 * Expeditions. Each loot roll finds something with `lootChance`, picked by weight; rare
 * finds (rare rarity and above) are more likely with the Lucky trait.
 */
export const DESTINATIONS = Object.freeze({
  forest: {
    name: 'Enchanted Forest', emoji: '🌳', durationMs: 10 * MINUTE, minLevel: 1, energy: 15, coins: [40, 120], xp: 30, rolls: 1, lootChance: 0.8,
    loot: [
      { item: 'berry_treat', weight: 40 }, { item: 'energy_herb', weight: 35 }, { item: 'acorn_charm', weight: 20 },
      { item: 'bow_tie', weight: 3 }, { item: 'mystery_egg', weight: 2 },
    ],
  },
  mountains: {
    name: 'Frozen Mountains', emoji: '🏔️', durationMs: 30 * MINUTE, minLevel: 5, energy: 25, coins: [120, 300], xp: 70, rolls: 2, lootChance: 0.75,
    loot: [
      { item: 'frost_fish', weight: 35 }, { item: 'snow_globe', weight: 25 }, { item: 'energy_herb', weight: 20 },
      { item: 'evo_crystal', weight: 8 }, { item: 'explorer_scarf', weight: 4 }, { item: 'mystery_egg', weight: 3 },
    ],
  },
  ruins: {
    name: 'Ancient Ruins', emoji: '🏛️', durationMs: 45 * MINUTE, minLevel: 10, energy: 30, coins: [180, 450], xp: 100, rolls: 2, lootChance: 0.75,
    loot: [
      { item: 'puzzle_fragment', weight: 30 }, { item: 'ancient_relic', weight: 18 }, { item: 'evo_crystal', weight: 12 },
      { item: 'golden_apple', weight: 6 }, { item: 'wizard_hat', weight: 3 }, { item: 'mystery_egg', weight: 3 },
    ],
  },
  lair: {
    name: 'Dragon\'s Lair', emoji: '🌋', durationMs: 60 * MINUTE, minLevel: 15, energy: 35, coins: [250, 650], xp: 140, rolls: 2, lootChance: 0.75,
    loot: [
      { item: 'dragon_scale', weight: 25 }, { item: 'golden_apple', weight: 12 }, { item: 'evo_crystal', weight: 12 },
      { item: 'star_shard', weight: 5 }, { item: 'dragon_wings', weight: 1.5 }, { item: 'dragon_egg', weight: 1.5 },
    ],
  },
  starfall: {
    name: 'Starfall Valley', emoji: '🌠', durationMs: 90 * MINUTE, minLevel: 25, energy: 40, coins: [350, 900], xp: 200, rolls: 3, lootChance: 0.7,
    loot: [
      { item: 'stardust_jar', weight: 25 }, { item: 'golden_apple', weight: 12 }, { item: 'star_shard', weight: 9 },
      { item: 'star_collar', weight: 4 }, { item: 'fairy_wings', weight: 3 }, { item: 'golden_crown', weight: 1 }, { item: 'celestial_egg', weight: 1 },
    ],
  },
});

/** A short instant outing: small rewards, a little energy and a cooldown per pet. */
export const EXPLORE = Object.freeze({
  energy: 10, cooldownMs: 15 * MINUTE, coins: [15, 60], xp: [10, 20], findChance: 0.35,
  loot: [
    { item: 'berry_treat', weight: 45 }, { item: 'energy_herb', weight: 35 }, { item: 'acorn_charm', weight: 15 },
    { item: 'frost_fish', weight: 4 }, { item: 'golden_apple', weight: 1 },
  ],
});

/**
 * Egg odds. `rarities` picks a rarity, then a species of that rarity at random;
 * `species` picks a species directly. Both are shown to members before hatching.
 */
export const EGGS = Object.freeze({
  mystery_egg: { rarities: { common: 40, uncommon: 30, rare: 18, epic: 9, legendary: 2.5, mythic: 0.5 } },
  dragon_egg: { species: { baby_dragon: 60, ember_fox: 40 } },
  celestial_egg: { species: { celestial_unicorn: 40, storm_owl: 35, frost_penguin: 25 } },
});

/** Evolution requirements, by the stage being reached. */
export const EVOLUTION = Object.freeze({
  2: { level: 15, items: [{ item: 'evo_crystal', quantity: 1 }], coins: 2_500 },
  3: { level: 35, items: [{ item: 'star_shard', quantity: 2 }], coins: 10_000 },
});

/** Rewards for discovering different species (released pets still count). */
export const COLLECTION_MILESTONES = Object.freeze([
  { species: 3, coins: 1_000, items: [{ item: 'berry_treat', quantity: 5 }] },
  { species: 5, coins: 2_500, items: [{ item: 'mystery_egg', quantity: 1 }], title: 'pet_collector' },
  { species: 8, coins: 5_000, items: [{ item: 'flower_crown', quantity: 1 }] },
  { species: 10, coins: 10_000, items: [{ item: 'golden_crown', quantity: 1 }], title: 'menagerie_master', badge: 'full_collection' },
]);
