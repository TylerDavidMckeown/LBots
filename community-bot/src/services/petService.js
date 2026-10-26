import crypto from 'node:crypto';
import { runOnce } from '@lyss/shared/db.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { NO_ACTIVITY } from './activity.js';
import { COSMETIC_SLOTS, ITEMS, itemLabel } from './items.js';
import {
  COLLECTION_MILESTONES, DESTINATIONS, EGGS, EVOLUTION, EXPLORE, SPECIES, STATS,
} from './pets/catalogue.js';
import {
  adoptionPrice, CARE, cleanPetName, currentNeeds, displayName, eggOdds, energyCost, foodHappiness, hatch, napDuration,
  NEEDS, petLevelForXp, petLevelUnlocks, petXpGain, playHappiness, playXp, rollExpedition, rollExplore, rollNewPet,
  slotUnlocked, trainingCap, trainXp,
} from './pets/rules.js';
import { secureRandom } from './random.js';

const CONFIRM_MS = 5 * 60_000;
/** Pets that can be away on expeditions at the same time, per member. */
export const MAX_EXPEDITIONS = 3;

const LEADERBOARDS = Object.freeze({
  level: { label: 'Highest level', where: 'xp > 0', order: 'xp DESC, id' },
  battles: { label: 'Battle wins', where: 'battles_won > 0', order: 'battles_won DESC, xp DESC, id' },
  expeditions: { label: 'Expeditions', where: 'expeditions > 0', order: 'expeditions DESC, xp DESC, id' },
});
export const PET_LEADERBOARD_CHOICES = Object.freeze([
  ...Object.entries(LEADERBOARDS).map(([value, board]) => ({ name: board.label, value })),
  { name: 'Biggest collection', value: 'collection' },
]);

/**
 * Pets: adoption, care, expeditions, evolution and accessories. Every public method
 * runs in one SQLite transaction:
 * - only the owner can act on a pet, and released pets can never act again,
 * - happiness and energy are brought up to date (see rules.js) before every change,
 * - paid adoptions and hatching go through single-use confirmations,
 * - expedition rewards are rolled and granted once, together with the status change,
 * - a pet that is away, battling or napping is locked against conflicting actions.
 */
export function createPetService(db, { economy, inventory, progression = null, activity = NO_ACTIVITY }) {
  const q = {
    insert: db.prepare(`
      INSERT INTO pets (guild_id, owner_id, species, variant, happiness, energy, needs_at, traits, active, source, adopted_at)
      VALUES (@guildId, @ownerId, @species, @variant, @happiness, @energy, @now, @traits, @active, @source, @now)
    `),
    get: db.prepare('SELECT * FROM pets WHERE id = ?'),
    owned: db.prepare(`SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? AND status != 'released' ORDER BY active DESC, xp DESC, id`),
    countOwned: db.prepare(`SELECT COUNT(*) AS n FROM pets WHERE guild_id = ? AND owner_id = ? AND status != 'released'`),
    everOwned: db.prepare('SELECT COUNT(*) AS n FROM pets WHERE guild_id = ? AND owner_id = ?'),
    discovered: db.prepare('SELECT species, MIN(adopted_at) AS first_at FROM pets WHERE guild_id = ? AND owner_id = ? GROUP BY species'),
    active: db.prepare(`SELECT * FROM pets WHERE guild_id = ? AND owner_id = ? AND active = 1 AND status != 'released'`),
    clearActive: db.prepare('UPDATE pets SET active = 0 WHERE guild_id = ? AND owner_id = ? AND active = 1'),
    setActive: db.prepare('UPDATE pets SET active = 1 WHERE id = ?'),
    save: db.prepare(`
      UPDATE pets SET name = @name, stage = @stage, xp = @xp, happiness = @happiness, energy = @energy, needs_at = @needs_at,
        training = @training, status = @status, busy_until = @busy_until, active = @active, fed_at = @fed_at, played_at = @played_at,
        trained_at = @trained_at, explored_at = @explored_at, times_trained = @times_trained, expeditions = @expeditions,
        battles_won = @battles_won, battles_lost = @battles_lost, evolved_at = @evolved_at, released_at = @released_at
      WHERE id = @id
    `),
    cosmetics: db.prepare('SELECT * FROM pet_cosmetics WHERE pet_id = ?'),
    wear: db.prepare('INSERT INTO pet_cosmetics (pet_id, slot, item_key, equipped_at) VALUES (?, ?, ?, ?)'),
    takeOff: db.prepare('DELETE FROM pet_cosmetics WHERE pet_id = ? AND slot = ?'),

    insertExpedition: db.prepare(`
      INSERT INTO pet_expeditions (guild_id, owner_id, pet_id, destination, started_at, ends_at, channel_id)
      VALUES (@guildId, @ownerId, @petId, @destination, @now, @endsAt, @channelId)
    `),
    expedition: db.prepare('SELECT * FROM pet_expeditions WHERE id = ?'),
    activeExpeditions: db.prepare(`SELECT * FROM pet_expeditions WHERE guild_id = ? AND owner_id = ? AND status = 'active' ORDER BY ends_at`),
    finishExpedition: db.prepare(`UPDATE pet_expeditions SET status = @status, finished_at = @now, rewards = @rewards WHERE id = @id AND status = 'active'`),
    setExpeditionMessage: db.prepare('UPDATE pet_expeditions SET channel_id = ?, message_id = ? WHERE id = ?'),
    collection: db.prepare(`
      SELECT owner_id, COUNT(DISTINCT species) AS n FROM pets WHERE guild_id = ? GROUP BY owner_id ORDER BY n DESC, MIN(adopted_at), owner_id LIMIT ? OFFSET ?
    `),
    collectionCount: db.prepare('SELECT COUNT(DISTINCT owner_id) AS n FROM pets WHERE guild_id = ?'),
  };
  const boards = Object.fromEntries(Object.entries(LEADERBOARDS).map(([key, board]) => [key, {
    page: db.prepare(`SELECT * FROM pets WHERE guild_id = ? AND status != 'released' AND ${board.where} ORDER BY ${board.order} LIMIT ? OFFSET ?`),
    count: db.prepare(`SELECT COUNT(*) AS n FROM pets WHERE guild_id = ? AND status != 'released' AND ${board.where}`),
  }]));

  const tx = (fn) => db.transaction(fn).immediate();
  const fail = (message, title) => {
    throw new UserError(message, { title });
  };

  // ── Loading and saving ──────────────────────────────────────────────────

  /** Parses a row and brings its needs up to date for `now`. */
  function hydrate(row, now) {
    if (!row) return null;
    const pet = { ...row, traits: JSON.parse(row.traits), training: JSON.parse(row.training) };
    return pet.status === 'released' ? pet : { ...pet, ...currentNeeds(pet, now) };
  }

  function save(pet) {
    q.save.run({
      id: pet.id, name: pet.name, stage: pet.stage, xp: pet.xp, happiness: pet.happiness, energy: pet.energy, needs_at: pet.needs_at,
      training: JSON.stringify(pet.training), status: pet.status, busy_until: pet.busy_until, active: pet.active ? 1 : 0,
      fed_at: pet.fed_at, played_at: pet.played_at, trained_at: pet.trained_at, explored_at: pet.explored_at,
      times_trained: pet.times_trained, expeditions: pet.expeditions, battles_won: pet.battles_won, battles_lost: pet.battles_lost,
      evolved_at: pet.evolved_at, released_at: pet.released_at,
    });
  }

  const load = (id, now = Date.now()) => hydrate(q.get.get(id), now);

  /** A pet owned by `userId` (not released), or a UserError. */
  function owned(petId, userId, now) {
    const pet = load(petId, now);
    if (!pet || pet.owner_id !== userId || pet.status === 'released') fail('That is not one of your pets.', 'Not your pet');
    return pet;
  }

  /** The chosen pet, or the member's active pet when none is chosen. */
  function resolve(guildId, userId, petId, now) {
    if (petId) {
      const pet = owned(Number(petId), userId, now);
      if (pet.guild_id !== guildId) fail('That is not one of your pets.', 'Not your pet');
      return pet;
    }
    const pet = hydrate(q.active.get(guildId, userId) ?? q.owned.get(guildId, userId), now);
    if (!pet) fail('You do not have a pet yet. Adopt one with `/pet adopt`.', 'No pet');
    return pet;
  }

  /** Throws unless the pet is free to do something. */
  function assertAvailable(pet) {
    const name = displayName(pet);
    if (pet.status === 'sleeping') fail(`${name} is napping until ${discordTimestamp(pet.busy_until, 't')}. Wake it with \`/pet sleep\`.`, 'Napping');
    if (pet.status === 'expedition') fail(`${name} is away on an expedition and back ${discordTimestamp(pet.busy_until, 'R')}.`, 'Away');
    if (pet.status === 'battle') fail(`${name} is in a battle right now.`, 'In a battle');
  }

  function assertReady(pet, field, cooldownMs, action, now) {
    const readyAt = (pet[field] ?? 0) + cooldownMs;
    if (pet[field] && now < readyAt) fail(`${displayName(pet)} can ${action} again ${discordTimestamp(readyAt, 'R')}.`, 'Not yet');
  }

  function spendEnergy(pet, base) {
    const cost = energyCost(pet, base);
    if (pet.energy < cost) fail(`${displayName(pet)} needs ${cost} energy but has ${pet.energy}. Let it nap with \`/pet sleep\` or feed it an energy snack.`, 'Too tired');
    pet.energy -= cost;
    return cost;
  }

  /** Adds pet XP (with the happiness bonus and server multiplier) and reports any new level. */
  function gainXp(pet, base, settings) {
    const xp = petXpGain(base, pet, settings);
    const levelBefore = petLevelForXp(pet.xp);
    pet.xp += xp;
    const levelAfter = petLevelForXp(pet.xp);
    return { xp, levelBefore, levelAfter, unlocks: petLevelUnlocks(pet, levelBefore, levelAfter) };
  }

  const report = (pet, name, operationKey, now, settings, variant = null) => activity.emit({
    guildId: pet.guild_id, userId: pet.owner_id, activity: name, variant, operationKey, now, settings,
  }).progression ?? null;

  // ── Adoption ────────────────────────────────────────────────────────────

  function assertRoom(guildId, userId, settings) {
    if (q.countOwned.get(guildId, userId).n >= settings.petMax) fail(`You can look after up to ${settings.petMax} pets. Release one before adopting another.`, 'No room');
  }

  /** What adopting `species` would cost this member: the first pet is a free starter. */
  function quote(guildId, userId, species, settings) {
    const def = SPECIES[species];
    if (!def) fail('That species does not exist.', 'Unknown pet');
    assertRoom(guildId, userId, settings);
    if (q.everOwned.get(guildId, userId).n === 0) {
      if (!def.starter) fail(`Your first pet is a free starter: ${Object.values(SPECIES).filter((s) => s.starter).map((s) => `${s.emoji} ${s.name}`).join(', ')}.`, 'Starter pets only');
      return { species, price: 0, free: true };
    }
    const price = adoptionPrice(species, settings);
    if (price === null) fail(`${def.emoji} ${def.name} cannot be adopted. It only hatches from eggs found on expeditions.`, 'Eggs only');
    return { species, price, free: false };
  }

  function create({ guildId, userId, species, source, now, rng }) {
    const { variant, traits } = rollNewPet(species, rng);
    const info = q.insert.run({
      guildId, ownerId: userId, species, variant, traits: JSON.stringify(traits), source, now,
      happiness: NEEDS.start.happiness, energy: NEEDS.start.energy, active: q.active.get(guildId, userId) ? 0 : 1,
    });
    return load(Number(info.lastInsertRowid), now);
  }

  /** Rewards for discovering new species, each granted once (released pets still count). */
  function collectionRewards(guildId, userId, now, settings) {
    const discovered = q.discovered.all(guildId, userId).length;
    const granted = [];
    for (const milestone of COLLECTION_MILESTONES) {
      if (discovered < milestone.species) continue;
      const operationKey = `collection:${milestone.species}`;
      const { applied } = runOnce(db, `community:${guildId}:${userId}:${operationKey}`, () => {
        if (milestone.coins) economy.payReward({ guildId, userId, amount: milestone.coins, type: 'collection_reward', reference: String(milestone.species), operationKey, now, settings });
        for (const { item, quantity } of milestone.items ?? []) inventory.grant({ guildId, userId, item, quantity, type: 'collection_reward', operationKey, now });
        if (milestone.title) progression?.unlock(guildId, userId, 'title', milestone.title, operationKey, now);
        if (milestone.badge) progression?.unlock(guildId, userId, 'badge', milestone.badge, operationKey, now);
        activity.emit({ guildId, userId, activity: 'collection_milestone', operationKey, now, settings });
        return true;
      });
      if (applied) granted.push(milestone);
    }
    return granted;
  }

  function welcome(pet, now, settings) {
    const progressionResult = report(pet, 'pet_adopted', `pet:${pet.id}:adopted`, now, settings);
    return { pet: load(pet.id, now), milestones: collectionRewards(pet.guild_id, pet.owner_id, now, settings), progression: progressionResult };
  }

  // ── Care ────────────────────────────────────────────────────────────────

  /** Loads the pet, runs `change` on it, saves it and reports the care activity. */
  function care(args, action, change) {
    const { guildId, userId, petId = null, now = Date.now(), settings } = args;
    return tx(() => {
      const pet = resolve(guildId, userId, petId, now);
      const result = change(pet);
      save(pet);
      const progressionResult = report(pet, 'pet_care', `pet:${pet.id}:${action}:${now}`, now, settings);
      return { ...result, pet: load(pet.id, now), progression: progressionResult };
    });
  }

  const clampNeeds = (pet) => {
    pet.happiness = Math.min(100, pet.happiness);
    pet.energy = Math.min(100, pet.energy);
  };

  return {
    get: load,
    forOwner: (guildId, userId, now = Date.now()) => q.owned.all(guildId, userId).map((row) => hydrate(row, now)),
    active: (guildId, userId, now = Date.now()) => hydrate(q.active.get(guildId, userId), now),
    /** The chosen pet or the member's active pet. Throws a UserError when there is none. */
    resolve: (guildId, userId, petId = null, now = Date.now()) => resolve(guildId, userId, petId, now),
    cosmetics: (petId) => q.cosmetics.all(petId),
    discovered: (guildId, userId) => q.discovered.all(guildId, userId),
    hasEverOwned: (guildId, userId) => q.everOwned.get(guildId, userId).n > 0,
    expedition: (id) => q.expedition.get(id) ?? null,
    activeExpeditions: (guildId, userId) => q.activeExpeditions.all(guildId, userId),
    setExpeditionMessage: (id, channelId, messageId) => q.setExpeditionMessage.run(channelId, messageId, id),

    leaderboard(guildId, metric = 'level', limit = 10, offset = 0) {
      if (metric === 'collection') return q.collection.all(guildId, limit, offset);
      const board = boards[metric];
      if (!board) throw new Error(`Unknown pet leaderboard ${metric}`);
      return board.page.all(guildId, limit, offset).map((row) => hydrate(row, Date.now()));
    },
    leaderboardCount: (guildId, metric = 'level') => (metric === 'collection' ? q.collectionCount.get(guildId).n : boards[metric].count.get(guildId).n),

    // ── Adoption and hatching ─────────────────────────────────────────────

    /** A confirmation card for adopting `species`. Nothing is charged until confirmAdoption. */
    prepareAdoption({ guildId, userId, species, now = Date.now(), settings }) {
      const offer = quote(guildId, userId, species, settings);
      const pendingId = crypto.randomUUID();
      economy.createPending({ id: pendingId, guildId, userId, kind: 'pet_adopt', payload: offer, now, ttlMs: CONFIRM_MS });
      return { ...offer, pendingId, expiresAt: now + CONFIRM_MS };
    },

    confirmAdoption({ pendingId, userId, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const offer = economy.consumePending({ pendingId, userId, kind: 'pet_adopt', now });
        const current = quote(offer.guildId, userId, offer.species, settings);
        if (current.price !== offer.price) fail('The adoption price has changed. Please run `/pet adopt` again.', 'Price changed');
        if (current.price > 0) {
          economy.debit({ guildId: offer.guildId, userId, amount: current.price, type: 'pet_adoption', reference: offer.species, operationKey: `adopt:${pendingId}`, now, settings });
        }
        const pet = create({ guildId: offer.guildId, userId, species: offer.species, source: current.free ? 'starter' : 'adoption', now, rng });
        return { ...welcome(pet, now, settings), price: current.price };
      });
    },

    /** A confirmation card for hatching an egg, with its odds. The egg is used on confirmHatch. */
    prepareHatch({ guildId, userId, egg, now = Date.now(), settings }) {
      if (!EGGS[egg]) fail('That is not an egg.', 'Unknown egg');
      if (inventory.quantity(guildId, userId, egg) < 1) fail(`You do not have a ${itemLabel(egg)}. Eggs are found on expeditions.`, 'No egg');
      assertRoom(guildId, userId, settings);
      const pendingId = crypto.randomUUID();
      economy.createPending({ id: pendingId, guildId, userId, kind: 'pet_hatch', payload: { egg }, now, ttlMs: CONFIRM_MS });
      return { egg, odds: eggOdds(egg), pendingId, expiresAt: now + CONFIRM_MS };
    },

    confirmHatch({ pendingId, userId, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const { guildId, egg } = economy.consumePending({ pendingId, userId, kind: 'pet_hatch', now });
        assertRoom(guildId, userId, settings);
        inventory.use({ guildId, userId, item: egg, type: 'pet_hatch', operationKey: `hatch:${pendingId}`, now });
        const pet = create({ guildId, userId, species: hatch(egg, rng), source: 'egg', now, rng });
        return { ...welcome(pet, now, settings), egg };
      });
    },

    // ── Management ────────────────────────────────────────────────────────

    equip({ guildId, userId, petId, now = Date.now() }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        if (pet.active) fail(`${displayName(pet)} is already your active pet.`, 'Already active');
        q.clearActive.run(guildId, userId);
        q.setActive.run(pet.id);
        return load(pet.id, now);
      });
    },

    /** Renames a pet; `name: null` restores the species name. */
    rename({ guildId, userId, petId = null, name, now = Date.now() }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        if (name === null) {
          if (!pet.name) fail(`${displayName(pet)} already uses its species name.`, 'No change');
          pet.name = null;
        } else {
          const clean = cleanPetName(name);
          if (!clean) fail('Pet names are 2–24 letters, numbers and spaces, with simple punctuation (\' - . ! ?).', 'Invalid name');
          pet.name = clean;
        }
        save(pet);
        return load(pet.id, now);
      });
    },

    feed(args) {
      const { guildId, userId, food = 'kibble', now = Date.now(), settings } = args;
      const def = food === 'kibble' ? CARE.kibble : ITEMS[food];
      if (food !== 'kibble' && !def?.food) fail('That is not pet food.', 'Not food');
      return care(args, 'feed', (pet) => {
        assertAvailable(pet);
        const effect = food === 'kibble' ? { happiness: CARE.kibble.happiness } : def.food;
        if (food === 'kibble') {
          assertReady(pet, 'fed_at', CARE.kibble.cooldownMs, 'have more kibble', now);
          pet.fed_at = now;
        } else {
          inventory.use({ guildId, userId, item: food, type: 'pet_feed', reference: String(pet.id), now });
        }
        const before = { happiness: pet.happiness, energy: pet.energy };
        pet.happiness += foodHappiness(pet, effect.happiness ?? 0);
        pet.energy += effect.energy ?? 0;
        clampNeeds(pet);
        const levels = effect.xp ? gainXp(pet, effect.xp, settings) : null;
        return { food, happiness: pet.happiness - before.happiness, energy: pet.energy - before.energy, levels };
      });
    },

    play(args) {
      const { now = Date.now(), settings, rng = secureRandom } = args;
      return care(args, 'play', (pet) => {
        assertAvailable(pet);
        assertReady(pet, 'played_at', CARE.play.cooldownMs, 'play', now);
        const energy = spendEnergy(pet, CARE.play.energy);
        const before = pet.happiness;
        pet.happiness += playHappiness(pet);
        clampNeeds(pet);
        pet.played_at = now;
        return { happiness: pet.happiness - before, energy, levels: gainXp(pet, playXp(pet, rng), settings) };
      });
    },

    train(args) {
      const { stat, now = Date.now(), settings } = args;
      if (!STATS[stat]) fail('Choose power, guard, agility or vitality.', 'Unknown stat');
      return care(args, 'train', (pet) => {
        assertAvailable(pet);
        const cap = trainingCap(petLevelForXp(pet.xp), pet.stage);
        if ((pet.training[stat] ?? 0) >= cap) fail(`${displayName(pet)} has trained ${STATS[stat].label} as far as it can at this level (${cap}). Level up or evolve to train further.`, 'Fully trained');
        assertReady(pet, 'trained_at', CARE.train.cooldownMs, 'train', now);
        const energy = spendEnergy(pet, CARE.train.energy);
        pet.training = { ...pet.training, [stat]: (pet.training[stat] ?? 0) + 1 };
        pet.times_trained += 1;
        pet.trained_at = now;
        const levels = gainXp(pet, trainXp(pet), settings);
        // Report the cap after this session's XP, which may have raised it.
        return { stat, points: pet.training[stat], cap: trainingCap(petLevelForXp(pet.xp), pet.stage), energy, levels };
      });
    },

    /** Puts the pet down for a nap, or wakes it if it is already napping. */
    sleep({ guildId, userId, petId = null, now = Date.now() }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        if (pet.status === 'sleeping') {
          pet.status = 'idle';
          pet.busy_until = null;
          save(pet);
          return { pet: load(pet.id, now), woke: true };
        }
        assertAvailable(pet);
        if (pet.energy >= 100) fail(`${displayName(pet)} is full of energy and not sleepy.`, 'Not sleepy');
        pet.status = 'sleeping';
        pet.busy_until = now + napDuration(pet);
        save(pet);
        return { pet: load(pet.id, now), woke: false };
      });
    },

    explore(args) {
      const { guildId, userId, now = Date.now(), settings, rng = secureRandom } = args;
      return care(args, 'explore', (pet) => {
        assertAvailable(pet);
        assertReady(pet, 'explored_at', EXPLORE.cooldownMs, 'explore', now);
        const energy = spendEnergy(pet, EXPLORE.energy);
        pet.explored_at = now;
        const found = rollExplore(pet, rng);
        const operationKey = `explore:${pet.id}:${now}`;
        if (found.coins > 0) economy.credit({ guildId, userId, amount: found.coins, type: 'pet_explore', reference: String(pet.id), operationKey, now, settings });
        for (const { item, quantity } of found.items) inventory.grant({ guildId, userId, item, quantity, type: 'pet_explore', reference: String(pet.id), operationKey, now });
        return { ...found, energy, levels: gainXp(pet, found.xp, settings) };
      });
    },

    /** Adds pet XP to the active pet from elsewhere (the daily spin). Returns null without a pet. */
    grantXp({ guildId, userId, xp, now = Date.now(), settings }) {
      return tx(() => {
        const row = q.active.get(guildId, userId) ?? q.owned.get(guildId, userId);
        if (!row) return null;
        const pet = hydrate(row, now);
        const levels = gainXp(pet, xp, settings);
        save(pet);
        return { pet: load(pet.id, now), levels };
      });
    },

    // ── Expeditions ───────────────────────────────────────────────────────

    startExpedition({ guildId, userId, petId = null, destination, now = Date.now(), channelId = null }) {
      const def = DESTINATIONS[destination];
      if (!def) fail('That destination does not exist.', 'Unknown destination');
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        assertAvailable(pet);
        const level = petLevelForXp(pet.xp);
        if (level < def.minLevel) fail(`${def.emoji} ${def.name} needs a level ${def.minLevel} pet. ${displayName(pet)} is level ${level}.`, 'Too dangerous');
        if (q.activeExpeditions.all(guildId, userId).length >= MAX_EXPEDITIONS) fail(`You can have ${MAX_EXPEDITIONS} pets away at once.`, 'Too many expeditions');
        const energy = spendEnergy(pet, def.energy);
        pet.status = 'expedition';
        pet.busy_until = now + def.durationMs;
        save(pet);
        const info = q.insertExpedition.run({ guildId, ownerId: userId, petId: pet.id, destination, now, endsAt: pet.busy_until, channelId });
        return { expedition: q.expedition.get(Number(info.lastInsertRowid)), pet: load(pet.id, now), energy };
      });
    },

    /** Claims a finished expedition exactly once: rolls the rewards and brings the pet home. */
    claimExpedition({ expeditionId, userId, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const expedition = q.expedition.get(Number(expeditionId));
        if (!expedition || expedition.owner_id !== userId) fail('That is not your expedition.', 'Not yours');
        if (expedition.status !== 'active') fail('This expedition has already been claimed.', 'Already claimed');
        if (now < expedition.ends_at) fail(`Your pet is still exploring. It is back ${discordTimestamp(expedition.ends_at, 'R')}.`, 'Not back yet');
        const pet = load(expedition.pet_id, now);
        const found = rollExpedition(pet, expedition.destination, rng);
        const { guild_id: guildId } = expedition;
        if (!q.finishExpedition.run({ id: expedition.id, status: 'claimed', now, rewards: JSON.stringify(found) }).changes) fail('This expedition has already been claimed.', 'Already claimed');
        const operationKey = `expedition:${expedition.id}`;
        if (found.coins > 0) economy.credit({ guildId, userId, amount: found.coins, type: 'expedition_reward', reference: expedition.destination, operationKey, now, settings });
        for (const { item, quantity } of found.items) inventory.grant({ guildId, userId, item, quantity, type: 'expedition_reward', reference: expedition.destination, operationKey, now });
        const levels = gainXp(pet, found.xp, settings);
        pet.expeditions += 1;
        pet.status = 'idle';
        pet.busy_until = null;
        save(pet);
        const progressionResult = report(pet, 'expedition_completed', operationKey, now, settings, expedition.destination);
        return { expedition: q.expedition.get(expedition.id), pet: load(pet.id, now), rewards: found, levels, progression: progressionResult };
      });
    },

    /** Calls a pet home early. It brings nothing back and the energy is not refunded. */
    recallExpedition({ expeditionId, userId, now = Date.now() }) {
      return tx(() => {
        const expedition = q.expedition.get(Number(expeditionId));
        if (!expedition || expedition.owner_id !== userId) fail('That is not your expedition.', 'Not yours');
        if (!q.finishExpedition.run({ id: expedition.id, status: 'recalled', now, rewards: null }).changes) fail('This expedition is already over.', 'Already over');
        const pet = load(expedition.pet_id, now);
        pet.status = 'idle';
        pet.busy_until = null;
        save(pet);
        return { expedition: q.expedition.get(expedition.id), pet: load(pet.id, now) };
      });
    },

    // ── Evolution and accessories ─────────────────────────────────────────

    /** Evolves a pet to its next stage. Its name, XP, training and history are kept. */
    evolve({ guildId, userId, petId = null, now = Date.now(), settings }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        assertAvailable(pet);
        const next = EVOLUTION[pet.stage + 1];
        if (!next) fail(`${displayName(pet)} is fully evolved.`, 'Fully evolved');
        const level = petLevelForXp(pet.xp);
        if (level < next.level) fail(`${displayName(pet)} can evolve at level ${next.level}. It is level ${level}.`, 'Not ready');
        inventory.assertHas(guildId, userId, next.items);
        const operationKey = `evolve:${pet.id}:${pet.stage + 1}`;
        if (next.coins > 0) economy.debit({ guildId, userId, amount: next.coins, type: 'pet_evolution', reference: String(pet.id), operationKey, now, settings });
        for (const { item, quantity } of next.items) inventory.use({ guildId, userId, item, quantity, type: 'pet_evolution', reference: String(pet.id), operationKey, now });
        const before = { ...pet };
        pet.stage += 1;
        pet.evolved_at = now;
        save(pet);
        const progressionResult = report(pet, 'pet_evolved', operationKey, now, settings);
        return { before, pet: load(pet.id, now), cost: next, progression: progressionResult };
      });
    },

    /** Puts an accessory from the inventory on a pet, returning whatever it replaces. */
    equipCosmetic({ guildId, userId, petId = null, item, now = Date.now() }) {
      const def = ITEMS[item];
      if (def?.kind !== 'pet_cosmetic') fail('That is not a pet accessory.', 'Not an accessory');
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        if (!slotUnlocked(pet, def.slot)) fail(`The ${COSMETIC_SLOTS[def.slot].label.toLowerCase()} slot opens ${COSMETIC_SLOTS[def.slot].unlockText}.`, 'Slot locked');
        const current = q.cosmetics.all(pet.id).find((c) => c.slot === def.slot);
        if (current?.item_key === item) fail(`${displayName(pet)} is already wearing ${itemLabel(item)}.`, 'Already worn');
        inventory.use({ guildId, userId, item, type: 'pet_cosmetic_equip', reference: String(pet.id), now });
        if (current) {
          inventory.grant({ guildId, userId, item: current.item_key, type: 'pet_cosmetic_unequip', reference: String(pet.id), now });
          q.takeOff.run(pet.id, def.slot);
        }
        q.wear.run(pet.id, def.slot, item, now);
        return { pet: load(pet.id, now), slot: def.slot, replaced: current?.item_key ?? null };
      });
    },

    unequipCosmetic({ guildId, userId, petId = null, slot, now = Date.now() }) {
      if (!COSMETIC_SLOTS[slot]) fail('That slot does not exist.', 'Unknown slot');
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        const current = q.cosmetics.all(pet.id).find((c) => c.slot === slot);
        if (!current) fail(`${displayName(pet)} is not wearing anything there.`, 'Nothing to remove');
        q.takeOff.run(pet.id, slot);
        inventory.grant({ guildId, userId, item: current.item_key, type: 'pet_cosmetic_unequip', reference: String(pet.id), now });
        return { pet: load(pet.id, now), item: current.item_key };
      });
    },

    /**
     * Releases a pet. `confirmation` must be the pet's name, typed by the owner, so this can
     * never happen by accident. Accessories go back to the inventory.
     */
    release({ guildId, userId, petId, confirmation, now = Date.now() }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        if (pet.status === 'expedition' || pet.status === 'battle') assertAvailable(pet);
        const normalise = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
        if (normalise(confirmation) !== normalise(displayName(pet))) fail(`The name you typed does not match **${displayName(pet)}**. Nothing was released.`, 'Not released');
        for (const worn of q.cosmetics.all(pet.id)) {
          inventory.grant({ guildId, userId, item: worn.item_key, type: 'pet_cosmetic_unequip', reference: String(pet.id), now });
          q.takeOff.run(pet.id, worn.slot);
        }
        const wasActive = pet.active;
        Object.assign(pet, { status: 'released', active: 0, busy_until: null, released_at: now });
        save(pet);
        if (wasActive) {
          const next = q.owned.get(guildId, userId);
          if (next) q.setActive.run(next.id);
        }
        return { pet: load(pet.id, now) };
      });
    },

    // ── Battles (used by petBattleService inside its transactions) ────────

    /** Locks a pet for a battle. It must be free and have the energy to fight. */
    reserveForBattle({ guildId, userId, petId = null, energy, now = Date.now() }) {
      return tx(() => {
        const pet = resolve(guildId, userId, petId, now);
        assertAvailable(pet);
        const cost = energyCost(pet, energy);
        if (pet.energy < cost) fail(`${displayName(pet)} needs ${cost} energy to battle but has ${pet.energy}.`, 'Too tired');
        pet.status = 'battle';
        save(pet);
        return load(pet.id, now);
      });
    },

    /** Takes a battle's energy cost from a reserved pet. */
    chargeBattle(petId, energy, now = Date.now()) {
      const pet = load(petId, now);
      pet.energy = Math.max(0, pet.energy - energyCost(pet, energy));
      save(pet);
      return load(petId, now);
    },

    /** Ends a pet's battle: XP (if rewarded), the win or loss record, and unlocks it. */
    finishBattle({ petId, result, xp = 0, now = Date.now(), settings }) {
      const pet = load(petId, now);
      if (!pet) return null;
      const levels = xp > 0 ? gainXp(pet, xp, settings) : null;
      if (result === 'win') pet.battles_won += 1;
      if (result === 'loss') pet.battles_lost += 1;
      if (pet.status === 'battle') pet.status = 'idle';
      save(pet);
      return { pet: load(petId, now), levels };
    },

    /** Unlocks a reserved pet without a result (a declined or expired challenge). */
    unreserve(petId, now = Date.now()) {
      const pet = load(petId, now);
      if (pet?.status === 'battle') {
        pet.status = 'idle';
        save(pet);
      }
    },
  };
}
