import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createScheduler } from '../src/scheduler.js';

function setup({ leaseMs } = {}) {
  const db = openDatabase(':memory:');
  let now = 1_700_000_000_000;
  const clock = { now: () => now, advance: (ms) => { now += ms; } };
  const reports = [];
  const errors = { report: async (error) => { reports.push(error); return 'LYS-TEST'; } };
  const scheduler = createScheduler({ db, errors, now: clock.now, leaseMs });
  const task = (id) => db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
  return { db, clock, scheduler, reports, task };
}

test('runs a due job exactly once and leaves future jobs pending', async () => {
  const { clock, scheduler, task } = setup();
  const calls = [];
  scheduler.register('giveaway:end', (payload) => calls.push(payload));
  const id = scheduler.schedule('giveaway:end', clock.now() + 1_000, { giveawayId: 7 });

  assert.equal(await scheduler.tick(), 0);
  clock.advance(1_000);
  assert.equal(await scheduler.tick(), 1);
  assert.equal(await scheduler.tick(), 0);
  assert.deepEqual(calls, [{ giveawayId: 7 }]);
  assert.equal(task(id).status, 'done');
});

test('a dedupe key prevents the same job being queued twice', () => {
  const { clock, scheduler } = setup();
  assert.ok(scheduler.schedule('birthday:announce', clock.now(), {}, { dedupeKey: 'birthday:2026-10-23' }));
  assert.equal(scheduler.schedule('birthday:announce', clock.now(), {}, { dedupeKey: 'birthday:2026-10-23' }), null);
  assert.equal(scheduler.pendingCount(), 1);
});

test('failed jobs back off, then fail permanently and are reported', async () => {
  const { clock, scheduler, reports, task } = setup();
  scheduler.register('flaky', () => { throw new Error('Discord unavailable'); });
  const id = scheduler.schedule('flaky', clock.now(), {}, { maxAttempts: 2 });

  await scheduler.tick();
  assert.equal(task(id).status, 'pending');
  assert.equal(task(id).attempts, 1);
  assert.equal(task(id).run_at, clock.now() + 30_000);
  assert.equal(await scheduler.tick(), 0, 'not retried before the backoff');

  clock.advance(30_000);
  await scheduler.tick();
  assert.equal(task(id).status, 'failed');
  assert.equal(task(id).last_error, 'Discord unavailable');
  assert.equal(reports.length, 1);
});

test('jobs left running by a crash are recovered after the lease expires', () => {
  const { db, clock, scheduler, task } = setup({ leaseMs: 60_000 });
  const id = scheduler.schedule('expedition:complete', clock.now());
  db.prepare(`UPDATE scheduled_tasks SET status = 'running', locked_at = ? WHERE id = ?`).run(clock.now(), id);

  assert.equal(scheduler.recover(), 0, 'still within the lease');
  clock.advance(60_001);
  assert.equal(scheduler.recover(), 1);
  assert.equal(task(id).status, 'pending');
});

test('a claimed job cannot be claimed again by an overlapping tick', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  let release;
  scheduler.register('slow', () => new Promise((resolve) => { runs += 1; release = resolve; }));
  scheduler.schedule('slow', clock.now());

  const first = scheduler.tick();
  assert.equal(await scheduler.tick(), 0, 'overlapping tick is skipped');
  release();
  await first;
  assert.equal(runs, 1);
});

test('recurring jobs keep exactly one future occurrence queued', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.every('shop:rotate', 60_000, () => { runs += 1; });

  scheduler.recover();
  scheduler.recover();
  assert.equal(scheduler.pendingCount(), 1, 'restarts do not duplicate occurrences');

  clock.advance(60_000);
  assert.equal(await scheduler.tick(), 1);
  assert.equal(runs, 1);
  assert.equal(scheduler.pendingCount(), 1, 'next occurrence queued');
});

test('recurring jobs still reschedule when the handler throws', async () => {
  const { clock, scheduler } = setup();
  scheduler.every('cleanup', 60_000, () => { throw new Error('fail'); });
  scheduler.recover();
  clock.advance(60_000);
  await scheduler.tick();
  assert.equal(scheduler.pendingCount(), 2, 'the retry plus the next occurrence');
});

test('cancel stops a pending job by id or dedupe key', async () => {
  const { clock, scheduler } = setup();
  let runs = 0;
  scheduler.register('poll:end', () => { runs += 1; });
  const id = scheduler.schedule('poll:end', clock.now());
  scheduler.schedule('poll:end', clock.now(), {}, { dedupeKey: 'poll:9' });

  assert.equal(scheduler.cancel(id), true);
  assert.equal(scheduler.cancel('poll:9'), true);
  assert.equal(scheduler.cancel('poll:9'), false);
  await scheduler.tick();
  assert.equal(runs, 0);
});

test('invalid run times are rejected', () => {
  const { scheduler } = setup();
  assert.throws(() => scheduler.schedule('x', Number.NaN), /Invalid run time/);
});
