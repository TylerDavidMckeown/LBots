import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '@lyss/shared/errorReporter.js';
import { createEconomyService } from '../src/services/economyService.js';
import { createJobService } from '../src/services/jobService.js';
import {
  applyAction, calculateReward, calculateXp, deliveryRound, DIFFICULTIES, detectiveRound, finalScore, generateTask,
  jobLevelForXp, JOBS, matchesClue, newUnlocks, ORE_BY_KEY, unlockedDifficulties, xpForJobLevel,
} from '../src/services/jobTasks.js';
import { taskPayload } from '../src/features/work.js';
import { communityDb, economyDefaults, fakeCtx, seeded } from './helpers.js';

const G = 'guild';
const T0 = Date.UTC(2026, 9, 23, 12);
const s = economyDefaults();
const BREAK = s.workCooldown;

/** The choice a perfect player would make, read from the hidden state. */
function solve(state) {
  switch (state.kind) {
    case 'sequence':
      return String(state.options.indexOf(state.target[state.progress]));
    case 'grid':
      if (state.mode === 'treasure') return String(state.treasure);
      return String(state.cells.map((key, i) => ({ i, value: ORE_BY_KEY[key].value }))
        .filter(({ i }) => !state.revealed.includes(i)).sort((a, b) => b.value - a.value)[0].i);
    case 'timing':
      return 'reel';
    default:
      return String(state.rounds[state.round].answer);
  }
}

const momentFor = (state) => (state.kind === 'timing' ? state.biteAt + 200 : T0 + 5_000);

function play(job, difficulty, seed) {
  const rng = seeded(seed);
  let state = generateTask(job, difficulty, { rng, now: T0 });
  for (let i = 0; i < 40; i += 1) {
    const step = applyAction(state, solve(state), { now: momentFor(state), rng, maxMistakes: DIFFICULTIES[difficulty].maxMistakes });
    state = step.state;
    if (step.done) return step;
  }
  throw new Error(`${job}/${difficulty} did not finish`);
}

function setup(settings = s) {
  const db = communityDb();
  const economy = createEconomyService(db);
  const jobs = createJobService(db, economy);
  const start = (overrides = {}) => jobs.start({ guildId: G, userId: 'u', job: 'hacker', difficulty: 'easy', now: T0, settings, rng: seeded(7), ...overrides });
  const act = (session, choice, overrides = {}) => jobs.act({ sessionId: session.id, userId: 'u', choice, now: T0 + 5_000, settings, rng: seeded(9), ...overrides });
  /** Answers until the job settles. */
  const finish = (session, now = T0 + 5_000) => {
    let result;
    let current = session;
    do {
      result = act(current, solve(current.state), { now: current.state.kind === 'timing' ? current.state.biteAt + 200 : now });
      current = result.session;
    } while (!result.settlement && !result.expired);
    return result;
  };
  return { db, economy, jobs, start, act, finish };
}

const isUserError = (pattern) => (error) => error instanceof UserError && pattern.test(error.message);

test('every job can be completed at every difficulty by a perfect player', () => {
  for (const job of Object.keys(JOBS)) {
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const step = play(job, difficulty, seed);
        assert.equal(step.success, true, `${job}/${difficulty} seed ${seed}: ${step.feedback}`);
        assert.ok(step.performance > 0 && step.performance <= 1);
      }
    }
  }
});

test('applying an action never mutates the stored state', () => {
  const state = generateTask('chef', 'easy', { rng: seeded(3), now: T0 });
  const before = JSON.stringify(state);
  applyAction(state, solve(state), { now: T0 });
  assert.equal(JSON.stringify(state), before);
});

test('invalid choices are rejected without using up attempts', () => {
  const quiz = generateTask('hacker', 'easy', { rng: seeded(1), now: T0 });
  const step = applyAction(quiz, '99', { now: T0 });
  assert.equal(step.done, false);
  assert.equal(step.state.round, 0);
  const mine = generateTask('miner', 'easy', { rng: seeded(1), now: T0 });
  const first = applyAction(mine, '0', { now: T0 });
  const again = applyAction(first.state, '0', { now: T0 });
  assert.equal(again.state.picksLeft, first.state.picksLeft, 'mining the same block twice is free and rejected');
  assert.equal(applyAction(mine, 'reel', { now: T0 }).state.picksLeft, mine.picksLeft);
});

test('sequence jobs fail after too many mistakes', () => {
  let state = generateTask('barista', 'hard', { rng: seeded(5), now: T0 });
  const wrong = String(state.options.findIndex((option) => option !== state.target[0]));
  let step;
  for (let i = 0; i <= DIFFICULTIES.hard.maxMistakes; i += 1) {
    step = applyAction(state, wrong, { now: T0, maxMistakes: DIFFICULTIES.hard.maxMistakes });
    state = step.state;
  }
  assert.equal(step.done, true);
  assert.equal(step.success, false);
});

test('fishing measures reaction time with server timestamps', () => {
  const state = generateTask('fisher', 'medium', { rng: seeded(2), now: T0 });
  const early = applyAction(state, 'reel', { now: state.biteAt - 1, rng: seeded(4), maxMistakes: 3 });
  assert.equal(early.done, false);
  assert.equal(early.state.mistakes, 1);
  assert.ok(early.state.biteAt > state.biteAt - 1, 'a new bite is scheduled after an early reel');
  const late = applyAction(state, 'reel', { now: state.biteAt + state.window + 1 });
  assert.equal(late.success, false);
  const fast = applyAction(state, 'reel', { now: state.biteAt + 100 });
  const slow = applyAction(state, 'reel', { now: state.biteAt + 2_500 });
  assert.ok(fast.performance > slow.performance);
  assert.ok(fast.state.catch);
});

test('detective cases always have exactly one suspect matching every clue', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const round = detectiveRound(seeded(seed), 3 + (seed % 3));
    const matching = round.suspects.filter((suspect) => round.clues.every((clue) => matchesClue(suspect, clue)));
    assert.equal(matching.length, 1, `seed ${seed}`);
    assert.equal(round.options[round.answer], matching[0].name);
    assert.ok(round.clues.length >= 2);
  }
});

test('delivery routes: the answer is the real shortest route and options are distinct', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const round = deliveryRound(seeded(seed));
    assert.equal(new Set(round.options).size, round.options.length, `seed ${seed}`);
    assert.equal(round.options.length, 4);
    const rows = round.prompt.split('\n').slice(1);
    const find = (emoji) => {
      const row = rows.findIndex((line) => line.includes(emoji));
      return [row, [...rows[row].matchAll(/🚚|🏠|⬜/gu)].findIndex((m) => m[0] === emoji)];
    };
    const [[sr, sc], [dr, dc]] = [find('🚚'), find('🏠')];
    const expected = [dr !== sr && `${dr < sr ? '⬆️' : '⬇️'} ${Math.abs(dr - sr)}`, dc !== sc && `${dc > sc ? '➡️' : '⬅️'} ${Math.abs(dc - sc)}`].filter(Boolean).join(' · ');
    assert.equal(round.options[round.answer], expected);
  }
});

test('every task screen fits Discord component limits', () => {
  const ctx = fakeCtx();
  for (const job of Object.keys(JOBS)) {
    for (const difficulty of Object.keys(DIFFICULTIES)) {
      for (const rare of [false, true]) {
        const state = generateTask(job, difficulty, { rng: seeded(11), now: T0, rare });
        const session = { id: '0b9f3e64-5d2a-4f0c-9d43-2c1f8e7a6b5c', guild_id: G, user_id: 'u', job, difficulty, rare, state, expires_at: T0 + 60_000 };
        const payload = taskPayload(ctx, session);
        const rows = payload.components.map((row) => row.toJSON());
        assert.ok(rows.length <= 5, `${job}/${difficulty} rows`);
        const ids = rows.flatMap((row) => {
          assert.ok(row.components.length <= 5);
          return row.components.map((c) => c.custom_id);
        });
        assert.equal(new Set(ids).size, ids.length, `${job}/${difficulty} unique ids`);
        assert.ok(ids.every((id) => id.length <= 100));
        assert.ok(payload.embeds[0].toJSON().description.length <= 4096);
      }
    }
  }
});

test('central reward rules', () => {
  assert.equal(calculateReward({ difficulty: 'easy', level: 1, score: 0 }), 0);
  assert.equal(calculateReward({ difficulty: 'easy', level: 1, score: 1 }), Math.round(300 * 1.01));
  assert.equal(calculateReward({ difficulty: 'hard', level: 1, score: 1 }), Math.round(600 * 1.01));
  const low = calculateReward({ difficulty: 'easy', level: 1, score: 0.01 });
  assert.ok(low >= 100 && low < 110);
  // Level 5 widens the range, level bonus is capped at 50.
  assert.ok(calculateReward({ difficulty: 'easy', level: 5, score: 1 }) > calculateReward({ difficulty: 'easy', level: 4, score: 1 }));
  assert.equal(calculateReward({ difficulty: 'easy', level: 50, score: 1 }), calculateReward({ difficulty: 'easy', level: 80, score: 1 }));
  assert.equal(calculateReward({ difficulty: 'easy', level: 1, score: 1, rare: true }), Math.round(300 * 1.01 * 1.5));
  assert.equal(calculateReward({ difficulty: 'easy', level: 1, score: 1, payoutPercent: 50 }), Math.round(300 * 1.01 * 0.5));
  assert.equal(calculateXp({ difficulty: 'medium', score: 1, success: true }), 35);
  assert.equal(calculateXp({ difficulty: 'medium', score: 0, success: false }), 9);
  // Speed matters for puzzles, not for luck or reaction jobs.
  const quick = finalScore({ performance: 1, kind: 'quiz', startedAt: 0, finishedAt: 0, timeLimitMs: 90_000 });
  const slow = finalScore({ performance: 1, kind: 'quiz', startedAt: 0, finishedAt: 90_000, timeLimitMs: 90_000 });
  assert.equal(quick, 1);
  assert.equal(slow, 0.85);
  assert.equal(finalScore({ performance: 0.6, kind: 'grid', startedAt: 0, finishedAt: 90_000, timeLimitMs: 90_000 }), 0.6);
});

test('job levels and unlocks', () => {
  assert.equal(jobLevelForXp(0), 1);
  for (const level of [2, 5, 10, 20, 30, 50]) {
    assert.equal(jobLevelForXp(xpForJobLevel(level)), level);
    assert.equal(jobLevelForXp(xpForJobLevel(level) - 1), level - 1);
  }
  assert.deepEqual(unlockedDifficulties(1), ['easy']);
  assert.deepEqual(unlockedDifficulties(10), ['easy', 'medium']);
  assert.deepEqual(unlockedDifficulties(30), ['easy', 'medium', 'hard']);
  assert.deepEqual(newUnlocks(4, 10).map((u) => u.level), [5, 10]);
});

test('a completed job pays exactly once and records progress', () => {
  const { db, economy, jobs, start, act, finish } = setup();
  const session = start();
  assert.equal(economy.cooldown(G, 'u', 'work'), T0 + BREAK);
  const result = finish(session);
  assert.equal(result.settlement.success, true);
  assert.ok(result.settlement.reward >= 100);
  assert.equal(result.session.status, 'completed');
  assert.equal(economy.account(G, 'u').wallet, result.settlement.reward);

  // A second click on the finished job is refused and pays nothing.
  assert.throws(() => act(result.session, '0'), isUserError(/already finished/));
  assert.equal(economy.account(G, 'u').wallet, result.settlement.reward);
  const rows = db.prepare(`SELECT * FROM economy_transactions WHERE type = 'work_reward'`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation_key, `work:${session.id}`);

  const progress = jobs.progress(G, 'u', 'hacker');
  assert.equal(progress.completed, 1);
  assert.equal(progress.xp, result.settlement.xp);
  assert.equal(progress.total_earned, result.settlement.reward);
  assert.deepEqual(jobs.leaderboard(G).map((r) => r.user_id), ['u']);
});

test('one job at a time, and a break after starting one', () => {
  const { start, finish } = setup();
  const session = start();
  assert.throws(() => start({ now: T0 + 1_000 }), isUserError(/already on a job/));
  finish(session);
  assert.throws(() => start({ now: T0 + 60_000 }), isUserError(/on a break/));
  assert.doesNotThrow(() => start({ now: T0 + BREAK }));
});

test('expired jobs cannot be completed and pay nothing', () => {
  const { economy, start, act } = setup();
  const session = start();
  const late = act(session, solve(session.state), { now: session.expires_at + 1 });
  assert.equal(late.expired, true);
  assert.equal(late.session.status, 'expired');
  assert.equal(economy.account(G, 'u').wallet, 0);
  assert.throws(() => act(session, '0', { now: session.expires_at + 2 }), isUserError(/already finished/));
});

test('an abandoned job left open is expired before the next one starts', () => {
  const { jobs, start } = setup();
  const first = start();
  const second = start({ now: T0 + BREAK });
  assert.equal(jobs.get(first.id).status, 'expired');
  assert.equal(second.status, 'active');
});

test('only the owner can play or quit a job', () => {
  const { jobs, start, act } = setup();
  const session = start();
  assert.throws(() => act(session, '0', { userId: 'intruder' }), isUserError(/not your job/));
  assert.throws(() => jobs.quit({ sessionId: session.id, userId: 'intruder', now: T0 }), isUserError(/not your job/));
  assert.equal(jobs.get(session.id).state.round, 0);
});

test('quitting pays nothing and keeps the break', () => {
  const { economy, jobs, start } = setup();
  const session = start();
  assert.equal(jobs.quit({ sessionId: session.id, userId: 'u', now: T0 + 1_000 }).status, 'abandoned');
  assert.equal(economy.account(G, 'u').wallet, 0);
  assert.throws(() => start({ now: T0 + 2_000 }), isUserError(/on a break/));
  assert.throws(() => jobs.quit({ sessionId: session.id, userId: 'u', now: T0 + 3_000 }), isUserError(/already finished/));
});

test('failed jobs pay nothing but still give a little XP', () => {
  const { economy, jobs, start, act } = setup();
  let result = { session: start({ job: 'chef' }) };
  const wrong = String(result.session.state.options.findIndex((o) => o !== result.session.state.target[0]));
  while (!result.settlement) result = act(result.session, wrong);
  assert.equal(result.settlement.success, false);
  assert.equal(result.session.status, 'failed');
  assert.equal(economy.account(G, 'u').wallet, 0);
  assert.equal(jobs.progress(G, 'u', 'chef').failed, 1);
  assert.equal(jobs.progress(G, 'u', 'chef').xp, result.settlement.xp);
  assert.ok(result.settlement.xp > 0);
});

test('difficulties stay locked until the job level is reached', () => {
  const { db, start } = setup();
  assert.throws(() => start({ difficulty: 'hard' }), isUserError(/unlock at job level 30/));
  db.prepare('INSERT INTO job_progress (guild_id, user_id, job, xp, updated_at) VALUES (?, ?, ?, ?, ?)').run(G, 'u', 'hacker', xpForJobLevel(30), T0);
  assert.equal(start({ difficulty: 'hard' }).difficulty, 'hard');
});

test('rare variants appear only from job level 20', () => {
  const firstZero = () => {
    const inner = seeded(1);
    let first = true;
    return () => (first ? ((first = false), 0) : inner());
  };
  const low = setup();
  assert.equal(low.start({ rng: firstZero() }).rare, false);
  const high = setup();
  high.db.prepare('INSERT INTO job_progress (guild_id, user_id, job, xp, updated_at) VALUES (?, ?, ?, ?, ?)').run(G, 'u', 'hacker', xpForJobLevel(20), T0);
  const session = high.start({ rng: firstZero() });
  assert.equal(session.rare, true);
  const result = high.finish(session);
  const plain = calculateReward({ difficulty: 'easy', level: 20, score: result.settlement.score });
  assert.equal(result.settlement.reward, calculateReward({ difficulty: 'easy', level: 20, score: result.settlement.score, rare: true }));
  assert.ok(result.settlement.reward > plain);
});

test('level-ups report the newly unlocked perks', () => {
  const { db, start, finish } = setup();
  db.prepare('INSERT INTO job_progress (guild_id, user_id, job, xp, updated_at) VALUES (?, ?, ?, ?, ?)').run(G, 'u', 'hacker', xpForJobLevel(5) - 1, T0);
  const result = finish(start());
  assert.equal(result.settlement.levelBefore, 4);
  assert.equal(result.settlement.levelAfter, 5);
  assert.deepEqual(result.settlement.unlocks.map((u) => u.level), [5]);
});

test('fishing through the service: early reels are penalised, a timely reel pays', () => {
  const { economy, start, act } = setup();
  const session = start({ job: 'fisher' });
  const early = act(session, 'reel', { now: T0 + 100 });
  assert.match(early.feedback, /Too early/);
  assert.equal(early.session.mistakes, 1);
  const caught = act(session, 'reel', { now: early.session.state.biteAt + 300 });
  assert.equal(caught.settlement.success, true);
  assert.equal(economy.account(G, 'u').wallet, caught.settlement.reward);
});

test('work respects the disabled setting, frozen accounts and the payout multiplier', () => {
  assert.throws(() => setup(economyDefaults({ workEnabled: false })).start(), isUserError(/disabled/));

  const frozen = setup();
  frozen.economy.setFrozen({ guildId: G, actorId: 'admin', targetId: 'u', frozen: true, reason: 'test', now: T0, settings: s });
  assert.throws(() => frozen.start(), isUserError(/frozen/));

  const doubled = setup(economyDefaults({ workPayoutPercent: 200 }));
  const result = doubled.finish(doubled.start());
  assert.equal(result.settlement.reward, calculateReward({ difficulty: 'easy', level: 1, score: result.settlement.score, payoutPercent: 200 }));
});

test('cleanup expires stale sessions and prunes old ones', () => {
  const { jobs, start } = setup();
  const session = start();
  assert.equal(jobs.expireStale(session.expires_at - 1), 0);
  assert.equal(jobs.expireStale(session.expires_at + 1), 1);
  assert.equal(jobs.prune(session.expires_at), 0);
  assert.equal(jobs.prune(session.expires_at + 2), 1);
  assert.equal(jobs.get(session.id), undefined);
});
