import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '@lyss/shared/errorReporter.js';
import { CHALLENGE_MS, GAMES, PENDING_MS } from '../src/services/games/catalogue.js';
import { QUESTIONS } from '../src/services/games/data/trivia.js';
import { createGameWorld, getServices } from '../src/services/index.js';
import { GAME_CATEGORIES, isDuelGame } from '../src/services/games/catalogue.js';
import { duelView, gameView } from '../src/features/gameViews.js';
import { dashboardView } from '../src/features/games.js';
import { communityDb, economyDefaults, fakeCtx, seeded } from './helpers.js';

const G = 'guild';
const T0 = Date.UTC(2026, 9, 23, 12);
const HOUR = 3_600_000;
const s = economyDefaults();

function setup(settings = s) {
  const db = communityDb();
  const { economy, jobs, games, pets, inventory, progression } = createGameWorld(db);
  const fund = (userId, amount) => economy.credit({ guildId: G, userId, amount, type: 'test', settings, now: T0 });
  const wallet = (userId) => economy.account(G, userId).wallet;
  const open = (game, stake, overrides = {}) => games.open({ guildId: G, userId: 'u', game, stake, now: T0, settings, ...overrides });
  const begin = (session, action, overrides = {}) => games.begin({ sessionId: session.id, userId: 'u', action, now: T0 + 1_000, settings, rng: seeded(1), ...overrides });
  const start = (game, overrides = {}) => games.start({ guildId: G, userId: 'u', game, now: T0, settings, rng: seeded(1), ...overrides });
  const act = (session, action, overrides = {}) => games.act({ sessionId: session.id, userId: 'u', action, now: T0 + 2_000, settings, rng: seeded(2), ...overrides });
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  return { db, economy, jobs, games, fund, wallet, open, begin, start, act, count };
}

const isUserError = (pattern) => (error) => error instanceof UserError && pattern.test(error.message);

test('a coinflip holds the stake, settles exactly once and records the result', () => {
  const { games, fund, wallet, open, begin, act, count } = setup();
  fund('u', 1_000);
  const card = open('coinflip', 500);
  assert.equal(card.status, 'pending');
  assert.equal(wallet('u'), 1_000, 'nothing is taken before confirmation');

  const { session, settlement } = begin(card, 'heads', { rng: () => 0.1 });
  assert.equal(session.status, 'settled');
  assert.equal(settlement.players[0].payout, 1_000);
  assert.equal(wallet('u'), 1_500);
  assert.throws(() => begin(card, 'heads'), isUserError(/already started/));
  assert.throws(() => act(card, 'heads'), isUserError(/already finished/));
  assert.equal(wallet('u'), 1_500);
  assert.equal(count(`SELECT COUNT(*) n FROM game_results WHERE session_id = ?`, card.id), 1);
  assert.equal(count(`SELECT COUNT(*) n FROM game_stakes WHERE session_id = ? AND status = 'settled'`, card.id), 1);
  assert.deepEqual(games.statFor(G, 'u', 'coinflip'), { ...games.statFor(G, 'u', 'coinflip'), played: 1, wins: 1, wagered: 500, returned: 1_000, streak: 1, best_streak: 1 });
});

test('stake validation: limits, funds, free and fixed-price games', () => {
  const { fund, open, start } = setup(economyDefaults({ gameMinBet: 50, gameMaxBet: 1_000 }));
  fund('u', 600);
  assert.throws(() => open('coinflip', 10), isUserError(/smallest stake/));
  assert.throws(() => open('coinflip', 5_000), isUserError(/largest stake/));
  assert.throws(() => open('coinflip', 800), isUserError(/only have/));
  assert.throws(() => open('coinflip', 0), isUserError(/needs a stake/));
  assert.throws(() => start('trivia', { stake: 100 }), isUserError(/free to play/));
  assert.throws(() => open('scratchcard', 100), isUserError(/costs/));
  assert.equal(open('scratchcard', GAMES.scratchcard.price).stake, 250);
  assert.throws(() => setup(economyDefaults({ gamesEnabled: false })).open('coinflip', 100), isUserError(/disabled/));
});

test('only the owner can confirm or play, and cards expire', () => {
  const { fund, open, begin, act } = setup();
  fund('u', 1_000);
  const card = open('slots', 100);
  assert.throws(() => begin(card, 'spin', { userId: 'intruder' }), isUserError(/not your game/i));
  assert.throws(() => begin(card, 'spin', { now: T0 + PENDING_MS + 1 }), isUserError(/expired/));
  const hl = begin(open('higherlower', 100), null).session;
  assert.throws(() => act(hl, 'higher', { userId: 'intruder' }), isUserError(/not your game/i));
});

test('one solo game at a time; overdue games are closed before the next starts', () => {
  const { games, fund, wallet, open, begin, start } = setup();
  fund('u', 1_000);
  const hl = begin(open('higherlower', 200), null).session;
  assert.equal(wallet('u'), 800);
  assert.throws(() => start('trivia', { now: T0 + 5_000 }), isUserError(/in progress/));
  // Once it has run out of time, starting something else expires it first (no rounds won: refund).
  const later = T0 + GAMES.higherlower.timeLimitMs + 5_000;
  assert.equal(start('trivia', { now: later }).session.status, 'active');
  assert.equal(games.get(hl.id).status, 'expired');
  assert.equal(wallet('u'), 1_000);
});

test('cooldowns are persistent and scale with the server setting', () => {
  const { fund, open, begin } = setup(economyDefaults({ gameCooldownPercent: 200 }));
  fund('u', 1_000);
  begin(open('coinflip', 100), 'heads');
  assert.throws(() => open('coinflip', 100, { now: T0 + 9_000 }), isUserError(/again/));
  assert.doesNotThrow(() => open('coinflip', 100, { now: T0 + 11_001 }));
});

test('blackjack double down holds the extra stake atomically', () => {
  // Seed chosen so the opening deal is not a natural.
  let found = null;
  for (let seed = 1; !found; seed += 1) {
    const { fund, open, begin } = setup();
    fund('u', 150);
    const result = begin(open('blackjack', 100), 'deal', { rng: seeded(seed) });
    if (!result.settlement) found = { seed, ...result };
  }
  const { fund, wallet, open, begin, act, count } = setup();
  fund('u', 150);
  const { session } = begin(open('blackjack', 100), 'deal', { rng: seeded(found.seed) });
  assert.equal(wallet('u'), 50);
  assert.throws(() => act(session, 'double'), isUserError(/only have/));
  assert.equal(wallet('u'), 50, 'a failed double changes nothing');
  assert.equal(count(`SELECT amount n FROM game_stakes WHERE session_id = ?`, session.id), 100);

  fund('u', 100);
  const doubled = act(session, 'double');
  assert.equal(doubled.session.status, 'settled');
  assert.equal(count(`SELECT amount n FROM game_stakes WHERE session_id = ?`, session.id), 200);
  assert.equal(wallet('u'), 50 + doubled.settlement.players[0].payout);
});

test('expiry rules: refunds, cash-outs and automatic stands', () => {
  const { games, fund, wallet, open, begin, act } = setup();
  fund('u', 1_000);
  const hl = begin(open('higherlower', 100), null).session;
  // Force one correct guess, then let the clock run out: the winnings are cashed out.
  const guessed = act({ id: hl.id }, hl.state.current > 1 ? 'lower' : 'higher', { rng: () => (hl.state.current > 1 ? 0 : 0.999) });
  assert.equal(guessed.session.state.streak, 1);
  const expired = games.expireDue(hl.expires_at + 1, () => s);
  assert.equal(expired.length, 1);
  assert.equal(games.get(hl.id).status, 'settled');
  assert.ok(games.get(hl.id).outcome.timedOut);
  assert.equal(wallet('u'), 900 + Math.floor(100 * guessed.session.state.multiplier));
  assert.deepEqual(games.expireDue(hl.expires_at + 2, () => s), [], 'nothing is expired twice');
  assert.throws(() => act({ id: hl.id }, 'cashout', { now: hl.expires_at + 3 }), isUserError(/already finished/));
});

test('acting after the time limit applies the expiry rule instead', () => {
  const { wallet, start, act } = setup();
  const { session } = start('trivia');
  const result = act(session, `pick:${session.state.answer}`, { now: session.expires_at + 1 });
  assert.equal(result.expired, true);
  assert.equal(result.settlement.players[0].result, 'loss');
  assert.equal(wallet('u'), 0);
});

test('free games: reward multiplier and the rolling 24-hour cap', () => {
  const { wallet, start, act, games } = setup(economyDefaults({ gameRewardPercent: 50, freeGameDailyCap: 80 }));
  const first = start('trivia', { options: { difficulty: 'medium' } }).session;
  const won = act(first, `pick:${first.state.answer}`);
  assert.equal(won.settlement.players[0].payout, 50, '100 LC at 50%');
  const second = start('trivia', { options: { difficulty: 'medium' }, now: T0 + 60_000 }).session;
  const capped = act(second, `pick:${second.state.answer}`, { now: T0 + 61_000 });
  assert.equal(capped.settlement.players[0].payout, 30);
  assert.equal(capped.settlement.players[0].capped, true);
  assert.equal(wallet('u'), 80);
  assert.equal(games.freeEarnedSince(G, 'u', T0 - 1), 80);
  assert.ok(won.settlement.players[0].xp > 0, 'XP is still awarded');
});

test('trivia does not repeat a question until every question has been seen', () => {
  const { start, act } = setup(economyDefaults({ gameCooldownPercent: 25 }));
  const pool = QUESTIONS.filter((x) => x.category === 'minecraft');
  const seen = new Set();
  let now = T0;
  for (let i = 0; i < pool.length; i += 1) {
    const { session } = start('trivia', { options: { category: 'minecraft' }, now, rng: seeded(i + 1) });
    seen.add(session.state.questionId);
    act(session, 'pick:0', { now: now + 1_000 });
    now += 10 * 60_000;
  }
  assert.equal(seen.size, pool.length);
});

test('quitting ends a game by its expiry rule', () => {
  const { wallet, start, games } = setup();
  const { session } = start('memory', { options: { difficulty: 'easy' } });
  const quit = games.quit({ guildId: G, userId: 'u', now: T0 + 5_000, settings: s });
  assert.equal(quit.session.status, 'settled');
  assert.equal(quit.settlement.players[0].result, 'loss');
  assert.equal(wallet('u'), 0);
  assert.throws(() => games.quit({ sessionId: session.id, guildId: G, userId: 'u', now: T0 + 6_000, settings: s }), isUserError(/finished|no game/));
});

test('the daily spin: once per server day, safe against timezone changes', () => {
  const { games, wallet } = setup();
  const spin = (now, zone = 'UTC', rng = seeded(3)) => games.dailySpin({ guildId: G, userId: 'u', now, zone, settings: s, rng });
  const first = spin(T0);
  assert.ok(first.segment);
  assert.throws(() => spin(T0 + HOUR), isUserError(/already spun/));
  assert.throws(() => spin(T0 + HOUR, 'Pacific/Kiritimati'), isUserError(/already spun/));
  assert.ok(spin(first.nextAt + 1));
  // A job XP segment goes to the member's most practised job.
  const jobSpin = setup();
  jobSpin.jobs.grantXp(G, 'u', 'miner', 100, T0);
  const result = jobSpin.games.dailySpin({ guildId: G, userId: 'u', now: T0, zone: 'UTC', settings: s, rng: () => 0.7 });
  assert.equal(result.segment.key, 'jobxp');
  assert.equal(result.job, 'miner');
  assert.equal(jobSpin.jobs.progress(G, 'u', 'miner').xp, 175);
  assert.equal(wallet('u'), first.coins + (games.history(G, 'u', 5)[0].payout), 'both spins paid their coins');
});

test('duels: stakes are held on both sides, the winner takes the pot, coins are conserved', () => {
  const { games, fund, wallet, count } = setup();
  fund('a', 1_000);
  fund('b', 1_000);
  const challenge = games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-dice', stake: 300, now: T0, settings: s });
  assert.equal(challenge.status, 'open');
  assert.equal(wallet('a'), 700);
  assert.throws(() => games.accept({ sessionId: challenge.id, userId: 'c', now: T0 + 1, settings: s }), isUserError(/not for you/));
  const { settlement } = games.accept({ sessionId: challenge.id, userId: 'b', now: T0 + 1_000, settings: s, rng: seeded(4) });
  const winner = settlement.players.find((p) => p.result === 'win');
  assert.equal(winner.payout, 600);
  assert.equal(wallet('a') + wallet('b'), 2_000);
  assert.equal(wallet(winner.userId), 1_300);
  assert.equal(count(`SELECT COUNT(*) n FROM game_results WHERE session_id = ?`, challenge.id), 2);
  assert.throws(() => games.accept({ sessionId: challenge.id, userId: 'b', now: T0 + 2_000, settings: s }), isUserError(/no longer open/));
});

test('duels: draws, declines, expiry and players leaving all return the stakes', () => {
  const { games, fund, wallet } = setup();
  fund('a', 1_000);
  fund('b', 1_000);
  const challenge = (now, game = 'duel-dice', extra = {}) => games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game, stake: 100, now, settings: s, ...extra });

  const draw = challenge(T0);
  games.accept({ sessionId: draw.id, userId: 'b', now: T0 + 1, settings: s, rng: () => 0.5 });
  assert.deepEqual([wallet('a'), wallet('b')], [1_000, 1_000], 'a draw refunds both');

  const declined = challenge(T0 + 20_000);
  games.cancel({ sessionId: declined.id, userId: 'b', now: T0 + 20_001, settings: s });
  assert.equal(games.get(declined.id).status, 'cancelled');
  assert.equal(wallet('a'), 1_000);

  const ignored = challenge(T0 + 40_000);
  games.expireDue(T0 + 40_000 + CHALLENGE_MS + 1, () => s);
  assert.equal(games.get(ignored.id).status, 'expired');
  assert.equal(wallet('a'), 1_000);

  const rps = challenge(T0 + 300_000, 'duel-rps');
  games.accept({ sessionId: rps.id, userId: 'b', now: T0 + 300_001, settings: s });
  assert.deepEqual([wallet('a'), wallet('b')], [900, 900]);
  const cancelled = games.cancelForMember({ guildId: G, userId: 'b', now: T0 + 300_002, settings: s });
  assert.equal(cancelled.length, 1);
  assert.deepEqual([wallet('a'), wallet('b')], [1_000, 1_000]);
});

test('rock paper scissors duels: secret picks and forfeits on timeout', () => {
  const { games, fund, wallet } = setup();
  fund('a', 500);
  fund('b', 500);
  const duel = games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-rps', stake: 200, now: T0, settings: s });
  const active = games.accept({ sessionId: duel.id, userId: 'b', now: T0 + 1, settings: s }).session;
  const pickAs = (userId, choice, now = T0 + 10) => games.act({ sessionId: duel.id, userId, action: `pick:${choice}`, now, settings: s });
  assert.throws(() => pickAs('c', 'rock'), isUserError(/not your game/));
  const hostPick = pickAs('a', 'rock');
  assert.equal(hostPick.settlement, null);
  assert.equal(hostPick.session.state.picks.host, 'rock', 'stored server-side only');
  // The opponent never picks: they forfeit when time runs out.
  games.expireDue(active.expires_at + 1, () => s);
  assert.deepEqual([wallet('a'), wallet('b')], [700, 300]);
});

test('friendly duels and validation', () => {
  const { games, fund, economy } = setup();
  fund('a', 50);
  assert.throws(() => games.challenge({ guildId: G, hostId: 'a', opponentId: 'a', game: 'duel-dice', stake: 0, now: T0, settings: s }), isUserError(/yourself/));
  assert.throws(() => games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-dice', stake: 100, now: T0, settings: s }), isUserError(/only have/));
  fund('a', 1_000);
  assert.throws(() => games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-dice', stake: 100, now: T0, settings: s }), isUserError(/<@b> only has/));
  economy.setFrozen({ guildId: G, actorId: 'admin', targetId: 'b', frozen: true, reason: 'test', now: T0, settings: s });
  assert.throws(() => games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game: 'duel-dice', stake: 0, now: T0, settings: s }), isUserError(/frozen/));

  const friendly = games.challenge({ guildId: G, hostId: 'a', opponentId: 'c', game: 'duel-coinflip', stake: 0, now: T0, settings: s });
  assert.throws(() => games.challenge({ guildId: G, hostId: 'a', opponentId: 'd', game: 'duel-dice', stake: 0, now: T0 + 20_000, settings: s }), isUserError(/already have a duel/));
  const { settlement } = games.accept({ sessionId: friendly.id, userId: 'c', now: T0 + 1, settings: s, rng: () => 0.1 });
  assert.equal(settlement.players.find((p) => p.userId === 'a').result, 'win');
  assert.equal(economy.account(G, 'a').xp, 10);
});

test('statistics: streaks, history and summaries', () => {
  const { games, fund, open, begin } = setup(economyDefaults({ gameCooldownPercent: 25 }));
  fund('u', 10_000);
  const flip = (i, rngValue) => begin(open('coinflip', 100, { now: T0 + i * 10_000 }), 'heads', { now: T0 + i * 10_000 + 1, rng: () => rngValue });
  flip(0, 0.1);
  flip(1, 0.1);
  flip(2, 0.9);
  flip(3, 0.1);
  const stat = games.statFor(G, 'u', 'coinflip');
  assert.equal(stat.played, 4);
  assert.equal(stat.wins, 3);
  assert.equal(stat.streak, 1);
  assert.equal(stat.best_streak, 2);
  assert.equal(stat.biggest_win, 100);
  assert.equal(games.history(G, 'u', 10).length, 4);
  const week = games.summary(G, 'u', T0 - 1, 'coinflip');
  assert.equal(week.returned - week.wagered, 200);
});

// ── Rendering: every screen must fit Discord's limits ──────────────────────

function assertFits(payload, label) {
  for (const embed of payload.embeds) {
    const json = embed.toJSON();
    const fields = json.fields ?? [];
    const size = (json.title?.length ?? 0) + (json.description?.length ?? 0) + (json.footer?.text?.length ?? 0)
      + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
    assert.ok(size <= 6000, `${label}: embed is ${size} characters`);
    assert.ok((json.description?.length ?? 0) <= 4096, `${label}: description`);
    assert.ok(fields.length <= 25 && fields.every((f) => f.value.length <= 1024 && f.name.length <= 256), `${label}: fields`);
  }
  const rows = payload.components.map((row) => row.toJSON());
  assert.ok(rows.length <= 5, `${label}: ${rows.length} rows`);
  const ids = rows.flatMap((row) => {
    assert.ok(row.components.length <= 5, `${label}: row width`);
    return row.components.map((c) => c.custom_id);
  });
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate custom IDs`);
  assert.ok(ids.every((id) => id.length <= 100), `${label}: custom ID length`);
}

const FIRST_ACTION = { coinflip: 'heads', dice: 'roll', slots: 'spin', roulette: 'spin', blackjack: 'deal', rps: 'pick:rock' };
const OPTIONS = {
  roulette: { bet: 'number', number: 7 }, quickmath: { difficulty: 'hard' }, guess: { difficulty: 'hard' }, memory: { difficulty: 'hard' },
  pattern: { difficulty: 'hard' }, unscramble: { difficulty: 'hard' }, rps: { mode: 'bo3' }, trivia: {},
};

/** A legal next move for each game, as [action, input, time]. */
function nextMove(session, now) {
  const s = session.state;
  switch (session.game) {
    case 'blackjack': return ['stand'];
    case 'higherlower': return [s.current > 50 ? 'lower' : 'higher'];
    case 'scratchcard': return [s.revealed.length < 3 ? `reveal:${s.revealed.length}` : 'all'];
    case 'trivia': case 'pattern': return ['pick:0'];
    case 'quickmath': return ['answer', String(s.answer)];
    case 'guess': return ['answer', String(Math.floor((s.low + s.high) / 2))];
    case 'wordguess': return ['answer', ['CRANE', 'MOIST'][s.guesses.length] ?? s.answer];
    case 'memory': return [`flip:${s.cards.findIndex((_, i) => !s.matched.includes(i) && i !== s.first)}`];
    case 'unscramble': return s.hint ? ['answer', s.word] : ['hint'];
    case 'reaction': return [`press:${s.order.indexOf(s.target)}`, null, s.goAt + 100];
    case 'fish': return ['reel', null, s.biteAt + 100];
    case 'treasure': return s.dug.length < 3 ? [`dig:${s.dug.length}`] : ['leave'];
    case 'rps': return ['pick:rock'];
    default: return [null, null, now];
  }
}

test('every game screen fits Discord limits at every stage', () => {
  const ctx = fakeCtx();
  const { games, economy } = getServices(ctx);
  const settings = economyDefaults();
  for (const game of Object.keys(GAMES).filter((key) => !isDuelGame(key))) {
    const userId = `player-${game}`;
    economy.credit({ guildId: G, userId, amount: 100_000, type: 'test', settings, now: T0 });
    const meta = GAMES[game];
    const stake = meta.stake === 'fixed' ? meta.price : meta.stake === 'none' ? 0 : 100;
    const base = { guildId: G, userId, game, stake, options: OPTIONS[game] ?? {}, settings, rng: seeded(7) };
    let result;
    if (stake > 0) {
      const card = games.open({ ...base, now: T0 });
      assertFits(gameView(ctx, card), `${game} card`);
      result = games.begin({ sessionId: card.id, userId, action: FIRST_ACTION[game] ?? null, now: T0 + 1, settings, rng: seeded(7) });
    } else {
      result = games.start({ ...base, now: T0 });
    }
    let now = T0 + 1_000;
    for (let step = 0; step < 60 && !result.settlement; step += 1) {
      assertFits(gameView(ctx, result.session, { feedback: result.feedback, now }), `${game} step ${step}`);
      if (game === 'reaction' || game === 'fish') assertFits(gameView(ctx, result.session, { now: now + 10_000 }), `${game} signal`);
      const [action, input, at] = nextMove(result.session, now);
      now = at ?? now + 1_000;
      result = games.act({ sessionId: result.session.id, userId, action, input, now, settings, rng: seeded(step + 1) });
    }
    assert.ok(result.settlement, `${game} finished`);
    assertFits(gameView(ctx, result.session, { feedback: result.feedback, settlement: result.settlement }), `${game} result`);
  }

  economy.credit({ guildId: G, userId: 'late', amount: 100, type: 'test', settings, now: T0 });
  const expiredCard = games.open({ guildId: G, userId: 'late', game: 'coinflip', stake: 50, settings, now: T0 }).id;
  games.expireDue(T0 + PENDING_MS + 1, () => settings);
  assertFits(gameView(ctx, games.get(expiredCard)), 'expired card');

  for (const category of Object.keys(GAME_CATEGORIES)) assertFits(dashboardView(ctx, G, 'player-trivia', category), `dashboard ${category}`);
});

test('every duel screen fits Discord limits', () => {
  const ctx = fakeCtx();
  const { games, economy } = getServices(ctx);
  const settings = economyDefaults({ gameCooldownPercent: 25 });
  for (const id of ['a', 'b']) economy.credit({ guildId: G, userId: id, amount: 10_000, type: 'test', settings, now: T0 });
  let now = T0;
  const challenge = (game, options = {}) => {
    now += 60_000;
    return games.challenge({ guildId: G, hostId: 'a', opponentId: 'b', game, stake: 100, options, now, settings });
  };
  for (const game of ['duel-dice', 'duel-coinflip']) {
    const open = challenge(game);
    assertFits(duelView(ctx, open), `${game} open`);
    const { session } = games.accept({ sessionId: open.id, userId: 'b', now: now + 1, settings, rng: seeded(3) });
    assertFits(duelView(ctx, session), `${game} settled`);
  }
  const rps = challenge('duel-rps', { mode: 'bo3' });
  let session = games.accept({ sessionId: rps.id, userId: 'b', now: now + 1, settings }).session;
  for (let round = 0; session.status === 'active'; round += 1) {
    assertFits(duelView(ctx, session), `rps round ${round}`);
    games.act({ sessionId: rps.id, userId: 'a', action: 'pick:rock', now: now + 2, settings });
    session = games.act({ sessionId: rps.id, userId: 'b', action: round % 3 === 0 ? 'pick:rock' : 'pick:paper', now: now + 3, settings }).session;
  }
  assertFits(duelView(ctx, session), 'rps settled');
  const declined = challenge('duel-dice');
  assertFits(duelView(ctx, games.cancel({ sessionId: declined.id, userId: 'b', now: now + 1, settings })), 'declined');
  const ignored = challenge('duel-dice');
  games.expireDue(ignored.expires_at + 1, () => settings);
  assertFits(duelView(ctx, games.get(ignored.id)), 'expired');
});
