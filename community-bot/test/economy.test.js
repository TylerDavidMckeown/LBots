import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserError } from '@lyss/shared/errorReporter.js';
import {
  currentStreak, levelForXp, nextDailyStreak, parseAmountInput, rewardAmount, rewardPeriod, rollCrime, rollRob, settingsProblem,
} from '../src/services/economyRules.js';
import { createEconomyService } from '../src/services/economyService.js';
import { communityDb, economyDefaults, sequence } from './helpers.js';

const G = 'guild';
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 23, 12); // Friday 23 October 2026, 12:00 UTC
const s = economyDefaults();

function setup() {
  const db = communityDb();
  const economy = createEconomyService(db);
  const fund = (userId, amount) => economy.credit({ guildId: G, userId, amount, type: 'test', settings: s, now: T0 });
  return { db, economy, fund };
}

const claim = (economy, userId, kind, now, zone = 'UTC', settings = s) => economy.claimReward({ guildId: G, userId, kind, now, zone, settings });

test('reward periods follow the server timezone', () => {
  assert.equal(rewardPeriod('daily', T0, 'UTC').period, '2026-10-23');
  assert.equal(rewardPeriod('daily', Date.UTC(2026, 9, 23, 23, 30), 'Asia/Tokyo').period, '2026-10-24');
  assert.equal(rewardPeriod('weekly', T0, 'UTC').period, '2026-W43');
  assert.equal(rewardPeriod('monthly', T0, 'UTC').period, '2026-10');
  assert.equal(new Date(rewardPeriod('daily', T0, 'UTC').endAt).toISOString(), '2026-10-24T00:00:00.000Z');
});

test('daily rewards: one claim per day, even across timezone changes', () => {
  const { economy } = setup();
  assert.equal(claim(economy, 'u', 'daily', T0).amount, 500);
  assert.throws(() => claim(economy, 'u', 'daily', T0 + 60_000), (e) => e instanceof UserError && /already claimed/.test(e.message));
  // Switching to a timezone where it is already "tomorrow" must not open a second claim.
  assert.throws(() => claim(economy, 'u', 'daily', T0 + 60_000, 'Pacific/Kiritimati'), /already claimed/);
  assert.equal(claim(economy, 'u', 'daily', Date.UTC(2026, 9, 24, 0, 1)).amount, 550, 'next day continues the streak');
});

test('daily streak grows, caps, and resets after a missed day', () => {
  assert.equal(nextDailyStreak(null, T0), 1);
  const last = { streak: 4, period_end_at: Date.UTC(2026, 9, 24) };
  assert.equal(nextDailyStreak(last, Date.UTC(2026, 9, 24, 23)), 5);
  assert.equal(nextDailyStreak(last, Date.UTC(2026, 9, 25, 0, 1)), 1);
  assert.equal(currentStreak(last, Date.UTC(2026, 9, 25, 1)), 0);
  assert.deepEqual(rewardAmount('daily', 1, s), { base: 500, bonus: 0, total: 500 });
  assert.deepEqual(rewardAmount('daily', 4, s), { base: 500, bonus: 150, total: 650 });
  assert.equal(rewardAmount('daily', 50, s).bonus, 500, 'bonus is capped at 10 days');

  const { economy } = setup();
  for (let day = 0; day < 3; day += 1) claim(economy, 'u', 'daily', T0 + day * DAY);
  assert.equal(economy.rewardStatus({ guildId: G, userId: 'u', kind: 'daily', settings: s, now: T0 + 3 * DAY }).streak, 4);
  assert.equal(claim(economy, 'u', 'daily', T0 + 5 * DAY).streak, 1, 'a missed day resets the streak');
});

test('weekly and monthly rewards use separate claims', () => {
  const { economy } = setup();
  assert.equal(claim(economy, 'u', 'weekly', T0).amount, 3_500);
  assert.equal(claim(economy, 'u', 'monthly', T0).amount, 15_000);
  claim(economy, 'u', 'daily', T0);
  assert.throws(() => claim(economy, 'u', 'weekly', T0 + DAY), /already claimed/, 'still the same ISO week');
  assert.equal(claim(economy, 'u', 'weekly', Date.UTC(2026, 9, 26)).amount, 3_500, 'Monday starts a new week');
  assert.equal(economy.account(G, 'u').wallet, 3_500 + 15_000 + 500 + 3_500);
});

test('every balance change is recorded with the balance afterwards', () => {
  const { economy, fund } = setup();
  fund('a', 1_000);
  economy.deposit({ guildId: G, userId: 'a', amount: 400, settings: s });
  economy.withdraw({ guildId: G, userId: 'a', amount: 100, settings: s });
  const rows = economy.transactions(G, 'a', 10).reverse().map((t) => [t.type, t.account, t.amount, t.balance_after]);
  assert.deepEqual(rows, [
    ['test', 'wallet', 1000, 1000],
    ['deposit', 'wallet', -400, 600],
    ['deposit', 'bank', 400, 400],
    ['withdraw', 'wallet', 100, 700],
    ['withdraw', 'bank', -100, 300],
  ]);
  const account = economy.account(G, 'a');
  assert.equal(account.wallet + account.bank, 1_000, 'bank moves never create or destroy coins');
});

test('payments: validation, insufficient funds and no overspending', () => {
  const { economy, fund } = setup();
  fund('a', 500);
  const pay = (amount, toId = 'b') => economy.transfer({ guildId: G, fromId: 'a', toId, amount, settings: s });
  for (const bad of [0, -5, 1.5, Number.NaN]) assert.throws(() => pay(bad), /positive whole number/);
  assert.throws(() => pay(10, 'a'), /cannot pay yourself/);
  assert.throws(() => pay(501), /only have/);
  pay(300);
  assert.throws(() => pay(300), /only have/, 'a second payment cannot overspend');
  assert.equal(economy.account(G, 'a').wallet, 200);
  assert.equal(economy.account(G, 'b').wallet, 300);
  assert.throws(() => economy.transfer({ guildId: G, fromId: 'a', toId: 'b', amount: 101, settings: economyDefaults({ payMax: 100 }) }), /largest single payment/);
});

test('pay confirmations execute exactly once and expire', () => {
  const { economy, fund } = setup();
  fund('a', 1_000);
  economy.createPending({ id: 'p1', guildId: G, userId: 'a', kind: 'pay', payload: { toId: 'b', amount: 250 }, now: T0 });
  assert.throws(() => economy.confirmPayment({ pendingId: 'p1', userId: 'mallory', settings: s, now: T0 }), /not yours/);
  economy.confirmPayment({ pendingId: 'p1', userId: 'a', settings: s, now: T0 + 1_000 });
  assert.throws(() => economy.confirmPayment({ pendingId: 'p1', userId: 'a', settings: s, now: T0 + 2_000 }), /already handled/);
  assert.equal(economy.account(G, 'b').wallet, 250);

  economy.createPending({ id: 'p2', guildId: G, userId: 'a', kind: 'pay', payload: { toId: 'b', amount: 5 }, now: T0, ttlMs: 1_000 });
  assert.throws(() => economy.confirmPayment({ pendingId: 'p2', userId: 'a', settings: s, now: T0 + 5_000 }), /expired/);
  assert.equal(economy.account(G, 'b').wallet, 250);
});

test('a failed confirmed payment rolls back and stays usable', () => {
  const { economy, fund } = setup();
  fund('a', 100);
  economy.createPending({ id: 'p', guildId: G, userId: 'a', kind: 'pay', payload: { toId: 'b', amount: 80 }, now: T0 });
  economy.transfer({ guildId: G, fromId: 'a', toId: 'c', amount: 50, settings: s });
  assert.throws(() => economy.confirmPayment({ pendingId: 'p', userId: 'a', settings: s, now: T0 }), /only have/);
  fund('a', 100);
  economy.confirmPayment({ pendingId: 'p', userId: 'a', settings: s, now: T0 });
  assert.equal(economy.account(G, 'b').wallet, 80);
});

test('wallet limits apply to credits', () => {
  const { economy } = setup();
  const capped = economyDefaults({ maxWallet: 1_000 });
  economy.credit({ guildId: G, userId: 'a', amount: 900, type: 'test', settings: capped });
  assert.throws(() => economy.credit({ guildId: G, userId: 'a', amount: 200, type: 'test', settings: capped }), /limit/);
  assert.equal(economy.account(G, 'a').wallet, 900);
});

test('admin adjustments need a reason, cannot go negative and are audited', () => {
  const { economy } = setup();
  const admin = (action, amount, extra = {}) => economy.adminAdjust({ guildId: G, actorId: 'admin', targetId: 'u', action, amount, reason: 'Event prize', settings: s, ...extra });
  assert.throws(() => admin('add', 100, { reason: ' ' }), /need a reason/);
  admin('add', 1_000);
  assert.throws(() => admin('remove', 2_000), /only has/);
  admin('remove', 300);
  admin('set', 50, { account: 'bank' });
  assert.throws(() => admin('set', 50, { account: 'bank' }), /already/);
  economy.adminReset({ guildId: G, actorId: 'admin', targetId: 'u', reason: 'Exploit', settings: s });
  assert.deepEqual([economy.account(G, 'u').wallet, economy.account(G, 'u').bank], [0, 0]);
  assert.deepEqual(economy.auditLog(G, 10).map((a) => a.action).reverse(), ['add_wallet', 'remove_wallet', 'set_bank', 'reset']);
  assert.ok(economy.transactionCount(G, 'u') >= 4, 'history is kept after a reset');
});

test('frozen accounts cannot claim, pay or receive', () => {
  const { economy, fund } = setup();
  fund('a', 500);
  economy.setFrozen({ guildId: G, actorId: 'admin', targetId: 'a', frozen: true, reason: 'Investigation', settings: s });
  assert.throws(() => claim(economy, 'a', 'daily', T0), /frozen/);
  assert.throws(() => economy.transfer({ guildId: G, fromId: 'a', toId: 'b', amount: 10, settings: s }), /frozen/);
  fund('b', 50);
  assert.throws(() => economy.transfer({ guildId: G, fromId: 'b', toId: 'a', amount: 10, settings: s }), /frozen/);
  economy.setFrozen({ guildId: G, actorId: 'admin', targetId: 'a', frozen: false, settings: s });
  assert.equal(claim(economy, 'a', 'daily', T0).amount, 500);
});

test('crime: deterministic outcomes, fines capped at the wallet, persistent cooldown', () => {
  const { economy, fund } = setup();
  fund('u', 50);
  // rng: scenario pick, success roll (99 → fail), fine amount (max).
  const result = economy.crime({ guildId: G, userId: 'u', settings: s, now: T0, rng: sequence(0, 0.99, 0.999) });
  assert.equal(result.success, false);
  assert.equal(result.amount, 50, 'fine limited to what the member has');
  assert.equal(economy.account(G, 'u').wallet, 0);
  assert.throws(() => economy.crime({ guildId: G, userId: 'u', settings: s, now: T0 + 1_000 }), /laying low/);
  const win = economy.crime({ guildId: G, userId: 'u', settings: s, now: T0 + s.crimeCooldown, rng: sequence(0, 0, 0) });
  assert.equal(win.success, true);
  assert.equal(win.amount, s.crimeRewardMin);
});

test('robbery: eligibility, protection, compensation and banks are safe', () => {
  const { economy, fund } = setup();
  fund('robber', 1_000);
  fund('victim', 2_000);
  economy.deposit({ guildId: G, userId: 'victim', amount: 1_600, settings: s });
  assert.throws(() => economy.rob({ guildId: G, robberId: 'robber', victimId: 'victim', settings: s, now: T0 }), /worth robbing/, 'only the wallet counts');
  economy.withdraw({ guildId: G, userId: 'victim', amount: 600, settings: s });

  const success = economy.rob({ guildId: G, robberId: 'robber', victimId: 'victim', settings: s, now: T0, rng: sequence(0, 0.999) });
  assert.equal(success.success, true);
  assert.equal(success.amount, 250, '25% of a 1,000 wallet');
  assert.equal(economy.account(G, 'victim').bank, 1_000, 'the bank is untouched');
  assert.throws(() => economy.rob({ guildId: G, robberId: 'robber', victimId: 'victim', settings: s, now: T0 + 1 }), /another robbery/);

  fund('robber2', 1_000);
  assert.throws(() => economy.rob({ guildId: G, robberId: 'robber2', victimId: 'victim', settings: s, now: T0 + 1 }), /protected/);
  const failed = economy.rob({ guildId: G, robberId: 'robber2', victimId: 'victim', settings: s, now: T0 + s.robProtection, rng: sequence(0.99) });
  assert.equal(failed.success, false);
  assert.equal(failed.amount, 150, '15% of the robber\'s wallet is paid to the victim');
  assert.equal(economy.account(G, 'robber2').wallet, 850);
});

test('cooldowns and claims survive a restart', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyss-economy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'community.db');
  const first = communityDb(file);
  const economyA = createEconomyService(first);
  claim(economyA, 'u', 'daily', T0);
  economyA.crime({ guildId: G, userId: 'u', settings: s, now: T0, rng: sequence(0, 0, 0) });
  first.close();

  const second = communityDb(file);
  const economyB = createEconomyService(second);
  assert.throws(() => claim(economyB, 'u', 'daily', T0 + 1_000), /already claimed/);
  assert.throws(() => economyB.crime({ guildId: G, userId: 'u', settings: s, now: T0 + 1_000 }), /laying low/);
  second.close();
});

test('leaderboard ranks by the chosen metric and skips empty accounts', () => {
  const { economy, fund } = setup();
  fund('a', 300);
  fund('b', 100);
  fund('c', 200);
  economy.deposit({ guildId: G, userId: 'b', amount: 100, settings: s });
  economy.account(G, 'empty');
  assert.deepEqual(economy.leaderboard(G, 'networth').map((r) => r.user_id), ['a', 'c', 'b']);
  assert.deepEqual(economy.leaderboard(G, 'bank').map((r) => r.user_id), ['b']);
  assert.equal(economy.rank(G, 'c'), 2);
  assert.equal(economy.rank(G, 'empty'), null);
  assert.equal(economy.leaderboardCount(G, 'wallet'), 2);
});

test('rules helpers', () => {
  assert.equal(parseAmountInput('1,500', 0), 1_500);
  assert.equal(parseAmountInput('2.5k', 0), 2_500);
  assert.equal(parseAmountInput('all', 321), 321);
  assert.equal(parseAmountInput('half', 321), 160);
  for (const bad of ['', '0', '-1', 'abc', '1.5', 'all']) assert.equal(parseAmountInput(bad, 0), null, bad);
  assert.equal(levelForXp(0), 0);
  assert.equal(levelForXp(50), 1);
  assert.equal(levelForXp(199), 1);
  assert.equal(levelForXp(200), 2);
  assert.equal(settingsProblem(economyDefaults({ crimeRewardMin: 900 })), 'crimeRewardMin cannot be larger than crimeRewardMax.');
  assert.equal(rollCrime(sequence(0, 0, 0.5), s).amount, 375);
  assert.deepEqual(rollRob(sequence(0.99), s, 10_000, 40), { success: false, amount: 40 });
});
