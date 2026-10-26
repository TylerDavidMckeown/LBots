import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from '@lyss/shared/errorReporter.js';
import { createGameWorld, getServices } from '../src/services/index.js';
import { ITEMS } from '../src/services/items.js';
import { BATTLE, battleAct, startBattle } from '../src/services/pets/battle.js';
import {
  ABILITIES, COLLECTION_MILESTONES, DESTINATIONS, EGGS, EXPLORE, SPECIES, TRAITS,
} from '../src/services/pets/catalogue.js';
import {
  CARE, cleanPetName, currentNeeds, eggOdds, lootOdds, NEEDS, petLevelForXp, petStats, rollExpedition, trainingCap, xpForPetLevel,
} from '../src/services/pets/rules.js';
import {
  abilitiesEmbed, battlePayload, collectionPayload, cosmeticsPayload, evolutionPayload, expeditionPanel, expeditionPayload,
  leaderboardPayload, profilePayload, statsEmbed,
} from '../src/features/petViews.js';
import { communityDb, economyDefaults, fakeCtx, seeded } from './helpers.js';

const G = 'guild';
const T0 = Date.UTC(2026, 9, 24, 12);
const MINUTE = 60_000;
const s = economyDefaults();

const isUserError = (pattern) => (error) => error instanceof UserError && pattern.test(error.message);

function setup(db = communityDb()) {
  const world = createGameWorld(db);
  const { economy, pets, inventory } = world;
  const fund = (userId, amount) => economy.credit({ guildId: G, userId, amount, type: 'test', settings: s, now: T0 });
  /** Adopts through the real confirmation flow. */
  const adopt = (userId, species, now = T0, rng = seeded(1)) => {
    const offer = pets.prepareAdoption({ guildId: G, userId, species, now, settings: s });
    return pets.confirmAdoption({ pendingId: offer.pendingId, userId, now, settings: s, rng });
  };
  const give = (userId, item, quantity = 1) => inventory.grant({ guildId: G, userId, item, quantity, type: 'test', now: T0 });
  const setXp = (petId, level) => db.prepare('UPDATE pets SET xp = ? WHERE id = ?').run(xpForPetLevel(level), petId);
  return { db, ...world, fund, adopt, give, setXp };
}

// ── Catalogue and rules ───────────────────────────────────────────────────

test('the catalogue is consistent: stats, abilities, loot, eggs and milestones all resolve', () => {
  const totals = { common: 24, uncommon: 25, rare: 26, epic: 27, legendary: 28, mythic: 29 };
  for (const [key, species] of Object.entries(SPECIES)) {
    const sum = Object.values(species.base).reduce((a, b) => a + b, 0);
    assert.equal(sum, totals[species.rarity], `${key} base stats`);
    assert.equal(species.stages.length, 3, key);
    assert.equal(species.abilities.length, 3, key);
    for (const ability of species.abilities) assert.ok(ABILITIES[ability], `${key}: ${ability}`);
  }
  for (const [key, destination] of Object.entries(DESTINATIONS)) {
    for (const { item } of destination.loot) assert.ok(ITEMS[item], `${key}: ${item}`);
  }
  for (const { item } of EXPLORE.loot) assert.ok(ITEMS[item], item);
  for (const egg of Object.keys(EGGS)) {
    assert.equal(ITEMS[egg].kind, 'egg');
    const total = eggOdds(egg).reduce((sum, e) => sum + e.chance, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${egg} odds add up to 100%`);
    for (const { species } of eggOdds(egg)) assert.ok(SPECIES[species], species);
  }
  for (const m of COLLECTION_MILESTONES) for (const { item } of m.items ?? []) assert.ok(ITEMS[item], item);
  assert.ok(COLLECTION_MILESTONES.at(-1).species <= Object.keys(SPECIES).length, 'the last milestone is reachable');
  const odds = lootOdds(DESTINATIONS.forest.loot, DESTINATIONS.forest.lootChance);
  assert.ok(Math.abs(odds.reduce((sum, o) => sum + o.chance, 0) - DESTINATIONS.forest.lootChance) < 1e-9);
});

test('needs: energy refills over time, naps refill faster, happiness fades but never below the floor', () => {
  const pet = { traits: [], energy: 40, happiness: 90, status: 'idle', busy_until: null, needs_at: T0 };
  const later = currentNeeds(pet, T0 + 30 * MINUTE);
  assert.equal(later.energy, 40 + 10, 'one point every 3 minutes');
  const nap = currentNeeds({ ...pet, status: 'sleeping', busy_until: T0 + 10 * MINUTE }, T0 + 5 * MINUTE);
  assert.equal(nap.energy, 40 + 20, 'one point every 15 seconds while napping');
  assert.equal(nap.status, 'sleeping');
  const woke = currentNeeds({ ...pet, status: 'sleeping', busy_until: T0 + MINUTE }, T0 + 2 * MINUTE);
  assert.equal(woke.status, 'idle', 'a finished nap wakes the pet');
  const forgotten = currentNeeds(pet, T0 + 30 * 24 * 60 * MINUTE);
  assert.equal(forgotten.happiness, NEEDS.happinessFloor, 'a month alone never drops below the floor');
  assert.equal(forgotten.energy, 100);
  // Frequent updates keep partial progress, so they never stall energy recovery.
  let current = pet;
  for (let t = T0 + MINUTE; t <= T0 + 30 * MINUTE; t += MINUTE) current = { ...current, ...currentNeeds(current, t) };
  assert.equal(current.energy, 50);
});

test('stats grow with level, training and evolution; rarity is only a small edge', () => {
  const common = { species: 'meadow_bunny', xp: xpForPetLevel(50), stage: 3, training: {}, traits: [] };
  const mythic = { ...common, species: 'celestial_unicorn' };
  const total = (pet) => Object.values(petStats(pet)).reduce((a, b) => a + b, 0);
  assert.ok(total(mythic) / total(common) < 1.25, 'a mythic pet is less than 25% stronger at the same level');
  const trained = { ...common, training: { power: trainingCap(50, 3) } };
  assert.ok(petStats(trained).power > petStats(mythic).power, 'a fully trained common pet out-hits an untrained mythic');
  assert.equal(petLevelForXp(xpForPetLevel(15)), 15);
});

test('pet names are validated', () => {
  assert.equal(cleanPetName('  Sir   Hops  '), 'Sir Hops');
  for (const bad of ['a', '@everyone', '<@123>', 'x'.repeat(25), '**bold**', 'https://x.y']) assert.equal(cleanPetName(bad), null, bad);
});

// ── Adoption ──────────────────────────────────────────────────────────────

test('adoption: the first pet is a free starter; later pets cost coins; legendary pets only hatch', () => {
  const { pets, economy, fund, adopt } = setup();
  assert.throws(() => pets.prepareAdoption({ guildId: G, userId: 'u', species: 'ember_fox', now: T0, settings: s }), isUserError(/starter/));
  const first = adopt('u', 'meadow_bunny');
  assert.equal(first.price, 0);
  assert.equal(first.pet.active, 1, 'the first pet becomes the active pet');
  assert.equal(first.pet.traits.length, 1);
  assert.throws(() => pets.prepareAdoption({ guildId: G, userId: 'u', species: 'baby_dragon', now: T0, settings: s }), isUserError(/eggs/));
  assert.throws(() => adopt('u', 'copper_fox'), isUserError(/only have/), 'a paid adoption needs the coins');
  fund('u', 10_000);
  const second = adopt('u', 'copper_fox');
  assert.equal(second.price, 6_000);
  assert.equal(second.pet.active, 0);
  assert.equal(economy.account(G, 'u').wallet, 4_000);
  assert.equal(economy.account(G, 'u').lifetime_spent, 6_000);
});

test('an adoption offer can only be used once, and only by the member it was made for', () => {
  const { pets, fund, adopt } = setup();
  fund('u', 50_000);
  adopt('u', 'meadow_bunny');
  const offer = pets.prepareAdoption({ guildId: G, userId: 'u', species: 'pebble_turtle', now: T0, settings: s });
  assert.throws(() => pets.confirmAdoption({ pendingId: offer.pendingId, userId: 'thief', now: T0, settings: s }), isUserError(/not yours/));
  pets.confirmAdoption({ pendingId: offer.pendingId, userId: 'u', now: T0 + 1, settings: s });
  assert.throws(() => pets.confirmAdoption({ pendingId: offer.pendingId, userId: 'u', now: T0 + 2, settings: s }), isUserError(/already handled/));
  assert.equal(pets.forOwner(G, 'u').length, 2);
  const late = pets.prepareAdoption({ guildId: G, userId: 'u', species: 'pebble_turtle', now: T0, settings: s });
  assert.throws(() => pets.confirmAdoption({ pendingId: late.pendingId, userId: 'u', now: T0 + 6 * MINUTE, settings: s }), isUserError(/expired/));
});

test('a failed adoption charges nothing, and the pet limit is enforced', () => {
  const { pets, economy, fund, adopt } = setup();
  adopt('u', 'meadow_bunny');
  fund('u', 5_000);
  const offer = pets.prepareAdoption({ guildId: G, userId: 'u', species: 'pebble_turtle', now: T0, settings: s });
  // The price doubles before the member confirms: nothing is charged and nothing is adopted.
  const pricier = { ...s, petPricePercent: 200 };
  assert.throws(() => pets.confirmAdoption({ pendingId: offer.pendingId, userId: 'u', now: T0, settings: pricier }), isUserError(/price has changed/));
  assert.equal(economy.account(G, 'u').wallet, 5_000);
  assert.equal(pets.forOwner(G, 'u').length, 1);
  const tight = { ...s, petMax: 1 };
  assert.throws(() => pets.prepareAdoption({ guildId: G, userId: 'u', species: 'pebble_turtle', now: T0, settings: tight }), isUserError(/up to 1 pets/));
});

test('hatching uses the egg exactly once and shows real odds', () => {
  const { pets, inventory, adopt, give } = setup();
  adopt('u', 'meadow_bunny');
  assert.throws(() => pets.prepareHatch({ guildId: G, userId: 'u', egg: 'dragon_egg', now: T0, settings: s }), isUserError(/do not have/));
  give('u', 'dragon_egg');
  const offer = pets.prepareHatch({ guildId: G, userId: 'u', egg: 'dragon_egg', now: T0, settings: s });
  assert.deepEqual(offer.odds.map((o) => o.species), ['baby_dragon', 'ember_fox']);
  const result = pets.confirmHatch({ pendingId: offer.pendingId, userId: 'u', now: T0, settings: s, rng: () => 0.1 });
  assert.equal(result.pet.species, 'baby_dragon');
  assert.equal(result.pet.source, 'egg');
  assert.equal(inventory.quantity(G, 'u', 'dragon_egg'), 0);
  assert.throws(() => pets.confirmHatch({ pendingId: offer.pendingId, userId: 'u', now: T0, settings: s }), isUserError(/already handled/));
});

test('collection milestones pay out once, and released pets still count as discovered', () => {
  const { db, pets, economy, inventory, progression, fund, adopt } = setup();
  fund('u', 1_000_000);
  adopt('u', 'meadow_bunny');
  adopt('u', 'pebble_turtle');
  // Collection coins go to the bank (level-up rewards land there too, so count only these).
  const collectionCoins = () => db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM economy_transactions WHERE type = 'collection_reward' AND account = 'bank'`).get().n;
  const third = adopt('u', 'copper_fox');
  assert.equal(third.milestones.length, 1);
  assert.equal(third.milestones[0].species, 3);
  assert.equal(collectionCoins(), COLLECTION_MILESTONES[0].coins);
  assert.equal(inventory.quantity(G, 'u', 'berry_treat'), 5);
  // Release one and adopt the same species again: nothing new is discovered, nothing is paid twice.
  pets.release({ guildId: G, userId: 'u', petId: third.pet.id, confirmation: 'copper fox', now: T0 });
  const again = adopt('u', 'copper_fox');
  assert.equal(again.milestones.length, 0);
  assert.equal(collectionCoins(), COLLECTION_MILESTONES[0].coins);
  assert.ok(economy.account(G, 'u').bank >= COLLECTION_MILESTONES[0].coins);
  adopt('u', 'lucky_slime');
  const fifth = adopt('u', 'ember_fox');
  assert.equal(fifth.milestones[0].species, 5);
  assert.ok(progression.unlocks(G, 'u').some((u) => u.unlock_key === 'pet_collector'));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xp_transactions WHERE source = 'collection_milestone'`).get().n, 2);
});

// ── Care ──────────────────────────────────────────────────────────────────

test('only the owner can care for a pet, and care actions follow their cooldowns and costs', () => {
  const { pets, adopt } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const args = { guildId: G, userId: 'u', petId: pet.id, settings: s };
  assert.throws(() => pets.play({ ...args, userId: 'stranger', now: T0 }), isUserError(/not one of your pets/));

  const played = pets.play({ ...args, now: T0, rng: seeded(2) });
  assert.equal(played.energy, CARE.play.energy);
  assert.ok(played.levels.xp >= CARE.play.xp[0]);
  assert.throws(() => pets.play({ ...args, now: T0 + MINUTE }), isUserError(/again/));
  assert.ok(pets.play({ ...args, now: T0 + CARE.play.cooldownMs + 1, rng: seeded(3) }));

  const fed = pets.feed({ ...args, now: T0 });
  assert.equal(fed.food, 'kibble');
  assert.throws(() => pets.feed({ ...args, now: T0 + MINUTE }), isUserError(/more kibble/));
  assert.throws(() => pets.feed({ ...args, food: 'golden_apple', now: T0 + MINUTE }), isUserError(/do not have enough/));
});

test('training raises a stat up to its cap and costs energy', () => {
  const { db, pets, adopt } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const train = (now) => pets.train({ guildId: G, userId: 'u', petId: pet.id, stat: 'power', now, settings: s });
  const first = train(T0);
  assert.equal(first.points, 1);
  assert.equal(first.cap, trainingCap(petLevelForXp(first.pet.xp), 1));
  assert.equal(first.pet.energy, 100 - CARE.train.energy);
  assert.throws(() => train(T0 + 1), isUserError(/train again/), 'training has a cooldown');
  db.prepare('UPDATE pets SET training = ? WHERE id = ?').run(JSON.stringify({ power: first.cap }), pet.id);
  assert.throws(() => train(T0 + CARE.train.cooldownMs + 1), isUserError(/as far as it can/), 'a stat at its cap cannot be trained');
  assert.throws(() => pets.train({ guildId: G, userId: 'u', petId: pet.id, stat: 'luck', now: T0, settings: s }), isUserError(/Choose power/));
});

test('a napping pet cannot act until it wakes, and naps refill energy', () => {
  const { pets, adopt } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const args = { guildId: G, userId: 'u', petId: pet.id, settings: s };
  assert.throws(() => pets.sleep({ ...args, now: T0 }), isUserError(/not sleepy/));
  pets.explore({ ...args, now: T0, rng: seeded(1) });
  const nap = pets.sleep({ ...args, now: T0 + 1 });
  assert.equal(nap.pet.status, 'sleeping');
  assert.throws(() => pets.play({ ...args, now: T0 + 2 }), isUserError(/napping/));
  assert.equal(pets.get(pet.id, nap.pet.busy_until + 1).energy, 100);
  assert.equal(pets.get(pet.id, nap.pet.busy_until + 1).status, 'idle');
  const woke = pets.sleep({ ...args, now: T0 + 3 });
  assert.equal(woke.woke, true);
});

test('exploring pays coins once per outing and may find an item', () => {
  const { pets, economy, inventory, adopt } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const result = pets.explore({ guildId: G, userId: 'u', petId: pet.id, now: T0, settings: s, rng: () => 0.01 });
  assert.ok(result.coins >= EXPLORE.coins[0]);
  assert.equal(economy.account(G, 'u').wallet, result.coins);
  assert.equal(result.items.length, 1);
  assert.equal(inventory.quantity(G, 'u', result.items[0].item), 1);
  assert.throws(() => pets.explore({ guildId: G, userId: 'u', petId: pet.id, now: T0 + MINUTE, settings: s }), isUserError(/explore again/));
});

// ── Expeditions ──────────────────────────────────────────────────────────

test('expeditions: locked while away, claimable once when back, recall brings nothing', () => {
  const { pets, economy, adopt } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const start = (now, destination = 'forest') => pets.startExpedition({ guildId: G, userId: 'u', petId: pet.id, destination, now });
  assert.throws(() => start(T0, 'ruins'), isUserError(/level 10/));
  const { expedition } = start(T0);
  assert.equal(pets.get(pet.id, T0).status, 'expedition');
  assert.throws(() => pets.play({ guildId: G, userId: 'u', petId: pet.id, now: T0 + 1, settings: s }), isUserError(/away/));
  assert.throws(() => pets.release({ guildId: G, userId: 'u', petId: pet.id, confirmation: 'Meadow Bunny', now: T0 }), isUserError(/away/));
  const claim = (now, userId = 'u') => pets.claimExpedition({ expeditionId: expedition.id, userId, now, settings: s, rng: seeded(5) });
  assert.throws(() => claim(T0 + MINUTE), isUserError(/still exploring/));
  assert.throws(() => claim(expedition.ends_at, 'thief'), isUserError(/not your expedition/));
  const result = claim(expedition.ends_at);
  assert.ok(result.rewards.coins > 0);
  assert.equal(economy.account(G, 'u').wallet, result.rewards.coins);
  assert.equal(result.pet.status, 'idle');
  assert.equal(result.pet.expeditions, 1);
  assert.throws(() => claim(expedition.ends_at + 1), isUserError(/already been claimed/));
  assert.equal(economy.account(G, 'u').wallet, result.rewards.coins, 'a second claim pays nothing');

  const second = start(expedition.ends_at + 1);
  const recalled = pets.recallExpedition({ expeditionId: second.expedition.id, userId: 'u', now: expedition.ends_at + 2 });
  assert.equal(recalled.expedition.status, 'recalled');
  assert.equal(recalled.pet.status, 'idle');
  assert.throws(() => pets.claimExpedition({ expeditionId: second.expedition.id, userId: 'u', now: second.expedition.ends_at, settings: s }), isUserError(/already been claimed/));
});

test('expeditions survive a restart and stay claimable exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyss-pets-'));
  const file = path.join(dir, 'community.db');
  try {
    const first = setup(communityDb(file));
    const { pet } = first.adopt('u', 'meadow_bunny');
    const { expedition } = first.pets.startExpedition({ guildId: G, userId: 'u', petId: pet.id, destination: 'forest', now: T0 });
    first.db.close();

    const second = setup(communityDb(file));
    assert.equal(second.pets.get(pet.id, T0 + MINUTE).status, 'expedition');
    const result = second.pets.claimExpedition({ expeditionId: expedition.id, userId: 'u', now: expedition.ends_at, settings: s, rng: seeded(1) });
    assert.equal(result.expedition.status, 'claimed');
    assert.throws(() => second.pets.claimExpedition({ expeditionId: expedition.id, userId: 'u', now: expedition.ends_at, settings: s }), isUserError(/already been claimed/));
    second.db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expedition rewards scale with level and come from the destination table', () => {
  const pet = { species: 'meadow_bunny', xp: xpForPetLevel(20), traits: [], stage: 1, training: {} };
  const items = new Set(DESTINATIONS.lair.loot.map((l) => l.item));
  for (let seed = 1; seed <= 50; seed += 1) {
    const found = rollExpedition(pet, 'lair', seeded(seed));
    assert.ok(found.coins >= DESTINATIONS.lair.coins[0] && found.coins <= Math.round(DESTINATIONS.lair.coins[1] * 1.2));
    for (const { item } of found.items) assert.ok(items.has(item));
  }
});

// ── Evolution, accessories and release ───────────────────────────────────

test('evolution keeps the pet\'s identity and progression, and needs its materials', () => {
  const { pets, economy, inventory, fund, adopt, give, setXp } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  pets.rename({ guildId: G, userId: 'u', petId: pet.id, name: 'Biscuit', now: T0 });
  pets.train({ guildId: G, userId: 'u', petId: pet.id, stat: 'power', now: T0, settings: s });
  const evolve = () => pets.evolve({ guildId: G, userId: 'u', petId: pet.id, now: T0 + 1, settings: s });
  assert.throws(evolve, isUserError(/level 15/));
  setXp(pet.id, 15);
  assert.throws(evolve, isUserError(/Evolution Crystal/));
  give('u', 'evo_crystal');
  assert.throws(evolve, isUserError(/only have/));
  assert.equal(inventory.quantity(G, 'u', 'evo_crystal'), 1, 'a failed evolution keeps the crystal');
  fund('u', 2_500);
  const before = pets.get(pet.id, T0 + 1);
  const result = evolve();
  assert.equal(result.pet.stage, 2);
  assert.equal(result.pet.id, pet.id);
  assert.equal(result.pet.name, 'Biscuit');
  assert.equal(result.pet.xp, before.xp);
  assert.deepEqual(result.pet.training, before.training);
  assert.equal(inventory.quantity(G, 'u', 'evo_crystal'), 0);
  assert.equal(economy.account(G, 'u').wallet, 0);
  assert.ok(petStats(result.pet).power > petStats(before).power);
});

test('accessories: slots unlock with progress, swapping returns the old one, release returns them all', () => {
  const { pets, inventory, adopt, give, setXp } = setup();
  const { pet } = adopt('u', 'meadow_bunny');
  const equip = (item) => pets.equipCosmetic({ guildId: G, userId: 'u', petId: pet.id, item, now: T0 });
  assert.throws(() => equip('party_hat'), isUserError(/do not have enough/));
  give('u', 'party_hat');
  give('u', 'wizard_hat');
  give('u', 'bow_tie');
  equip('party_hat');
  assert.throws(() => equip('bow_tie'), isUserError(/level 10/), 'the neck slot is locked at level 1');
  const swap = equip('wizard_hat');
  assert.equal(swap.replaced, 'party_hat');
  assert.equal(inventory.quantity(G, 'u', 'party_hat'), 1);
  assert.equal(inventory.quantity(G, 'u', 'wizard_hat'), 0);
  setXp(pet.id, 10);
  equip('bow_tie');
  assert.equal(pets.cosmetics(pet.id).length, 2);

  assert.throws(() => pets.release({ guildId: G, userId: 'u', petId: pet.id, confirmation: 'wrong name', now: T0 }), isUserError(/does not match/));
  pets.release({ guildId: G, userId: 'u', petId: pet.id, confirmation: '  meadow   BUNNY ', now: T0 });
  assert.equal(pets.get(pet.id).status, 'released');
  assert.equal(inventory.quantity(G, 'u', 'wizard_hat'), 1);
  assert.equal(inventory.quantity(G, 'u', 'bow_tie'), 1);
  assert.equal(pets.cosmetics(pet.id).length, 0);
  assert.throws(() => pets.play({ guildId: G, userId: 'u', petId: pet.id, now: T0, settings: s }), isUserError(/not one of your pets/));
});

test('releasing the active pet makes another pet active; one active pet at a time', () => {
  const { pets, fund, adopt } = setup();
  fund('u', 10_000);
  const bunny = adopt('u', 'meadow_bunny').pet;
  const turtle = adopt('u', 'pebble_turtle').pet;
  pets.equip({ guildId: G, userId: 'u', petId: turtle.id, now: T0 });
  assert.equal(pets.active(G, 'u').id, turtle.id);
  assert.equal(pets.get(bunny.id).active, 0);
  pets.release({ guildId: G, userId: 'u', petId: turtle.id, confirmation: 'Pebble Turtle', now: T0 });
  assert.equal(pets.active(G, 'u').id, bunny.id);
});

// ── Battles ──────────────────────────────────────────────────────────────

function battleSetup() {
  const world = setup();
  const host = world.adopt('a', 'meadow_bunny').pet;
  const guest = world.adopt('b', 'pebble_turtle').pet;
  const challenge = (now = T0) => world.petBattles.challenge({ guildId: G, hostId: 'a', opponentId: 'b', now, settings: s });
  return { ...world, host, guest, challenge };
}

/** Plays attacks until the battle is over. */
function fight(petBattles, battle, now) {
  let current = battle;
  let result;
  for (let turn = 0; turn < BATTLE.maxTurns + 2 && current.status === 'active'; turn += 1) {
    const userId = current.state.turn === 'host' ? current.host_id : current.opponent_id;
    result = petBattles.act({ battleId: current.id, userId, move: 'attack', now: now + turn, settings: s, rng: seeded(turn + 1) });
    current = result.battle;
  }
  return result;
}

test('a pet battle runs turn by turn, settles once and unlocks both pets', () => {
  const { petBattles, pets, host, guest, challenge } = battleSetup();
  const open = challenge();
  assert.equal(pets.get(host.id, T0).status, 'battle', 'the challenger\'s pet is reserved');
  assert.throws(() => petBattles.accept({ battleId: open.id, userId: 'c', now: T0 + 1 }), isUserError(/not for you/));
  const battle = petBattles.accept({ battleId: open.id, userId: 'b', now: T0 + 1 });
  assert.equal(battle.status, 'active');
  assert.equal(pets.get(host.id, T0 + 1).energy, 100 - BATTLE.energy);
  assert.equal(pets.get(guest.id, T0 + 1).energy, 100 - BATTLE.energy);
  const waiting = battle.state.turn === 'host' ? 'b' : 'a';
  assert.throws(() => petBattles.act({ battleId: battle.id, userId: waiting, move: 'attack', now: T0 + 2, settings: s }), isUserError(/not your turn/));
  assert.throws(() => petBattles.act({ battleId: battle.id, userId: 'c', move: 'attack', now: T0 + 2, settings: s }), isUserError(/not your battle/));

  const result = fight(petBattles, battle, T0 + 2);
  assert.equal(result.battle.status, 'finished');
  const winnerId = result.battle.winner_id;
  assert.ok(['a', 'b'].includes(winnerId));
  const winner = pets.get(winnerId === 'a' ? host.id : guest.id);
  const loser = pets.get(winnerId === 'a' ? guest.id : host.id);
  assert.equal(winner.battles_won, 1);
  assert.equal(loser.battles_lost, 1);
  assert.equal(winner.status, 'idle');
  assert.equal(loser.status, 'idle');
  assert.ok(winner.xp >= BATTLE.xp.win && loser.xp >= BATTLE.xp.loss);
  assert.throws(() => petBattles.act({ battleId: battle.id, userId: 'a', move: 'attack', now: T0 + 100, settings: s }), isUserError(/over/));
});

test('battle abilities respect cooldowns, and unknown moves are rejected', () => {
  const pet = (species, id) => ({ id, species, xp: 0, stage: 1, training: {}, traits: [], name: null, variant: 'classic' });
  const state = startBattle(pet('meadow_bunny', 1), pet('pebble_turtle', 2));
  const side = state.turn;
  const ability = state.sides[side].abilities[0];
  const used = battleAct(state, side, ability, { rng: seeded(1) });
  assert.equal(used.done, false);
  const back = battleAct(used.state, used.state.turn, 'guard', { rng: seeded(2) });
  assert.ok(battleAct(back.state, side, ability, { rng: seeded(3) }).invalid, 'still recharging');
  assert.ok(battleAct(state, side, 'cosmic_ray', { rng: seeded(1) }).invalid, 'not this pet\'s ability');
  assert.ok(battleAct(state, side === 'host' ? 'opponent' : 'host', 'attack', { rng: seeded(1) }).invalid, 'not your turn');
});

test('unanswered challenges expire and free the pet; a player who stops moving forfeits', () => {
  const { petBattles, pets, host, challenge } = battleSetup();
  const open = challenge();
  const [expired] = petBattles.expireDue(open.expires_at + 1, () => s);
  assert.equal(expired.battle.status, 'expired');
  assert.equal(pets.get(host.id).status, 'idle');
  assert.throws(() => petBattles.accept({ battleId: open.id, userId: 'b', now: open.expires_at + 2 }), isUserError(/no longer open/));

  const second = challenge(T0 + BATTLE.cooldownMs);
  const battle = petBattles.accept({ battleId: second.id, userId: 'b', now: T0 + BATTLE.cooldownMs + 1 });
  const mover = battle.state.turn === 'host' ? 'a' : 'b';
  const [timedOut] = petBattles.expireDue(battle.expires_at + 1, () => s);
  assert.equal(timedOut.battle.status, 'finished');
  assert.notEqual(timedOut.battle.winner_id, mover, 'the player who ran out of time loses');
});

test('pet battle rewards are limited per day, so repeated battles cannot farm XP', () => {
  const { petBattles, pets, host, challenge } = battleSetup();
  let now = T0;
  for (let i = 0; i < BATTLE.rewardLimit + 1; i += 1) {
    const open = challenge(now);
    const battle = petBattles.accept({ battleId: open.id, userId: 'b', now: now + 1 });
    const result = petBattles.forfeit({ battleId: battle.id, userId: 'b', now: now + 2, settings: s });
    assert.equal(result.results.host.rewarded, i < BATTLE.rewardLimit, `battle ${i + 1}`);
    // Let energy recover and the challenge cooldown pass.
    now += BATTLE.cooldownMs + BATTLE.energy * NEEDS.energyRegenMs;
  }
  assert.equal(pets.get(host.id, now).battles_won, BATTLE.rewardLimit + 1, 'wins are still recorded');
});

test('a member leaving forfeits their battle and frees both pets', () => {
  const { petBattles, pets, host, guest, challenge } = battleSetup();
  const battle = petBattles.accept({ battleId: challenge().id, userId: 'b', now: T0 + 1 });
  const [result] = petBattles.cancelForMember({ guildId: G, userId: 'b', now: T0 + 2, settings: s });
  assert.equal(result.battle.winner_id, 'a');
  assert.equal(pets.get(host.id).status, 'idle');
  assert.equal(pets.get(guest.id).status, 'idle');
  assert.equal(petBattles.get(battle.id).status, 'finished');
});

// ── Views ────────────────────────────────────────────────────────────────

test('pet views render within Discord limits', () => {
  const ctx = fakeCtx();
  const { pets, petBattles, inventory } = getServices(ctx);
  const adoptFor = (userId, species) => pets.confirmAdoption({
    pendingId: pets.prepareAdoption({ guildId: G, userId, species, now: T0, settings: s }).pendingId, userId, now: T0, settings: s,
  }).pet;
  const pet = adoptFor('u', 'lucky_slime');
  const other = adoptFor('v', 'copper_fox');
  inventory.grant({ guildId: G, userId: 'u', item: 'party_hat', type: 'test', now: T0 });
  const check = (payload) => {
    for (const embed of payload.embeds) {
      const json = embed.toJSON();
      assert.ok(JSON.stringify(json).length < 6_000);
      assert.ok((json.description ?? '').length <= 4_096);
      for (const field of json.fields ?? []) assert.ok(field.value.length > 0 && field.value.length <= 1_024, field.name);
    }
    assert.ok((payload.components ?? []).length <= 5);
    for (const row of payload.components ?? []) for (const c of row.toJSON().components) assert.ok(!c.custom_id || c.custom_id.length <= 100);
  };
  check(profilePayload(ctx, pet, { feedback: 'Hello' }));
  check({ embeds: [abilitiesEmbed(ctx, pet), statsEmbed(ctx, pet)] });
  check(cosmeticsPayload(ctx, pet));
  check(evolutionPayload(ctx, pet));
  for (const filter of ['all', 'catalogue', 'legendary']) check(collectionPayload(ctx, G, 'u', filter, 1, T0));
  for (const metric of ['level', 'battles', 'expeditions', 'collection']) check(leaderboardPayload(ctx, G, metric, 1));
  check(expeditionPanel(ctx, G, 'u', T0));
  const { expedition } = pets.startExpedition({ guildId: G, userId: 'u', petId: pet.id, destination: 'forest', now: T0 });
  check(expeditionPayload(ctx, expedition, {}, T0));
  check(expeditionPayload(ctx, expedition, {}, expedition.ends_at));
  const claimed = pets.claimExpedition({ expeditionId: expedition.id, userId: 'u', now: expedition.ends_at, settings: s });
  check(expeditionPayload(ctx, claimed.expedition, { levels: claimed.levels }, expedition.ends_at));
  const later = expedition.ends_at + 1;
  const open = petBattles.challenge({ guildId: G, hostId: 'v', opponentId: 'u', petId: other.id, now: later, settings: s });
  check(battlePayload(ctx, open));
  const active = petBattles.accept({ battleId: open.id, userId: 'u', now: later + 1 });
  check(battlePayload(ctx, active));
  const finished = petBattles.forfeit({ battleId: active.id, userId: 'u', now: later + 2, settings: s });
  check(battlePayload(ctx, finished.battle, finished));
  assert.ok(Object.keys(TRAITS).length >= 10);
});
