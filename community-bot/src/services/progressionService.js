import { baseXpFor, levelRewards, memberLevelForXp, XP_SOURCES } from './progressionRules.js';

const DAY = 86_400_000;

/**
 * Member levels: the central XP service. Every award is keyed by the activity's
 * operation key (UNIQUE in xp_transactions), so retries, double clicks and scheduler
 * re-runs can never award the same activity twice. Level rewards are recorded in
 * level_rewards and granted once per level, in the same transaction as the XP.
 */
export function createProgressionService(db, { economy, inventory }) {
  const q = {
    get: db.prepare('SELECT * FROM member_progression WHERE guild_id = ? AND user_id = ?'),
    ensure: db.prepare('INSERT INTO member_progression (guild_id, user_id, updated_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
    update: db.prepare('UPDATE member_progression SET xp = xp + @amount, level = @level, updated_at = @now WHERE guild_id = @guildId AND user_id = @userId'),
    insertXp: db.prepare(`
      INSERT INTO xp_transactions (guild_id, user_id, source, amount, operation_key, created_at) VALUES (@guildId, @userId, @source, @amount, @operationKey, @now)
      ON CONFLICT (guild_id, user_id, operation_key) DO NOTHING
    `),
    countSince: db.prepare('SELECT COUNT(*) AS n FROM xp_transactions WHERE guild_id = ? AND user_id = ? AND source = ? AND created_at > ?'),
    insertReward: db.prepare('INSERT INTO level_rewards (guild_id, user_id, level, rewards, granted_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'),
    rewards: db.prepare('SELECT * FROM level_rewards WHERE guild_id = ? AND user_id = ? ORDER BY level DESC LIMIT ?'),
    unlock: db.prepare('INSERT INTO member_unlocks (guild_id, user_id, kind, unlock_key, source, unlocked_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'),
    unlocks: db.prepare('SELECT * FROM member_unlocks WHERE guild_id = ? AND user_id = ? ORDER BY unlocked_at'),
    history: db.prepare('SELECT * FROM xp_transactions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
    historyCount: db.prepare('SELECT COUNT(*) AS n FROM xp_transactions WHERE guild_id = ? AND user_id = ?'),
    bySource: db.prepare('SELECT source, SUM(amount) AS xp, COUNT(*) AS n FROM xp_transactions WHERE guild_id = ? AND user_id = ? GROUP BY source ORDER BY xp DESC'),
    leaderboard: db.prepare('SELECT * FROM member_progression WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id LIMIT ? OFFSET ?'),
    leaderboardCount: db.prepare('SELECT COUNT(*) AS n FROM member_progression WHERE guild_id = ? AND xp > 0'),
    rank: db.prepare('SELECT COUNT(*) + 1 AS n FROM member_progression WHERE guild_id = ? AND xp > ?'),
  };

  const tx = (fn) => db.transaction(fn).immediate();
  const empty = (guildId, userId) => ({ guild_id: guildId, user_id: userId, xp: 0, level: 1 });

  /** Grants the rewards for one level, unless that level was already rewarded. */
  function grantLevel(guildId, userId, level, now, settings) {
    const rewards = levelRewards(level);
    if (!q.insertReward.run(guildId, userId, level, JSON.stringify(rewards), now).changes) return null;
    const operationKey = `level:${level}`;
    // Paid into the bank so a wallet limit can never block (and roll back) the activity that levelled up.
    if (rewards.coins > 0) economy.payReward({ guildId, userId, amount: rewards.coins, type: 'level_reward', reference: String(level), operationKey, now, settings });
    for (const { item, quantity } of rewards.items) inventory.grant({ guildId, userId, item, quantity, type: 'level_reward', reference: String(level), operationKey, now });
    if (rewards.title) q.unlock.run(guildId, userId, 'title', rewards.title, `level:${level}`, now);
    if (rewards.badge) q.unlock.run(guildId, userId, 'badge', rewards.badge, `level:${level}`, now);
    return { level, ...rewards };
  }

  function award({ guildId, userId, source, variant = null, operationKey, now = Date.now(), settings }) {
    if (!XP_SOURCES[source]) throw new Error(`Unknown XP source ${source}`);
    if (!operationKey) throw new Error('XP awards need an operation key');
    const amount = Math.round((baseXpFor(source, variant) * settings.progressionXpPercent) / 100);
    if (amount <= 0) return null;
    return tx(() => {
      const { dailyCap } = XP_SOURCES[source];
      if (dailyCap && q.countSince.get(guildId, userId, source, now - DAY).n >= dailyCap) return null;
      if (!q.insertXp.run({ guildId, userId, source, amount, operationKey, now }).changes) return null;
      q.ensure.run(guildId, userId, now);
      const before = q.get.get(guildId, userId);
      const levelAfter = Math.max(memberLevelForXp(before.xp + amount), before.level);
      q.update.run({ guildId, userId, amount, level: levelAfter, now });
      const rewards = [];
      for (let level = before.level + 1; level <= levelAfter; level += 1) {
        const granted = grantLevel(guildId, userId, level, now, settings);
        if (granted) rewards.push(granted);
      }
      return { source, xp: amount, levelBefore: before.level, levelAfter, rewards };
    });
  }

  return {
    profile: (guildId, userId) => q.get.get(guildId, userId) ?? empty(guildId, userId),
    rank(guildId, userId) {
      const row = q.get.get(guildId, userId);
      return row?.xp > 0 ? q.rank.get(guildId, row.xp).n : null;
    },

    /**
     * Awards member XP for one activity. Returns null when nothing was awarded (an
     * ineligible source, a repeated operation key, or the source's daily cap).
     */
    award,

    /** Listener for the activity hub (see activity.js): activity names are XP sources. */
    onActivity: (event) => (XP_SOURCES[event.activity] ? award({ ...event, source: event.activity }) : null),

    /** Unlocks a title or badge (e.g. from a collection milestone). Unlocking twice changes nothing. */
    unlock: (guildId, userId, kind, key, source, now = Date.now()) => q.unlock.run(guildId, userId, kind, key, source, now).changes > 0,

    rewardsGranted: (guildId, userId, limit = 5) => q.rewards.all(guildId, userId, limit).map((row) => ({ ...row, rewards: JSON.parse(row.rewards) })),
    unlocks: (guildId, userId) => q.unlocks.all(guildId, userId),
    history: (guildId, userId, limit = 10, offset = 0) => q.history.all(guildId, userId, limit, offset),
    historyCount: (guildId, userId) => q.historyCount.get(guildId, userId).n,
    bySource: (guildId, userId) => q.bySource.all(guildId, userId),
    leaderboard: (guildId, limit = 10, offset = 0) => q.leaderboard.all(guildId, limit, offset),
    leaderboardCount: (guildId) => q.leaderboardCount.get(guildId).n,
  };
}
