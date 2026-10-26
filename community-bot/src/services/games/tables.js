/**
 * Every game payout table and reward amount, in one place. Engines read these values
 * and /games publishes them, so what players see is exactly what the code pays.
 * Payouts are the total returned to the player, stake included.
 */

// ── Slots: three independent reels ─────────────────────────────────────────

export const SLOT_SYMBOLS = Object.freeze([
  { emoji: '🍒', name: 'Cherry', weight: 5, triple: 4 },
  { emoji: '🍋', name: 'Lemon', weight: 5, triple: 4 },
  { emoji: '🔔', name: 'Bell', weight: 4, triple: 6 },
  { emoji: '⭐', name: 'Star', weight: 3, triple: 10 },
  { emoji: '💎', name: 'Diamond', weight: 2, triple: 20 },
  { emoji: '7️⃣', name: 'Seven', weight: 1, triple: 50 },
]);
/** Any two matching symbols. */
export const SLOT_PAIR_MULTIPLIER = 1.5;

// ── Roulette: European single-zero wheel ───────────────────────────────────

export const ROULETTE_RED = Object.freeze(new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]));
export const ROULETTE_BETS = Object.freeze({
  red: { label: 'Red', multiplier: 2 },
  black: { label: 'Black', multiplier: 2 },
  odd: { label: 'Odd', multiplier: 2 },
  even: { label: 'Even', multiplier: 2 },
  low: { label: 'Low (1–18)', multiplier: 2 },
  high: { label: 'High (19–36)', multiplier: 2 },
  number: { label: 'Single number', multiplier: 36 },
});

// ── Blackjack ──────────────────────────────────────────────────────────────

export const BLACKJACK = Object.freeze({ win: 2, natural: 2.5, dealerStandsOn: 17 });

// ── Higher or Lower ────────────────────────────────────────────────────────

export const HIGHER_LOWER = Object.freeze({
  min: 1,
  max: 100,
  maxRounds: 10,
  maxMultiplier: 50,
  /** Each correct guess multiplies the stake by returnRate ÷ (chance of that guess). */
  returnRate: 0.95,
  freeCoinsPerRound: 15,
  freeXpPerRound: 2,
});

// ── Scratch cards ──────────────────────────────────────────────────────────

export const SCRATCH_PRICE = 250;
/** Weights are out of 10,000. Three matching symbols win that prize. */
export const SCRATCH_PRIZES = Object.freeze([
  { symbol: '💎', prize: 10_000, weight: 15 },
  { symbol: '👑', prize: 2_500, weight: 100 },
  { symbol: '💰', prize: 1_000, weight: 400 },
  { symbol: '⭐', prize: 500, weight: 1_200 },
  { symbol: '🍀', prize: 250, weight: 1_800 },
  { symbol: '🍒', prize: 100, weight: 2_500 },
  { symbol: null, prize: 0, weight: 3_985 },
]);

// ── Daily spin ─────────────────────────────────────────────────────────────

export const SPIN_SEGMENTS = Object.freeze([
  { key: 'coins100', emoji: '🪙', label: '100 LC', weight: 30, coins: 100 },
  { key: 'coins250', emoji: '🪙', label: '250 LC', weight: 24, coins: 250 },
  { key: 'coins500', emoji: '💰', label: '500 LC', weight: 16, coins: 500 },
  { key: 'coins1000', emoji: '💰', label: '1,000 LC', weight: 7, coins: 1_000 },
  { key: 'coins2500', emoji: '💎', label: '2,500 LC jackpot', weight: 2, coins: 2_500 },
  { key: 'jobxp', emoji: '🧰', label: '75 job XP', weight: 12, jobXp: 75 },
  { key: 'xp', emoji: '✨', label: '100 economy XP', weight: 9, xp: 100 },
  { key: 'petxp', emoji: '🐾', label: '60 pet XP (150 LC if you have no pet)', weight: 8, petXp: 60, fallbackCoins: 150 },
  { key: 'petfood', emoji: '🍓', label: '2 Berry Treats', weight: 8, items: [{ item: 'berry_treat', quantity: 2 }] },
]);

// ── Free games: base rewards before the server's reward multiplier and daily cap ──

export const FREE_REWARDS = Object.freeze({
  trivia: { easy: { coins: 60, xp: 5 }, medium: { coins: 100, xp: 8 }, hard: { coins: 150, xp: 12 } },
  quickmath: { easy: { coins: 50, xp: 4 }, medium: { coins: 90, xp: 6 }, hard: { coins: 140, xp: 9 } },
  guess: { easy: { coins: 60, xp: 4 }, medium: { coins: 100, xp: 6 }, hard: { coins: 160, xp: 10 } },
  memory: { easy: { coins: 80, xp: 5 }, medium: { coins: 120, xp: 7 }, hard: { coins: 170, xp: 10 } },
  unscramble: { easy: { coins: 50, xp: 4 }, medium: { coins: 90, xp: 6 }, hard: { coins: 140, xp: 9 } },
  wordguess: { base: 60, perSpareGuess: 30, xp: 4 },
  pattern: { perCorrect: 40, perfectBonus: 30, multiplier: { easy: 1, medium: 1.5, hard: 2 }, xpPerCorrect: 2 },
  reaction: { min: 30, max: 120, xp: 3 },
  rps: { coins: 15, xp: 2 },
  duelWinnerXp: 10,
});

// ── Fishing ────────────────────────────────────────────────────────────────

export const FISH_RARITIES = Object.freeze({
  junk: { label: 'Junk', weight: 12, qualityBonus: -1 },
  common: { label: 'Common', weight: 50, qualityBonus: 0 },
  uncommon: { label: 'Uncommon', weight: 24, qualityBonus: 0.5 },
  rare: { label: 'Rare', weight: 10, qualityBonus: 1, levelBonus: true },
  epic: { label: 'Epic', weight: 3.5, qualityBonus: 1.5, levelBonus: true },
  legendary: { label: 'Legendary', weight: 0.5, qualityBonus: 2, levelBonus: true },
});
export const FISH = Object.freeze([
  { emoji: '👢', name: 'Old boot', rarity: 'junk', value: 5, xp: 2 },
  { emoji: '🥫', name: 'Tin can', rarity: 'junk', value: 5, xp: 2 },
  { emoji: '🌿', name: 'Seaweed', rarity: 'junk', value: 10, xp: 2 },
  { emoji: '🐟', name: 'Cod', rarity: 'common', value: 40, xp: 5 },
  { emoji: '🐟', name: 'Mackerel', rarity: 'common', value: 45, xp: 5 },
  { emoji: '🐠', name: 'Perch', rarity: 'common', value: 50, xp: 5 },
  { emoji: '🐠', name: 'Rainbow trout', rarity: 'uncommon', value: 90, xp: 8 },
  { emoji: '🍣', name: 'Salmon', rarity: 'uncommon', value: 110, xp: 8 },
  { emoji: '🐡', name: 'Pufferfish', rarity: 'rare', value: 180, xp: 12 },
  { emoji: '🦑', name: 'Squid', rarity: 'rare', value: 200, xp: 12 },
  { emoji: '🗡️', name: 'Swordfish', rarity: 'epic', value: 400, xp: 20 },
  { emoji: '🎏', name: 'Golden koi', rarity: 'epic', value: 450, xp: 20 },
  { emoji: '🦈', name: 'Ancient coelacanth', rarity: 'legendary', value: 1_000, xp: 40 },
]);

// ── Treasure hunt ──────────────────────────────────────────────────────────

export const TREASURE = Object.freeze({
  columns: 5,
  size: 20,
  digs: 7,
  traps: 2,
  loot: Object.freeze([
    { key: 'relic', emoji: '👑', name: 'Royal relic', value: 500, count: 1 },
    { key: 'gems', emoji: '💎', name: 'Gem cache', value: 200, count: 2 },
    { key: 'coins', emoji: '💰', name: 'Coin pouch', value: 60, count: 3 },
  ]),
  /** Chance that the relic is replaced by something far rarer. */
  rare: Object.freeze({ chance: 0.03, key: 'crown', emoji: '✨', name: 'Ancient crown', value: 1_500 }),
  xp: 5,
});
