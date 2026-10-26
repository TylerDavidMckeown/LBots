import { DateTime } from 'luxon';
import { formatNumber } from '@lyss/shared/utils/text.js';
import { isValidTimezone } from '@lyss/shared/utils/time.js';

/**
 * Pure economy rules: settings, reward periods, streaks and random outcomes.
 * Randomness is injected (`rng`) so outcomes are server-side and testable.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export const CURRENCY = Object.freeze({ name: 'Lyss Coins', code: 'LC', emoji: '🪙' });
export const formatCoins = (amount) => `${CURRENCY.emoji} ${formatNumber(amount)} ${CURRENCY.code}`;

export const ECONOMY_SETTINGS = Object.freeze([
  { key: 'economy.startingBalance', type: 'integer', label: 'Starting balance', default: 0, min: 0, max: 1_000_000 },
  { key: 'economy.dailyAmount', type: 'integer', label: 'Daily reward', default: 500, min: 0, max: 1_000_000 },
  { key: 'economy.dailyStreakBonus', type: 'integer', label: 'Daily streak bonus per day', default: 50, min: 0, max: 100_000 },
  { key: 'economy.dailyStreakCap', type: 'integer', label: 'Daily streak bonus cap (days)', default: 10, min: 0, max: 365 },
  { key: 'economy.weeklyAmount', type: 'integer', label: 'Weekly reward', default: 3_500, min: 0, max: 10_000_000 },
  { key: 'economy.monthlyAmount', type: 'integer', label: 'Monthly reward', default: 15_000, min: 0, max: 100_000_000 },
  { key: 'economy.payMax', type: 'integer', label: 'Largest single payment', default: 1_000_000, min: 1, max: 1_000_000_000 },
  { key: 'economy.maxWallet', type: 'integer', label: 'Wallet limit (0 = none)', default: 0, min: 0, max: 1_000_000_000_000 },
  { key: 'economy.crimeEnabled', type: 'boolean', label: 'Crime enabled', default: true },
  { key: 'economy.crimeCooldown', type: 'duration', label: 'Crime cooldown', default: HOUR, min: 60_000, max: 7 * DAY },
  { key: 'economy.crimeSuccessRate', type: 'integer', label: 'Crime success chance (%)', default: 55, min: 0, max: 100 },
  { key: 'economy.crimeRewardMin', type: 'integer', label: 'Crime reward minimum', default: 150, min: 0, max: 1_000_000 },
  { key: 'economy.crimeRewardMax', type: 'integer', label: 'Crime reward maximum', default: 600, min: 0, max: 1_000_000 },
  { key: 'economy.crimeFineMin', type: 'integer', label: 'Crime fine minimum', default: 100, min: 0, max: 1_000_000 },
  { key: 'economy.crimeFineMax', type: 'integer', label: 'Crime fine maximum', default: 400, min: 0, max: 1_000_000 },
  { key: 'economy.robEnabled', type: 'boolean', label: 'Robbery enabled', default: true },
  { key: 'economy.robCooldown', type: 'duration', label: 'Robbery cooldown', default: 2 * HOUR, min: 60_000, max: 7 * DAY },
  { key: 'economy.robProtection', type: 'duration', label: 'Protection after being robbed', default: HOUR, min: 60_000, max: 7 * DAY },
  { key: 'economy.robSuccessRate', type: 'integer', label: 'Robbery success chance (%)', default: 40, min: 0, max: 100 },
  { key: 'economy.robMaxPercent', type: 'integer', label: 'Most of a wallet that can be stolen (%)', default: 25, min: 1, max: 100 },
  { key: 'economy.robMaxAmount', type: 'integer', label: 'Most that can be stolen at once', default: 5_000, min: 1, max: 100_000_000 },
  { key: 'economy.robMinVictimWallet', type: 'integer', label: 'Victim wallet needed to be robbed', default: 500, min: 1, max: 100_000_000 },
  { key: 'economy.robMinRobberWallet', type: 'integer', label: 'Wallet needed to attempt a robbery', default: 250, min: 0, max: 100_000_000 },
  { key: 'economy.workEnabled', type: 'boolean', label: 'Work enabled', default: true },
  { key: 'economy.workCooldown', type: 'duration', label: 'Break between jobs', default: 20 * 60_000, min: 60_000, max: DAY },
  { key: 'economy.workPayoutPercent', type: 'integer', label: 'Job payout multiplier (%)', default: 100, min: 10, max: 500 },
  { key: 'economy.gamesEnabled', type: 'boolean', label: 'Mini-games enabled', default: true },
  { key: 'economy.gameMinBet', type: 'integer', label: 'Smallest game stake', default: 10, min: 1, max: 1_000_000 },
  { key: 'economy.gameMaxBet', type: 'integer', label: 'Largest game stake', default: 50_000, min: 1, max: 1_000_000_000 },
  { key: 'economy.gameCooldownPercent', type: 'integer', label: 'Game cooldown length (%)', default: 100, min: 25, max: 1_000 },
  { key: 'economy.gameRewardPercent', type: 'integer', label: 'Free-game reward multiplier (%)', default: 100, min: 0, max: 500 },
  { key: 'economy.freeGameDailyCap', type: 'integer', label: 'Coins from free games per 24 hours', default: 5_000, min: 0, max: 100_000_000 },
  { key: 'economy.petsEnabled', type: 'boolean', label: 'Pets enabled', default: true },
  { key: 'economy.petMax', type: 'integer', label: 'Most pets per member', default: 10, min: 1, max: 50 },
  { key: 'economy.petPricePercent', type: 'integer', label: 'Pet adoption prices (%)', default: 100, min: 0, max: 1_000 },
  { key: 'economy.petXpPercent', type: 'integer', label: 'Pet XP multiplier (%)', default: 100, min: 10, max: 500 },
  { key: 'economy.progressionXpPercent', type: 'integer', label: 'Member XP multiplier (%)', default: 100, min: 0, max: 500 },
]);

export const ECONOMY_DEFAULTS = Object.freeze(Object.fromEntries(ECONOMY_SETTINGS.map((s) => [s.key, s.default])));

/** Current settings, keyed without the "economy." prefix. */
export function economySettings(guildConfig, guildId) {
  return Object.fromEntries(ECONOMY_SETTINGS.map((s) => [s.key.slice('economy.'.length), guildConfig.get(guildId, s.key)]));
}

const PAIRS = [['crimeRewardMin', 'crimeRewardMax'], ['crimeFineMin', 'crimeFineMax'], ['gameMinBet', 'gameMaxBet']];

/** Rejects settings where a minimum exceeds its maximum. */
export function settingsProblem(settings) {
  for (const [min, max] of PAIRS) {
    if (settings[min] > settings[max]) return `${min} cannot be larger than ${max}.`;
  }
  return null;
}

export const REWARD_KINDS = Object.freeze({
  daily: { label: 'Daily', emoji: '📅', unit: 'day', xp: 10 },
  weekly: { label: 'Weekly', emoji: '🗓️', unit: 'week', xp: 50 },
  monthly: { label: 'Monthly', emoji: '🌙', unit: 'month', xp: 150 },
});

/**
 * The reward period containing `now` in the server timezone. Claims store the
 * period end in UTC, so later timezone changes cannot open an early second claim.
 */
export function rewardPeriod(kind, now, zone) {
  const local = DateTime.fromMillis(now, { zone: isValidTimezone(zone) ? zone : 'UTC' });
  const { unit } = REWARD_KINDS[kind];
  const start = local.startOf(unit);
  const end = start.plus({ [`${unit}s`]: 1 });
  const period = kind === 'daily' ? start.toISODate() : kind === 'weekly' ? start.toFormat("kkkk-'W'WW") : start.toFormat('yyyy-MM');
  return { period, startAt: start.toMillis(), endAt: end.toMillis() };
}

/** The streak the next daily claim would have: it continues if claimed during the following day. */
export function nextDailyStreak(lastClaim, now) {
  if (!lastClaim) return 1;
  return now < lastClaim.period_end_at + DAY ? lastClaim.streak + 1 : 1;
}

/** The streak right now: zero once a day has been missed. */
export function currentStreak(lastClaim, now) {
  if (!lastClaim) return 0;
  return now < lastClaim.period_end_at + DAY ? lastClaim.streak : 0;
}

export function rewardAmount(kind, streak, settings) {
  if (kind === 'daily') {
    const bonus = Math.min(Math.max(streak - 1, 0), settings.dailyStreakCap) * settings.dailyStreakBonus;
    return { base: settings.dailyAmount, bonus, total: settings.dailyAmount + bonus };
  }
  const base = kind === 'weekly' ? settings.weeklyAmount : settings.monthlyAmount;
  return { base, bonus: 0, total: base };
}

export function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

const CRIME_SCENARIOS = [
  { success: 'You sold "limited edition" pixel-art potatoes to a collector', fail: 'The collector realised the potatoes were just potatoes' },
  { success: 'You won an underground rubber duck race with a suspiciously fast duck', fail: 'Your duck was disqualified for having a tiny motor' },
  { success: 'You smuggled extra snacks into the cinema and resold them at the interval', fail: 'Security confiscated your snack empire' },
  { success: 'You ran a fortune-telling stall and every prediction somehow came true', fail: 'Nobody trusts a fortune teller who forgot their own name' },
  { success: 'You returned a "lost" cat to its owner for the reward (it was never lost)', fail: 'The cat went straight home and told everyone' },
  { success: 'You out-stared the vending machine and it gave up its snacks', fail: 'The vending machine stared back. It won.' },
];

/** A fictional crime. Success pays a reward; failure costs a fine. */
export function rollCrime(rng, settings) {
  const scenario = CRIME_SCENARIOS[Math.floor(rng() * CRIME_SCENARIOS.length)];
  const success = rng() * 100 < settings.crimeSuccessRate;
  return success
    ? { success, text: scenario.success, amount: randomInt(rng, settings.crimeRewardMin, settings.crimeRewardMax) }
    : { success, text: scenario.fail, amount: randomInt(rng, settings.crimeFineMin, settings.crimeFineMax) };
}

/**
 * A robbery attempt. Success steals 10%–robMaxPercent of the victim's wallet, capped at robMaxAmount.
 * Failure fines 15% of the robber's wallet (at least 50, never more than they have), paid to the victim.
 */
export function rollRob(rng, settings, victimWallet, robberWallet) {
  if (rng() * 100 < settings.robSuccessRate) {
    const percent = randomInt(rng, Math.min(10, settings.robMaxPercent), settings.robMaxPercent);
    const amount = Math.max(1, Math.min(Math.floor((victimWallet * percent) / 100), settings.robMaxAmount, victimWallet));
    return { success: true, amount, percent };
  }
  return { success: false, amount: Math.min(robberWallet, Math.max(50, Math.floor(robberWallet * 0.15))) };
}

/** Economy level from XP: level n needs 50·n² XP. */
export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(xp, 0) / 50));
}
export const xpForLevel = (level) => 50 * level * level;

/**
 * Parses "1500", "1,500", "2.5k", "all" or "half" against an available balance.
 * Returns a positive integer, or null when invalid.
 */
export function parseAmountInput(input, available) {
  const text = String(input ?? '').trim().toLowerCase().replace(/,/g, '');
  let amount;
  if (text === 'all' || text === 'max') amount = available;
  else if (text === 'half') amount = Math.floor(available / 2);
  else {
    const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(text);
    if (!match) return null;
    amount = Number(match[1]) * ({ k: 1_000, m: 1_000_000 }[match[2]] ?? 1);
  }
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
