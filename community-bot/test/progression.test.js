import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '@lyss/shared/errorReporter.js';
import { createGameWorld } from '../src/services/index.js';
import { JOBS } from '../src/services/jobTasks.js';
import { DESTINATIONS } from '../src/services/pets/catalogue.js';
import {
  baseXpFor, LEVEL_MILESTONES, levelCoins, levelRewards, memberLevelForXp, XP_SOURCES, xpForMemberLevel,
} from '../src/services/progressionRules.js';
import { SPIN_SEGMENTS } from '../src/services/games/tables.js';
import { ITEMS } from '../src/services/items.js';
import { progressionLines } from '../src/features/progression.js';
import { communityDb, economyDefaults, seeded } from './helpers.js';

const G = 'guild';
const T0 = Date.UTC(2026, 9, 24, 12);
const DAY = 86_400_000;
const s = economyDefaults();

const isUserError = (pattern) => (error) => error instanceof UserError && pattern.test(error.message);

function setup() {
  const db = communityDb();
  const world = createGameWorld(db);
  const award = (source, operationKey, extra = {}) => world.progression.award({ guildId: G, userId: 'u', source, operationKey, now: T0, settings: s, ...extra });
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  return { db, ...world, award, count };
}

test('the progression tables are consistent', () => {
  for (const [level, milestone] of Object.entries(LEVEL_MILESTONES)) {
    for (const { item } of milestone.items ?? []) assert.ok(ITEMS[item], `level ${level}: ${item}`);
  }
  for (const destination of Object.keys(DESTINATIONS)) assert.ok(baseXpFor('expedition_completed', destination) > 0, destination);
  for (const difficulty of ['easy', 'medium', 'hard']) assert.ok(baseXpFor('job_completed', difficulty) > 0);
  assert.equal(memberLevelForXp(xpForMemberLevel(10)), 10);
  assert.equal(memberLevelForXp(xpForMemberLevel(10) - 1), 9);
  assert.equal(baseXpFor('nonsense'), 0);
});

test('an activity awards member XP exactly once, however often it is reported', () => {
  const { award, progression, count } = setup();
  const first = award('job_completed', 'work:abc', { variant: 'hard' });
  assert.equal(first.xp, XP_SOURCES.job_completed.xp.hard);
  assert.equal(award('job_completed', 'work:abc', { variant: 'hard' }), null, 'the same operation never pays twice');
  assert.equal(progression.profile(G, 'u').xp, first.xp);
  assert.equal(count('SELECT COUNT(*) AS n FROM xp_transactions'), 1);
  assert.equal(award('job_completed', 'work:other', { variant: 'unknown' }), null, 'unknown variants are not eligible');
  assert.throws(() => award('made_up', 'x'), /Unknown XP source/);
});

test('daily caps stop repeated activities from farming XP', () => {
  const { award } = setup();
  const cap = XP_SOURCES.game_won.dailyCap;
  for (let i = 0; i < cap; i += 1) assert.ok(award('game_won', `game:${i}`, { now: T0 + i }));
  assert.equal(award('game_won', 'game:over', { now: T0 + cap }), null);
  assert.ok(award('game_won', 'game:tomorrow', { now: T0 + DAY + 1 }), 'the cap is a rolling 24 hours');
});

test('levelling up grants each level\'s rewards once: coins to the bank, items and titles', () => {
  const { award, economy, inventory, progression, count } = setup();
  // Enough XP for several levels in one award (with a big multiplier).
  const result = award('collection_milestone', 'big', { settings: { ...s, progressionXpPercent: 600 } });
  const expectedLevel = memberLevelForXp(XP_SOURCES.collection_milestone.xp * 6);
  assert.equal(expectedLevel, 5);
  assert.equal(result.levelAfter, expectedLevel);
  assert.deepEqual(result.rewards.map((r) => r.level), Array.from({ length: expectedLevel - 1 }, (_, i) => i + 2));
  const coins = result.rewards.reduce((sum, r) => sum + r.coins, 0);
  assert.equal(economy.account(G, 'u').bank, coins);
  assert.equal(economy.account(G, 'u').wallet, 0, 'level rewards never touch the wallet');
  assert.equal(inventory.quantity(G, 'u', 'party_hat'), 1, 'level 3 reward');
  assert.equal(inventory.quantity(G, 'u', 'berry_treat'), 5, 'level 5 reward');
  assert.ok(progression.unlocks(G, 'u').some((u) => u.kind === 'title' && u.unlock_key === 'rising_star'));
  assert.equal(count('SELECT COUNT(*) AS n FROM level_rewards'), expectedLevel - 1);
  assert.match(progressionLines(result).join('\n'), new RegExp(`member level ${expectedLevel}`));
  assert.deepEqual(progressionLines(null), []);
  assert.equal(levelRewards(10).coins, levelCoins(10));
});

test('level rewards still arrive when the wallet is at its limit', () => {
  const { award, economy } = setup();
  const capped = { ...s, maxWallet: 100 };
  economy.credit({ guildId: G, userId: 'u', amount: 100, type: 'test', now: T0, settings: capped });
  const result = award('collection_milestone', 'level-up', { settings: capped });
  assert.ok(result.levelAfter > 1);
  assert.equal(economy.account(G, 'u').wallet, 100);
  assert.ok(economy.account(G, 'u').bank > 0);
});

test('a member XP multiplier of 0 turns member XP off', () => {
  const { award, progression } = setup();
  assert.equal(award('job_completed', 'work:1', { variant: 'easy', settings: { ...s, progressionXpPercent: 0 } }), null);
  assert.equal(progression.profile(G, 'u').xp, 0);
});

test('jobs award member XP once, and Pet Caretakers also earn Pet Treats', () => {
  const { jobs, progression, inventory, economy } = setup();
  const session = jobs.start({ guildId: G, userId: 'u', job: 'caretaker', difficulty: 'easy', now: T0, settings: s, rng: seeded(4) });
  let result;
  let current = session;
  do {
    result = jobs.act({ sessionId: current.id, userId: 'u', choice: String(current.state.rounds[current.state.round].answer), now: T0 + 5_000, settings: s, rng: seeded(5) });
    current = result.session;
  } while (!result.settlement);
  assert.equal(result.settlement.success, true);
  assert.deepEqual(result.settlement.items, [{ item: 'pet_treat', quantity: JOBS.caretaker.items.easy }]);
  assert.equal(inventory.quantity(G, 'u', 'pet_treat'), JOBS.caretaker.items.easy);
  assert.equal(progression.profile(G, 'u').xp, XP_SOURCES.job_completed.xp.easy);
  assert.equal(result.settlement.progression.xp, XP_SOURCES.job_completed.xp.easy);
  assert.equal(economy.account(G, 'u').wallet, result.settlement.reward);
  assert.throws(() => jobs.act({ sessionId: current.id, userId: 'u', choice: '0', now: T0 + 6_000, settings: s }), isUserError(/already finished/));
  assert.equal(progression.profile(G, 'u').xp, XP_SOURCES.job_completed.xp.easy);
});

test('winning a free puzzle awards member XP; games of chance never do', () => {
  const { games, economy, progression } = setup();
  const trivia = games.start({ guildId: G, userId: 'u', game: 'trivia', now: T0, settings: s, rng: seeded(1) }).session;
  const won = games.act({ sessionId: trivia.id, userId: 'u', action: `pick:${trivia.state.answer}`, now: T0 + 1_000, settings: s, rng: seeded(2) });
  assert.equal(won.settlement.players[0].result, 'win');
  assert.equal(won.settlement.players[0].progression.xp, XP_SOURCES.game_won.xp);

  economy.credit({ guildId: G, userId: 'u', amount: 1_000, type: 'test', now: T0, settings: s });
  const card = games.open({ guildId: G, userId: 'u', game: 'coinflip', stake: 100, now: T0 + 10_000, settings: s });
  const flip = games.begin({ sessionId: card.id, userId: 'u', action: 'heads', now: T0 + 11_000, settings: s, rng: () => 0.1 });
  assert.equal(flip.settlement.players[0].result, 'win');
  assert.equal(flip.settlement.players[0].progression, null);
  assert.equal(progression.profile(G, 'u').xp, XP_SOURCES.game_won.xp);
});

test('duel wins award member XP to the winner only', () => {
  const { games, progression } = setup();
  const challenge = games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-coinflip', now: T0, settings: s });
  const { settlement } = games.accept({ sessionId: challenge.id, userId: 'b', now: T0 + 1, settings: s, rng: () => 0.1 });
  const winner = settlement.players.find((p) => p.result === 'win');
  const loser = settlement.players.find((p) => p.result === 'loss');
  assert.equal(winner.userId, 'a');
  assert.equal(progression.profile(G, 'a').xp, XP_SOURCES.duel_won.xp);
  assert.equal(progression.profile(G, loser.userId).xp, 0);
});

test('daily, weekly and monthly claims award member XP once per period', () => {
  const { economy, progression } = setup();
  const claim = (kind, now) => economy.claimReward({ guildId: G, userId: 'u', kind, now, zone: 'UTC', settings: s });
  assert.equal(claim('daily', T0).progression.xp, XP_SOURCES.reward_claimed.xp.daily);
  assert.throws(() => claim('daily', T0 + 1), isUserError(/already claimed/));
  claim('weekly', T0);
  assert.equal(progression.profile(G, 'u').xp, XP_SOURCES.reward_claimed.xp.daily + XP_SOURCES.reward_claimed.xp.weekly);
});

test('the daily spin\'s pet segments: pet XP for the active pet, coins without one, and berry treats', () => {
  const { games, pets, inventory, economy } = setup();
  const segment = (key) => {
    const total = SPIN_SEGMENTS.reduce((sum, x) => sum + x.weight, 0);
    let before = 0;
    for (const x of SPIN_SEGMENTS) {
      if (x.key === key) return () => (before + x.weight / 2) / total;
      before += x.weight;
    }
    throw new Error(key);
  };
  const spin = (userId, key, now = T0) => games.dailySpin({ guildId: G, userId, now, zone: 'UTC', settings: s, rng: segment(key) });

  const noPet = spin('a', 'petxp');
  assert.equal(noPet.pet, null);
  assert.equal(noPet.coins, SPIN_SEGMENTS.find((x) => x.key === 'petxp').fallbackCoins);
  assert.equal(economy.account(G, 'a').wallet, noPet.coins);

  const offer = pets.prepareAdoption({ guildId: G, userId: 'b', species: 'meadow_bunny', now: T0, settings: s });
  const { pet } = pets.confirmAdoption({ pendingId: offer.pendingId, userId: 'b', now: T0, settings: s });
  const withPet = spin('b', 'petxp');
  assert.equal(withPet.coins, 0);
  assert.equal(pets.get(pet.id).xp, withPet.pet.levels.xp);

  const food = spin('c', 'petfood');
  assert.deepEqual(food.items, [{ item: 'berry_treat', quantity: 2 }]);
  assert.equal(inventory.quantity(G, 'c', 'berry_treat'), 2);
});

test('economy purchases and reward payments keep the ledger consistent', () => {
  const { economy, count } = setup();
  assert.throws(() => economy.debit({ guildId: G, userId: 'u', amount: 50, type: 'pet_adoption', now: T0, settings: s }), isUserError(/only have/));
  economy.credit({ guildId: G, userId: 'u', amount: 100, type: 'test', now: T0, settings: s });
  economy.debit({ guildId: G, userId: 'u', amount: 60, type: 'pet_adoption', now: T0, settings: s });
  economy.payReward({ guildId: G, userId: 'u', amount: 25, type: 'level_reward', now: T0, settings: s });
  const account = economy.account(G, 'u');
  assert.deepEqual([account.wallet, account.bank, account.lifetime_spent, account.lifetime_earned], [40, 25, 60, 125]);
  assert.equal(count(`SELECT COUNT(*) AS n FROM economy_transactions WHERE user_id = 'u'`), 3);
  assert.throws(() => economy.debit({ guildId: G, userId: 'u', amount: -5, type: 'x', now: T0, settings: s }), isUserError(/positive/));
});

test('inventory changes are recorded and can never go negative', () => {
  const { inventory, count } = setup();
  const args = { guildId: G, userId: 'u', type: 'test', now: T0 };
  assert.throws(() => inventory.use({ ...args, item: 'berry_treat' }), isUserError(/do not have enough/));
  inventory.grant({ ...args, item: 'berry_treat', quantity: 3 });
  inventory.use({ ...args, item: 'berry_treat', quantity: 2 });
  assert.throws(() => inventory.use({ ...args, item: 'berry_treat', quantity: 2 }), isUserError(/do not have enough/));
  assert.equal(inventory.quantity(G, 'u', 'berry_treat'), 1);
  assert.deepEqual(inventory.list(G, 'u'), [{ item: 'berry_treat', quantity: 1 }]);
  assert.equal(count('SELECT COUNT(*) AS n FROM inventory_transactions'), 2);
  assert.throws(() => inventory.grant({ ...args, item: 'not_an_item' }), /Unknown item/);
});
