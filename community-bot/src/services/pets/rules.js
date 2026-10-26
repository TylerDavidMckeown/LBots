import { COSMETIC_SLOTS, ITEMS, RARITIES } from '../items.js';
import { randomInt, sample, weighted } from '../random.js';
import {
  ABILITIES, ABILITY_LEVELS, ADOPTION_PRICES, DESTINATIONS, EGGS, EXPLORE, SPECIES, STATS, TRAIT_COUNT, TRAITS, VARIANTS,
} from './catalogue.js';

/**
 * Pure pet rules: levels, needs over time, stats, XP gains and reward rolls.
 * Randomness is injected (`rng`) so outcomes are server-side and testable.
 */

const MINUTE = 60_000;

export const MAX_PET_LEVEL = 60;

/**
 * Needs are friendly: energy refills on its own, happiness fades slowly and never below
 * the floor, and nothing is ever lost because a pet was left alone.
 */
export const NEEDS = Object.freeze({
  start: { happiness: 70, energy: 100 },
  energyRegenMs: 3 * MINUTE,
  napRegenMs: 15_000,
  minNapMs: 5 * MINUTE,
  happinessDecayMs: 120 * MINUTE,
  happinessFloor: 40,
});

export const CARE = Object.freeze({
  kibble: { name: 'Kibble', emoji: '🥣', happiness: 10, cooldownMs: 30 * MINUTE },
  play: { energy: 5, happiness: 12, xp: [12, 20], cooldownMs: 10 * MINUTE },
  train: { energy: 20, xp: 25, cooldownMs: 15 * MINUTE },
});

/** Happiness gives a pet XP bonus. There is no penalty for low happiness. */
export const MOODS = Object.freeze([
  { min: 80, label: 'Overjoyed', emoji: '🤩', xpBonus: 0.2 },
  { min: 60, label: 'Happy', emoji: '😊', xpBonus: 0.1 },
  { min: 40, label: 'Content', emoji: '🙂', xpBonus: 0 },
  { min: 0, label: 'Lonely', emoji: '🥺', xpBonus: 0 },
]);
export const moodFor = (happiness) => MOODS.find((mood) => happiness >= mood.min);

/** Pet level n needs 20·(n−1)² XP: level 15 ≈ 3,900 XP, level 35 ≈ 23,000 XP. */
export const petLevelForXp = (xp) => Math.min(MAX_PET_LEVEL, 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 20)));
export const xpForPetLevel = (level) => 20 * (level - 1) ** 2;

export const hasTrait = (pet, trait) => pet.traits.includes(trait);
const napRegenMs = (pet) => NEEDS.napRegenMs / (hasTrait(pet, 'sleepy') ? 2 : 1);

/**
 * Happiness, energy and nap state as of `now`. Pure: returns the fields to store.
 * `needs_at` keeps the unfinished part of the current energy interval, so frequent
 * updates never stall energy recovery.
 */
export function currentNeeds(pet, now) {
  const since = pet.needs_at;
  const elapsed = Math.max(0, now - since);
  let energy = pet.energy;
  let status = pet.status;
  let busyUntil = pet.busy_until;
  let remainder;
  if (pet.status === 'sleeping') {
    const napped = Math.max(0, Math.min(now, pet.busy_until) - since);
    const awake = Math.max(0, now - Math.max(since, pet.busy_until));
    energy += Math.floor(napped / napRegenMs(pet)) + Math.floor(awake / NEEDS.energyRegenMs);
    remainder = awake > 0 ? awake % NEEDS.energyRegenMs : napped % napRegenMs(pet);
    if (now >= pet.busy_until) {
      status = 'idle';
      busyUntil = null;
    }
  } else {
    energy += Math.floor(elapsed / NEEDS.energyRegenMs);
    remainder = elapsed % NEEDS.energyRegenMs;
  }
  const faded = Math.floor(elapsed / (NEEDS.happinessDecayMs * (hasTrait(pet, 'gentle') ? 2 : 1)));
  const happiness = pet.happiness > NEEDS.happinessFloor ? Math.max(NEEDS.happinessFloor, pet.happiness - faded) : pet.happiness;
  energy = Math.min(100, energy);
  return { energy, happiness, status, busy_until: busyUntil, needs_at: energy >= 100 ? now : now - remainder };
}

/** How long a nap takes to refill energy. */
export const napDuration = (pet) => Math.max(NEEDS.minNapMs, (100 - pet.energy) * napRegenMs(pet));

/** Energy an activity costs this pet (Energetic pets use less). */
export const energyCost = (pet, base) => (hasTrait(pet, 'energetic') ? Math.ceil(base * 0.75) : base);

/** Pet XP for an activity: the happiness bonus and the server multiplier applied. */
export function petXpGain(base, pet, settings) {
  if (!(base > 0)) return 0;
  return Math.max(1, Math.round(base * (1 + moodFor(pet.happiness).xpBonus) * (settings.petXpPercent / 100)));
}

export const playHappiness = (pet) => Math.round(CARE.play.happiness * (hasTrait(pet, 'playful') ? 1.25 : 1));
export const playXp = (pet, rng) => Math.round(randomInt(rng, ...CARE.play.xp) * (hasTrait(pet, 'playful') ? 1.25 : 1));
export const trainXp = (pet) => Math.round(CARE.train.xp * (hasTrait(pet, 'studious') ? 1.25 : 1));
export const foodHappiness = (pet, amount) => Math.round(amount * (hasTrait(pet, 'foodie') ? 1.5 : 1));

/** Points that can be trained into each stat at this level and stage. */
export const trainingCap = (level, stage) => 1 + Math.floor(level / 2) + (stage - 1) * 2;

/** Battle stats: species base, level growth, training, evolution and traits. */
export function petStats(pet) {
  const level = petLevelForXp(pet.xp);
  const { base } = SPECIES[pet.species];
  return Object.fromEntries(Object.keys(STATS).map((stat) => [stat,
    base[stat] + Math.floor((base[stat] * (level - 1)) / 12) + (pet.training[stat] ?? 0) + (pet.stage - 1) * 3
      + (stat === 'agility' && hasTrait(pet, 'swift') ? 3 : 0),
  ]));
}

export const unlockedAbilities = (pet) => SPECIES[pet.species].abilities.filter((_, i) => petLevelForXp(pet.xp) >= ABILITY_LEVELS[i]);

export const stageName = (pet) => SPECIES[pet.species].stages[pet.stage - 1];
export const displayName = (pet) => pet.name ?? stageName(pet);
export const petLabel = (pet) => `${SPECIES[pet.species].emoji} ${displayName(pet)}`;
export const speciesLabel = (pet) => `${VARIANTS[pet.variant].prefix}${stageName(pet)}`;

export function slotUnlocked(pet, slot) {
  const { unlock } = COSMETIC_SLOTS[slot];
  return petLevelForXp(pet.xp) >= (unlock.level ?? 1) && pet.stage >= (unlock.stage ?? 1);
}

/** What reaching new levels opened up, for level-up messages. */
export function petLevelUnlocks(pet, levelBefore, levelAfter) {
  const reached = (level) => level > levelBefore && level <= levelAfter;
  const unlocks = [];
  SPECIES[pet.species].abilities.forEach((key, i) => {
    if (i > 0 && reached(ABILITY_LEVELS[i])) unlocks.push(`New ability: ${ABILITIES[key].emoji} ${ABILITIES[key].name}`);
  });
  for (const def of Object.values(COSMETIC_SLOTS)) {
    if (!def.unlock.stage && def.unlock.level > 1 && reached(def.unlock.level)) unlocks.push(`${def.label} accessory slot`);
  }
  for (const destination of Object.values(DESTINATIONS)) {
    if (destination.minLevel > 1 && reached(destination.minLevel)) unlocks.push(`Expeditions to ${destination.emoji} ${destination.name}`);
  }
  return unlocks;
}

/** Adoption centre price, or null when the species only hatches from eggs. */
export function adoptionPrice(species, settings) {
  const base = ADOPTION_PRICES[SPECIES[species].rarity];
  return base === undefined ? null : Math.round((base * settings.petPricePercent) / 100);
}

/** Colour variant and traits for a new pet. */
export function rollNewPet(species, rng) {
  const rarity = SPECIES[species].rarity;
  const variant = weighted(rng, Object.entries(VARIANTS).map(([key, v]) => ({ key, weight: v.weight }))).key;
  const eligible = Object.keys(TRAITS).filter((key) => !TRAITS[key].minRarity || RARITIES[rarity].order >= RARITIES[TRAITS[key].minRarity].order);
  return { variant, traits: sample(rng, eligible, TRAIT_COUNT[rarity]) };
}

/** An egg's odds as [{ species, chance }] with chances adding up to 1, likeliest first. */
export function eggOdds(egg) {
  const def = EGGS[egg];
  const entries = def.species
    ? Object.entries(def.species)
    : Object.entries(def.rarities).flatMap(([rarity, weight]) => {
      const pool = Object.keys(SPECIES).filter((key) => SPECIES[key].rarity === rarity);
      return pool.map((key) => [key, weight / pool.length]);
    });
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return entries.map(([species, weight]) => ({ species, chance: weight / total })).sort((a, b) => b.chance - a.chance);
}

export const hatch = (egg, rng) => weighted(rng, eggOdds(egg), (entry) => entry.chance).species;

const isRareFind = (item) => RARITIES[ITEMS[item].rarity].order >= RARITIES.rare.order;

/** One find from a loot table. Lucky pets make rare finds 50% more likely. */
export function rollLoot(rng, table, lucky = false) {
  return weighted(rng, table, (entry) => entry.weight * (lucky && isRareFind(entry.item) ? 1.5 : 1)).item;
}

function merge(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([item, quantity]) => ({ item, quantity }));
}

export function rollExplore(pet, rng) {
  const coins = Math.round(randomInt(rng, ...EXPLORE.coins) * (hasTrait(pet, 'curious') ? 1.2 : 1));
  const xp = randomInt(rng, ...EXPLORE.xp);
  const items = rng() < EXPLORE.findChance ? [{ item: rollLoot(rng, EXPLORE.loot, hasTrait(pet, 'lucky')), quantity: 1 }] : [];
  return { coins, xp, items };
}

/** Expedition rewards. Coins grow 1% per pet level (up to 50%). */
export function rollExpedition(pet, destination, rng) {
  const def = DESTINATIONS[destination];
  const level = petLevelForXp(pet.xp);
  const coins = Math.round(randomInt(rng, ...def.coins) * (1 + Math.min(level, 50) * 0.01) * (hasTrait(pet, 'curious') ? 1.2 : 1));
  const found = [];
  for (let i = 0; i < def.rolls; i += 1) {
    if (rng() < def.lootChance) found.push(rollLoot(rng, def.loot, hasTrait(pet, 'lucky')));
  }
  return { coins, xp: def.xp, items: merge(found) };
}

/** A loot table's odds for one roll as [{ item, chance }], given the chance of finding anything. */
export function lootOdds(table, findChance) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  return table.map((entry) => ({ item: entry.item, chance: (entry.weight / total) * findChance }));
}

/** Pet names: 2–24 letters, numbers, spaces and simple punctuation. No mentions, links or markdown. */
export function cleanPetName(input) {
  const name = String(input ?? '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N}][\p{L}\p{N} '\-.!?]{1,23}$/u.test(name) ? name : null;
}
