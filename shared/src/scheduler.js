/**
 * Database-backed job scheduler.
 *
 * Guarantees:
 * - Jobs are stored in `scheduled_tasks` and survive restarts.
 * - A job is claimed with a conditional UPDATE, so it is never run by two ticks at once.
 * - Jobs left `running` by a crash are returned to `pending` on start.
 *
 * Because a crash can happen after a handler's side effects but before the job is
 * marked done, handlers may run more than once. Any handler that grants rewards must
 * wrap its database changes in `runOnce` (see db.js) keyed by `task.id` or a domain key.
 */
export function createScheduler({ db, logger, errors, pollIntervalMs = 5_000, leaseMs = 5 * 60_000, now = Date.now }) {
  const handlers = new Map();
  const recurring = new Map();
  let timer = null;
  let ticking = false;

  const stmts = {
    insert: db.prepare(`
      INSERT INTO scheduled_tasks (type, run_at, payload, dedupe_key, max_attempts, created_at)
      VALUES (@type, @runAt, @payload, @dedupeKey, @maxAttempts, @createdAt)
      ON CONFLICT (dedupe_key) DO NOTHING
    `),
    due: db.prepare(`SELECT * FROM scheduled_tasks WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT ?`),
    claim: db.prepare(`UPDATE scheduled_tasks SET status = 'running', locked_at = ?, attempts = attempts + 1 WHERE id = ? AND status = 'pending'`),
    done: db.prepare(`UPDATE scheduled_tasks SET status = 'done', completed_at = ?, locked_at = NULL, last_error = NULL WHERE id = ?`),
    retry: db.prepare(`UPDATE scheduled_tasks SET status = 'pending', run_at = ?, locked_at = NULL, last_error = ? WHERE id = ?`),
    fail: db.prepare(`UPDATE scheduled_tasks SET status = 'failed', completed_at = ?, locked_at = NULL, last_error = ? WHERE id = ?`),
    cancel: db.prepare(`UPDATE scheduled_tasks SET status = 'cancelled', completed_at = ? WHERE status = 'pending' AND (id = ? OR dedupe_key = ?)`),
    recover: db.prepare(`UPDATE scheduled_tasks SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < ?`),
    pendingCount: db.prepare(`SELECT COUNT(*) AS n FROM scheduled_tasks WHERE status = 'pending'`),
    hasPending: db.prepare(`SELECT 1 FROM scheduled_tasks WHERE type = ? AND status IN ('pending', 'running') LIMIT 1`),
  };

  function register(type, handler) {
    if (handlers.has(type)) throw new Error(`Duplicate scheduler handler: ${type}`);
    handlers.set(type, handler);
  }

  /**
   * Queues a job. Returns the new task id, or null if a job with the same dedupeKey exists.
   */
  function schedule(type, runAt, payload = {}, { dedupeKey = null, maxAttempts = 5 } = {}) {
    const at = runAt instanceof Date ? runAt.getTime() : runAt;
    if (!Number.isFinite(at)) throw new Error(`Invalid run time for job ${type}`);
    const info = stmts.insert.run({
      type, runAt: at, payload: JSON.stringify(payload), dedupeKey, maxAttempts, createdAt: now(),
    });
    return info.changes ? Number(info.lastInsertRowid) : null;
  }

  function cancel(idOrDedupeKey) {
    const id = typeof idOrDedupeKey === 'number' ? idOrDedupeKey : -1;
    const key = typeof idOrDedupeKey === 'string' ? idOrDedupeKey : null;
    return stmts.cancel.run(now(), id, key).changes > 0;
  }

  /**
   * Registers a job that repeats every `intervalMs`. Each occurrence has a slot-based
   * dedupe key, so restarts never create duplicate occurrences.
   */
  function every(type, intervalMs, handler) {
    recurring.set(type, intervalMs);
    register(type, async (payload, task) => {
      try {
        await handler(payload, task);
      } finally {
        queueNextOccurrence(type, intervalMs, task.run_at + intervalMs);
      }
    });
  }

  function queueNextOccurrence(type, intervalMs, from) {
    const runAt = Math.max(from, now());
    const slot = Math.ceil(runAt / intervalMs);
    schedule(type, slot * intervalMs, {}, { dedupeKey: `recurring:${type}:${slot}`, maxAttempts: 3 });
  }

  async function runTask(task) {
    const handler = handlers.get(task.type);
    if (!handler) {
      stmts.retry.run(now() + 60_000, `No handler registered for ${task.type}`, task.id);
      return;
    }
    if (stmts.claim.run(now(), task.id).changes !== 1) return;
    const attempts = task.attempts + 1;
    try {
      await handler(JSON.parse(task.payload), { ...task, attempts });
      stmts.done.run(now(), task.id);
    } catch (error) {
      const message = String(error?.message ?? error).slice(0, 500);
      if (attempts >= task.max_attempts) {
        stmts.fail.run(now(), message, task.id);
        const ref = await errors?.report(error, { source: `job:${task.type}` });
        logger?.error('Scheduled job failed permanently', { job: task.type, taskId: task.id, ref });
      } else {
        // Exponential backoff: 30s, 60s, 120s ... capped at one hour.
        const delay = Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);
        stmts.retry.run(now() + delay, message, task.id);
        logger?.warn('Scheduled job failed, will retry', { job: task.type, taskId: task.id, attempts, error: message });
      }
    }
  }

  async function tick(batchSize = 25) {
    if (ticking) return 0;
    ticking = true;
    try {
      const tasks = stmts.due.all(now(), batchSize);
      for (const task of tasks) await runTask(task);
      return tasks.length;
    } finally {
      ticking = false;
    }
  }

  function recover() {
    const recovered = stmts.recover.run(now() - leaseMs).changes;
    if (recovered) logger?.warn('Recovered interrupted scheduled jobs', { count: recovered });
    for (const [type, intervalMs] of recurring) {
      if (!stmts.hasPending.get(type)) queueNextOccurrence(type, intervalMs, now());
    }
    return recovered;
  }

  function start() {
    if (timer) return;
    // On a fresh process nothing can legitimately be running, so recover everything.
    stmts.recover.run(Number.MAX_SAFE_INTEGER);
    recover();
    timer = setInterval(() => {
      tick().catch((error) => errors?.report(error, { source: 'scheduler:tick' }));
    }, pollIntervalMs);
    timer.unref?.();
    tick().catch((error) => errors?.report(error, { source: 'scheduler:tick' }));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return {
    register,
    schedule,
    cancel,
    every,
    tick,
    recover,
    start,
    stop,
    pendingCount: () => stmts.pendingCount.get().n,
  };
}
