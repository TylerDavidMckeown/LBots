import crypto from 'node:crypto';
import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { NO_ACTIVITY } from './activity.js';
import {
  applyAction, calculateReward, calculateXp, DIFFICULTIES, finalScore, generateTask, jobItems, jobLevelForXp, JOBS,
  newUnlocks, RARE_CHANCE, RARE_LEVEL, unlockedDifficulties,
} from './jobTasks.js';

/**
 * /work sessions. Every step runs in one transaction:
 * - one active session per member (enforced by a unique index),
 * - a persistent cooldown that starts when a job starts, so quitting cannot reroll tasks,
 * - expired or finished sessions can never be answered again,
 * - rewards are settled exactly once, together with the status change.
 */
export function createJobService(db, economy, { inventory = null, activity = NO_ACTIVITY } = {}) {
  const q = {
    progress: db.prepare('SELECT * FROM job_progress WHERE guild_id = ? AND user_id = ? AND job = ?'),
    allProgress: db.prepare('SELECT * FROM job_progress WHERE guild_id = ? AND user_id = ? ORDER BY xp DESC'),
    upsertProgress: db.prepare(`
      INSERT INTO job_progress (guild_id, user_id, job, xp, completed, failed, total_earned, best_score, updated_at)
      VALUES (@guildId, @userId, @job, @xp, @completed, @failed, @earned, @best, @now)
      ON CONFLICT (guild_id, user_id, job) DO UPDATE SET xp = xp + excluded.xp, completed = completed + excluded.completed,
        failed = failed + excluded.failed, total_earned = total_earned + excluded.total_earned,
        best_score = MAX(best_score, excluded.best_score), updated_at = excluded.updated_at
    `),
    insert: db.prepare(`
      INSERT INTO job_sessions (id, guild_id, user_id, job, difficulty, rare, state, started_at, expires_at)
      VALUES (@id, @guildId, @userId, @job, @difficulty, @rare, @state, @now, @expiresAt)
    `),
    get: db.prepare('SELECT * FROM job_sessions WHERE id = ?'),
    active: db.prepare(`SELECT * FROM job_sessions WHERE guild_id = ? AND user_id = ? AND status = 'active'`),
    expireStale: db.prepare(`
      UPDATE job_sessions SET status = 'expired', finished_at = @now
      WHERE status = 'active' AND expires_at <= @now AND (@guildId IS NULL OR (guild_id = @guildId AND user_id = @userId))
    `),
    saveState: db.prepare('UPDATE job_sessions SET state = ?, mistakes = ? WHERE id = ?'),
    finish: db.prepare(`
      UPDATE job_sessions SET status = @status, finished_at = @now, score = @score, reward = @reward, xp = @xp
      WHERE id = @id AND status = 'active'
    `),
    prune: db.prepare(`DELETE FROM job_sessions WHERE status != 'active' AND finished_at < ?`),
    leaderboard: db.prepare(`
      SELECT user_id, SUM(xp) AS xp, SUM(completed) AS completed, SUM(total_earned) AS earned
      FROM job_progress WHERE guild_id = ? GROUP BY user_id HAVING SUM(xp) > 0 ORDER BY xp DESC, user_id LIMIT ? OFFSET ?
    `),
    leaderboardCount: db.prepare('SELECT COUNT(*) AS n FROM (SELECT user_id FROM job_progress WHERE guild_id = ? GROUP BY user_id HAVING SUM(xp) > 0)'),
  };

  const parse = (row) => (row ? { ...row, rare: Boolean(row.rare), state: JSON.parse(row.state) } : row);
  const emptyProgress = (job) => ({ job, xp: 0, completed: 0, failed: 0, total_earned: 0, best_score: 0 });
  const progressOf = (guildId, userId, job) => q.progress.get(guildId, userId, job) ?? emptyProgress(job);
  const tx = (fn) => db.transaction(fn).immediate();

  function finish(session, status, now, { score = 0, reward = 0, xp = 0 } = {}) {
    if (!q.finish.run({ id: session.id, status, now, score: Math.round(score * 100), reward, xp }).changes) {
      throw new UserError('This job is already finished.', { title: 'Job finished' });
    }
  }

  /** Settles a finished task: status, progression and payout in the same transaction. */
  function settle(session, step, now, settings) {
    const progress = progressOf(session.guild_id, session.user_id, session.job);
    const levelBefore = jobLevelForXp(progress.xp);
    const score = step.success ? finalScore({
      performance: step.performance, kind: JOBS[session.job].kind, startedAt: session.started_at, finishedAt: now, timeLimitMs: session.expires_at - session.started_at,
    }) : 0;
    const reward = step.success ? calculateReward({
      difficulty: session.difficulty, level: levelBefore, score, rare: session.rare, payoutPercent: settings.workPayoutPercent, job: session.job,
    }) : 0;
    const xp = calculateXp({ difficulty: session.difficulty, score, success: step.success });
    finish(session, step.success ? 'completed' : 'failed', now, { score, reward, xp });
    q.upsertProgress.run({
      guildId: session.guild_id, userId: session.user_id, job: session.job, xp,
      completed: step.success ? 1 : 0, failed: step.success ? 0 : 1, earned: reward, best: Math.round(score * 100), now,
    });
    const operationKey = `work:${session.id}`;
    const reference = `${session.job}:${session.difficulty}`;
    if (reward > 0) {
      economy.credit({ guildId: session.guild_id, userId: session.user_id, amount: reward, type: 'work_reward', xp, reference, operationKey, now, settings });
    }
    const items = step.success && inventory ? jobItems(session.job, session.difficulty, session.rare) : [];
    for (const { item, quantity } of items) {
      inventory.grant({ guildId: session.guild_id, userId: session.user_id, item, quantity, type: 'work_reward', reference, operationKey, now });
    }
    const progression = step.success
      ? activity.emit({ guildId: session.guild_id, userId: session.user_id, activity: 'job_completed', variant: session.difficulty, operationKey, now, settings }).progression ?? null
      : null;
    const levelAfter = jobLevelForXp(progress.xp + xp);
    return { success: step.success, score, reward, xp, items, levelBefore, levelAfter, unlocks: newUnlocks(levelBefore, levelAfter), progression };
  }

  return {
    get: (id) => parse(q.get.get(id)),
    progress: progressOf,
    allProgress: (guildId, userId) => q.allProgress.all(guildId, userId),
    levelOf: (guildId, userId, job) => jobLevelForXp(progressOf(guildId, userId, job).xp),
    /** The member's most practised job, or null. */
    topJob: (guildId, userId) => q.allProgress.get(guildId, userId)?.job ?? null,
    /** Adds job XP earned outside a shift (e.g. the daily spin). */
    grantXp(guildId, userId, job, xp, now = Date.now()) {
      q.upsertProgress.run({ guildId, userId, job, xp, completed: 0, failed: 0, earned: 0, best: 0, now });
    },

    start({ guildId, userId, job, difficulty, now = Date.now(), settings, rng = Math.random }) {
      if (!settings.workEnabled) throw new UserError('Work is disabled in this server.', { title: 'Disabled' });
      if (!JOBS[job] || !DIFFICULTIES[difficulty]) throw new UserError('That job does not exist.', { title: 'Unknown job' });
      return tx(() => {
        const level = jobLevelForXp(progressOf(guildId, userId, job).xp);
        if (!unlockedDifficulties(level).includes(difficulty)) {
          throw new UserError(`${DIFFICULTIES[difficulty].label} ${JOBS[job].name} jobs unlock at job level ${DIFFICULTIES[difficulty].unlockLevel}. You are level ${level}.`, { title: 'Not unlocked yet' });
        }
        if (economy.account(guildId, userId).frozen) throw new UserError('Your economy account is frozen. Please contact a server admin.', { title: 'Account frozen' });
        q.expireStale.run({ now, guildId, userId });
        if (q.active.get(guildId, userId)) throw new UserError('You are already on a job. Finish it or quit it first.', { title: 'Already working' });
        const readyAt = economy.cooldown(guildId, userId, 'work');
        if (readyAt > now) throw new UserError(`You are on a break. Your next shift starts ${discordTimestamp(readyAt, 'R')}.`, { title: 'On a break' });

        const rare = level >= RARE_LEVEL && rng() < RARE_CHANCE;
        const id = crypto.randomUUID();
        q.insert.run({
          id, guildId, userId, job, difficulty, rare: rare ? 1 : 0, now,
          state: JSON.stringify(generateTask(job, difficulty, { rng, now, rare })), expiresAt: now + DIFFICULTIES[difficulty].timeMs,
        });
        // The cooldown starts now, so quitting or failing cannot be used to reroll a task.
        economy.setCooldown(guildId, userId, 'work', now + settings.workCooldown);
        return parse(q.get.get(id));
      });
    },

    /** Applies one action. Only the owner can act, and only while the session is active and unexpired. */
    act({ sessionId, userId, choice, now = Date.now(), settings, rng = Math.random }) {
      return tx(() => {
        const session = parse(q.get.get(sessionId));
        if (!session) throw new UserError('This job no longer exists.', { title: 'This has expired' });
        if (session.user_id !== userId) throw new UserError('This is not your job. Start your own with `/work start`.', { title: 'Not your job' });
        if (session.status !== 'active') throw new UserError('This job is already finished.', { title: 'Job finished' });
        if (now > session.expires_at) {
          finish(session, 'expired', now);
          return { session: parse(q.get.get(sessionId)), expired: true };
        }
        const step = applyAction(session.state, choice, { now, rng, maxMistakes: DIFFICULTIES[session.difficulty].maxMistakes });
        q.saveState.run(JSON.stringify(step.state), step.state.mistakes ?? 0, sessionId);
        const settlement = step.done ? settle({ ...session, state: step.state }, step, now, settings) : null;
        return { session: parse(q.get.get(sessionId)), feedback: step.feedback, settlement };
      });
    },

    quit({ sessionId, userId, now = Date.now() }) {
      return tx(() => {
        const session = parse(q.get.get(sessionId));
        if (!session || session.user_id !== userId) throw new UserError('This is not your job.', { title: 'Not your job' });
        if (session.status !== 'active') throw new UserError('This job is already finished.', { title: 'Job finished' });
        finish(session, 'abandoned', now);
        return parse(q.get.get(sessionId));
      });
    },

    expireStale: (now = Date.now()) => q.expireStale.run({ now, guildId: null, userId: null }).changes,
    prune: (before) => q.prune.run(before).changes,
    leaderboard: (guildId, limit = 10, offset = 0) => q.leaderboard.all(guildId, limit, offset),
    leaderboardCount: (guildId) => q.leaderboardCount.get(guildId).n,
  };
}
