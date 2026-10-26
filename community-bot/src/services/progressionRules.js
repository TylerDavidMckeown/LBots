/**
 * Member progression rules: every XP source, the level curve and level rewards, in one
 * place. Nothing else decides how much member XP an activity is worth.
 */

/**
 * XP per activity. `xp` is a number or a table keyed by the activity's variant
 * (job difficulty, reward kind, expedition destination). `dailyCap` limits how many
 * awards a source can give one member in any 24 hours, so repetition cannot farm XP.
 */
export const XP_SOURCES = Object.freeze({
  job_completed: { label: 'Jobs', emoji: '🧰', xp: { easy: 15, medium: 22, hard: 30 } },
  game_won: { label: 'Puzzle and reaction games', emoji: '🧩', xp: 10, dailyCap: 25 },
  duel_won: { label: 'Duel wins', emoji: '⚔️', xp: 15, dailyCap: 10 },
  reward_claimed: { label: 'Daily, weekly and monthly rewards', emoji: '📅', xp: { daily: 10, weekly: 40, monthly: 120 } },
  pet_care: { label: 'Pet care', emoji: '🐾', xp: 4, dailyCap: 25 },
  pet_adopted: { label: 'New pets', emoji: '🥚', xp: 25, dailyCap: 5 },
  expedition_completed: { label: 'Pet expeditions', emoji: '🧭', xp: { forest: 10, mountains: 20, ruins: 28, lair: 35, starfall: 50 } },
  pet_battle_won: { label: 'Pet battle wins', emoji: '🏟️', xp: 15, dailyCap: 10 },
  pet_evolved: { label: 'Pet evolutions', emoji: '🌟', xp: 100 },
  collection_milestone: { label: 'Collection milestones', emoji: '📚', xp: 150 },
});

/** Base XP for an activity before the server multiplier, or 0 if it is not eligible. */
export function baseXpFor(source, variant = null) {
  const def = XP_SOURCES[source];
  if (!def) return 0;
  return typeof def.xp === 'number' ? def.xp : def.xp[variant] ?? 0;
}

/** Member level n needs 50·(n−1)² XP: level 10 ≈ 4,000 XP, level 50 ≈ 120,000 XP. */
export const memberLevelForXp = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
export const xpForMemberLevel = (level) => 50 * (level - 1) ** 2;

export const TITLES = Object.freeze({
  rising_star: 'Rising Star',
  regular: 'Regular',
  veteran: 'Veteran',
  elite: 'Elite',
  champion: 'Champion',
  lyss_legend: 'Lyss Legend',
  pet_collector: 'Pet Collector',
  menagerie_master: 'Menagerie Master',
});

export const BADGES = Object.freeze({
  level_10: { name: 'Bronze Star', emoji: '🥉' },
  level_20: { name: 'Silver Star', emoji: '🥈' },
  level_30: { name: 'Gold Star', emoji: '🥇' },
  level_50: { name: 'Lyss Crown', emoji: '👑' },
  full_collection: { name: 'Full Collection', emoji: '📚' },
});

/** Extra rewards at milestone levels, on top of the coins every level pays. */
export const LEVEL_MILESTONES = Object.freeze({
  3: { items: [{ item: 'party_hat', quantity: 1 }] },
  5: { title: 'rising_star', items: [{ item: 'berry_treat', quantity: 5 }] },
  10: { title: 'regular', badge: 'level_10', items: [{ item: 'mystery_egg', quantity: 1 }] },
  15: { items: [{ item: 'explorer_scarf', quantity: 1 }, { item: 'evo_crystal', quantity: 1 }] },
  20: { title: 'veteran', badge: 'level_20', items: [{ item: 'golden_apple', quantity: 3 }] },
  25: { items: [{ item: 'tiny_cape', quantity: 1 }, { item: 'mystery_egg', quantity: 1 }] },
  30: { title: 'elite', badge: 'level_30', items: [{ item: 'star_shard', quantity: 2 }] },
  40: { title: 'champion', items: [{ item: 'celestial_egg', quantity: 1 }] },
  50: { title: 'lyss_legend', badge: 'level_50', items: [{ item: 'golden_crown', quantity: 1 }] },
});

/** Coins paid into the bank on reaching a level. */
export const levelCoins = (level) => 100 * level;

/** Everything granted on reaching `level`: { coins, items, title, badge }. */
export function levelRewards(level) {
  const milestone = LEVEL_MILESTONES[level] ?? {};
  return { coins: levelCoins(level), items: milestone.items ?? [], title: milestone.title ?? null, badge: milestone.badge ?? null };
}
