import crypto from 'node:crypto';
import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { NO_ACTIVITY } from './activity.js';
import { formatCoins, rewardPeriod } from './economyRules.js';
import { fishingLevel } from './games/adventure.js';
import { CHALLENGE_MS, cooldownKey, GAMES, isDuelGame, isFreePlay, PENDING_MS, timeLimitFor } from './games/catalogue.js';
import { QUESTIONS } from './games/data/trivia.js';
import { ENGINES } from './games/index.js';
import { FREE_REWARDS, SPIN_SEGMENTS } from './games/tables.js';
import { JOBS } from './jobTasks.js';
import { pick, secureRandom, weighted } from './random.js';

const DAY = 86_400_000;
const OPEN = ['pending', 'open', 'active'];
/** Free games in these categories count towards member progression when won. */
const PROGRESSION_CATEGORIES = new Set(['puzzle', 'reaction']);

/**
 * Mini-game sessions, stakes and settlement. Every public method is one SQLite transaction:
 * - stakes move into escrow (game_stakes) when a game starts and are settled or refunded exactly once,
 * - every status change is conditional, so double clicks and retries cannot apply twice,
 * - game_results has one row per player and session, so a game can never pay twice,
 * - one solo game in progress per member, and persistent cooldowns that start with the game.
 */
export function createGameService(db, economy, jobs, { pets = null, inventory = null, activity = NO_ACTIVITY } = {}) {
  const q = {
    insert: db.prepare(`
      INSERT INTO game_sessions (id, guild_id, game, host_id, opponent_id, stake, options, status, channel_id, created_at, expires_at)
      VALUES (@id, @guildId, @game, @hostId, @opponentId, @stake, @options, @status, @channelId, @now, @expiresAt)
    `),
    get: db.prepare('SELECT * FROM game_sessions WHERE id = ?'),
    activeSolo: db.prepare(`SELECT * FROM game_sessions WHERE guild_id = ? AND host_id = ? AND status = 'active' AND opponent_id IS NULL`),
    hostDuel: db.prepare(`SELECT * FROM game_sessions WHERE guild_id = ? AND host_id = ? AND status IN ('open', 'active') AND opponent_id IS NOT NULL`),
    cancelPending: db.prepare(`UPDATE game_sessions SET status = 'cancelled', finished_at = @now WHERE guild_id = @guildId AND host_id = @userId AND status = 'pending'`),
    activate: db.prepare(`
      UPDATE game_sessions SET status = 'active', started_at = @now, expires_at = @expiresAt, state = @state, options = @options
      WHERE id = @id AND status = @from
    `),
    // `stake` stays the base stake per player; extra holds (a double down) live in game_stakes.
    saveState: db.prepare('UPDATE game_sessions SET state = ? WHERE id = ?'),
    settle: db.prepare(`UPDATE game_sessions SET status = 'settled', finished_at = @now, outcome = @outcome WHERE id = @id AND status = 'active'`),
    close: db.prepare(`UPDATE game_sessions SET status = @status, finished_at = @now, outcome = @outcome WHERE id = @id AND status IN ('pending', 'open', 'active')`),
    setMessage: db.prepare('UPDATE game_sessions SET channel_id = ?, message_id = ? WHERE id = ?'),
    due: db.prepare(`SELECT id FROM game_sessions WHERE status IN ('pending', 'open', 'active') AND expires_at <= ? ORDER BY expires_at LIMIT 200`),
    memberDuels: db.prepare(`
      SELECT id FROM game_sessions WHERE guild_id = ? AND opponent_id IS NOT NULL AND status IN ('open', 'active') AND (host_id = ? OR opponent_id = ?)
    `),
    prune: db.prepare(`DELETE FROM game_sessions WHERE status IN ('settled', 'cancelled', 'expired') AND finished_at < ?`),

    insertStake: db.prepare(`
      INSERT INTO game_stakes (session_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id, user_id) DO UPDATE SET amount = amount + excluded.amount WHERE status = 'held'
    `),
    heldStakes: db.prepare(`SELECT * FROM game_stakes WHERE session_id = ? AND status = 'held'`),
    heldStake: db.prepare(`SELECT amount FROM game_stakes WHERE session_id = ? AND user_id = ? AND status = 'held'`),
    resolveStake: db.prepare(`UPDATE game_stakes SET status = ?, resolved_at = ? WHERE session_id = ? AND user_id = ? AND status = 'held'`),

    insertResult: db.prepare(`
      INSERT INTO game_results (session_id, guild_id, user_id, game, opponent_id, stake, payout, free, result, created_at)
      VALUES (@sessionId, @guildId, @userId, @game, @opponentId, @stake, @payout, @free, @result, @now)
    `),
    upsertStats: db.prepare(`
      INSERT INTO game_statistics (guild_id, user_id, game, played, wins, losses, pushes, wagered, returned, biggest_win, streak, best_streak, xp, updated_at)
      VALUES (@guildId, @userId, @game, 1, @win, @loss, @push, @stake, @payout, @net, @win, @win, @gameXp, @now)
      ON CONFLICT (guild_id, user_id, game) DO UPDATE SET
        played = played + 1, wins = wins + excluded.wins, losses = losses + excluded.losses, pushes = pushes + excluded.pushes,
        wagered = wagered + excluded.wagered, returned = returned + excluded.returned, biggest_win = MAX(biggest_win, excluded.biggest_win),
        streak = CASE WHEN excluded.wins = 1 THEN streak + 1 WHEN excluded.losses = 1 THEN 0 ELSE streak END,
        best_streak = MAX(best_streak, CASE WHEN excluded.wins = 1 THEN streak + 1 ELSE 0 END),
        xp = xp + excluded.xp, updated_at = excluded.updated_at
    `),
    freeEarned: db.prepare('SELECT COALESCE(SUM(payout), 0) AS n FROM game_results WHERE guild_id = ? AND user_id = ? AND free = 1 AND created_at > ?'),
    stats: db.prepare('SELECT * FROM game_statistics WHERE guild_id = ? AND user_id = ? ORDER BY played DESC, game'),
    statFor: db.prepare('SELECT * FROM game_statistics WHERE guild_id = ? AND user_id = ? AND game = ?'),
    history: db.prepare('SELECT * FROM game_results WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'),
    summary: db.prepare(`
      SELECT COUNT(*) AS played, COALESCE(SUM(result = 'win'), 0) AS wins, COALESCE(SUM(result = 'loss'), 0) AS losses,
        COALESCE(SUM(stake), 0) AS wagered, COALESCE(SUM(payout), 0) AS returned
      FROM game_results WHERE guild_id = @guildId AND user_id = @userId AND created_at > @since AND (@game IS NULL OR game = @game)
    `),

    lastClaim: db.prepare('SELECT * FROM game_claims WHERE guild_id = ? AND user_id = ? AND game = ? ORDER BY claimed_at DESC LIMIT 1'),
    insertClaim: db.prepare('INSERT INTO game_claims (guild_id, user_id, game, period, reward, claimed_at, period_end_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    seen: db.prepare('SELECT question_id, asked_at FROM trivia_history WHERE guild_id = ? AND user_id = ?'),
    markSeen: db.prepare(`
      INSERT INTO trivia_history (guild_id, user_id, question_id, asked_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id, question_id) DO UPDATE SET asked_at = excluded.asked_at
    `),
  };

  const tx = (fn) => db.transaction(fn).immediate();
  const parse = (row) => row && {
    ...row, options: JSON.parse(row.options), state: row.state ? JSON.parse(row.state) : null, outcome: row.outcome ? JSON.parse(row.outcome) : null,
  };
  const load = (id) => parse(q.get.get(id));
  const fail = (message, title) => {
    throw new UserError(message, { title });
  };
  const cooldownMs = (game, settings) => Math.round((GAMES[game].cooldownMs * settings.gameCooldownPercent) / 100);

  // ── Checks ────────────────────────────────────────────────────────────────

  function assertPlayable(guildId, userId, settings, self = true) {
    if (!settings.gamesEnabled) fail('Mini-games are disabled in this server.', 'Disabled');
    if (economy.account(guildId, userId).frozen) {
      fail(self ? 'Your economy account is frozen. Please contact a server admin.' : `<@${userId}>'s economy account is frozen.`, 'Account frozen');
    }
  }

  function assertStake(game, stake, settings) {
    const meta = GAMES[game];
    if (!Number.isSafeInteger(stake) || stake < 0) fail('Stakes must be a whole number of Lyss Coins.', 'Invalid stake');
    if (meta.stake === 'none' && stake !== 0) fail(`${meta.name} is free to play.`, 'Invalid stake');
    if (meta.stake === 'fixed') {
      if (stake !== meta.price) fail(`${meta.name} costs ${formatCoins(meta.price)}.`, 'Invalid stake');
      return;
    }
    if (meta.stake === 'required' && stake === 0) fail(`${meta.name} needs a stake.`, 'Stake required');
    if (stake > 0 && stake < settings.gameMinBet) fail(`The smallest stake is ${formatCoins(settings.gameMinBet)}.`, 'Stake too small');
    if (stake > settings.gameMaxBet) fail(`The largest stake is ${formatCoins(settings.gameMaxBet)}.`, 'Stake too large');
  }

  function assertFunds(guildId, userId, amount, settings, self = true) {
    const { wallet } = economy.account(guildId, userId);
    if (amount > wallet) {
      fail(self ? `You only have ${formatCoins(wallet)} in your wallet.` : `<@${userId}> only has ${formatCoins(wallet)} in their wallet.`, 'Insufficient funds');
    }
    if (self && settings.maxWallet > 0 && wallet >= settings.maxWallet) {
      fail('Your wallet is at the server limit. Deposit some coins before playing for more.', 'Wallet limit reached');
    }
  }

  function assertCooldown(guildId, userId, game, now) {
    const readyAt = economy.cooldown(guildId, userId, cooldownKey(game));
    if (readyAt > now) fail(`You can play ${GAMES[game].name} again ${discordTimestamp(readyAt, 'R')}.`, 'Slow down');
  }

  // ── Stakes and settlement ─────────────────────────────────────────────────

  function hold(session, userId, amount, now, settings) {
    economy.holdStake({ guildId: session.guild_id, userId, amount, reference: session.game, operationKey: `game:${session.id}:stake`, now, settings });
    q.insertStake.run(session.id, userId, amount, now);
  }

  function settlePlayer(session, player, now, settings) {
    const stake = q.heldStake.get(session.id, player.userId)?.amount ?? 0;
    let payout = player.payout;
    let capped = false;
    if (player.free) {
      // Free games: apply the server's reward multiplier and the rolling 24-hour cap.
      const reward = Math.floor((payout * settings.gameRewardPercent) / 100);
      const room = Math.max(0, settings.freeGameDailyCap - q.freeEarned.get(session.guild_id, player.userId, now - DAY).n);
      payout = Math.min(reward, room);
      capped = payout < reward;
    }
    const xp = player.xp ?? 0;
    if (stake > 0 || payout > 0 || xp > 0) {
      economy.settleStake({
        guildId: session.guild_id, userId: player.userId, stake, payout, xp, type: stake > 0 ? 'game_payout' : 'game_reward',
        reference: session.game, operationKey: `game:${session.id}:settle`, now, settings,
      });
    }
    if (stake > 0 && !q.resolveStake.run('settled', now, session.id, player.userId).changes) throw new Error(`Stake for game ${session.id} was already resolved`);
    const opponentId = player.userId === session.host_id ? session.opponent_id : session.host_id;
    q.insertResult.run({
      sessionId: session.id, guildId: session.guild_id, userId: player.userId, game: session.game, opponentId,
      stake, payout, free: player.free ? 1 : 0, result: player.result, now,
    });
    q.upsertStats.run({
      guildId: session.guild_id, userId: player.userId, game: session.game, stake, payout, now,
      win: player.result === 'win' ? 1 : 0, loss: player.result === 'loss' ? 1 : 0, push: player.result === 'push' ? 1 : 0,
      net: Math.max(0, payout - stake), gameXp: player.gameXp ?? 0,
    });
    // Member XP for winning a duel or a free puzzle or reaction game; never for games of chance.
    const eligible = player.result === 'win' && (session.opponent_id ? 'duel_won' : player.free && PROGRESSION_CATEGORIES.has(GAMES[session.game].category) ? 'game_won' : null);
    const progression = eligible
      ? activity.emit({ guildId: session.guild_id, userId: player.userId, activity: eligible, operationKey: `game:${session.id}`, now, settings }).progression ?? null
      : null;
    return { userId: player.userId, result: player.result, stake, payout, net: payout - stake, xp, gameXp: player.gameXp ?? 0, capped, progression };
  }

  function duelPlayers(session, { winner }) {
    const pot = q.heldStakes.all(session.id).reduce((sum, s) => sum + s.amount, 0);
    return [['host', session.host_id], ['opponent', session.opponent_id]].map(([side, userId]) => {
      if (!winner) return { userId, result: 'push', payout: q.heldStake.get(session.id, userId)?.amount ?? 0 };
      return side === winner
        ? { userId, result: 'win', payout: pot, xp: FREE_REWARDS.duelWinnerXp }
        : { userId, result: 'loss', payout: 0 };
    });
  }

  function settle(session, outcome, now, settings) {
    if (!q.settle.run({ id: session.id, now, outcome: JSON.stringify(outcome) }).changes) fail('This game is already finished.', 'Game finished');
    const players = session.opponent_id
      ? duelPlayers(session, outcome)
      : [{ userId: session.host_id, ...outcome, free: isFreePlay(session.game, session.stake) }];
    return { outcome, players: players.map((player) => settlePlayer(session, player, now, settings)) };
  }

  /** Closes a game without a result and returns every held stake. */
  function refund(session, status, now, settings, reason) {
    if (!q.close.run({ id: session.id, status, now, outcome: JSON.stringify({ refunded: true, reason }) }).changes) fail('This game is already finished.', 'Game finished');
    for (const held of q.heldStakes.all(session.id)) {
      economy.settleStake({
        guildId: session.guild_id, userId: held.user_id, stake: held.amount, payout: held.amount, type: 'game_refund',
        reference: session.game, operationKey: `game:${session.id}:refund`, now, settings,
      });
      q.resolveStake.run('refunded', now, session.id, held.user_id);
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  function chooseQuestion(guildId, userId, { category, difficulty }, rng) {
    let pool = QUESTIONS.filter((x) => (!category || x.category === category) && (!difficulty || x.difficulty === difficulty));
    if (!pool.length) pool = QUESTIONS.filter((x) => !category || x.category === category);
    const seen = new Map(q.seen.all(guildId, userId).map((row) => [row.question_id, row.asked_at]));
    const fresh = pool.filter((x) => !seen.has(x.id));
    if (fresh.length) return pick(rng, fresh);
    // Everything has been seen: choose among the questions seen longest ago.
    const oldest = [...pool].sort((a, b) => seen.get(a.id) - seen.get(b.id));
    return pick(rng, oldest.slice(0, Math.max(1, Math.ceil(oldest.length / 4))));
  }

  /** Server-side inputs some games need before they start. */
  function prepareOptions(session, rng, now) {
    const { guild_id: guildId, host_id: userId, game, options } = session;
    if (game === 'trivia') {
      const question = chooseQuestion(guildId, userId, options, rng);
      q.markSeen.run(guildId, userId, question.id, now);
      return { ...options, questionId: question.id };
    }
    if (game === 'fish') return { ...options, level: fishingLevel(q.statFor.get(guildId, userId, 'fish')?.xp ?? 0) };
    return options;
  }

  function activate(session, now, settings, rng) {
    const { guild_id: guildId, host_id: userId, game, stake } = session;
    assertPlayable(guildId, userId, settings);
    assertStake(game, stake, settings);
    assertCooldown(guildId, userId, game, now);
    const current = parse(q.activeSolo.get(guildId, userId));
    if (current && current.expires_at <= now) expireSession(current, now, settings, rng);
    else if (current) {
      fail(`You already have a game of ${GAMES[current.game].name} in progress. Finish it or quit it from \`/games\`; it ends ${discordTimestamp(current.expires_at, 'R')}.`, 'Game in progress');
    }
    const options = prepareOptions(session, rng, now);
    const timeLimitMs = timeLimitFor(game, options);
    const state = ENGINES[game].start({ stake, options, rng, now, timeLimitMs });
    const activated = q.activate.run({
      id: session.id, from: session.status, now, expiresAt: now + timeLimitMs, state: JSON.stringify(state), options: JSON.stringify(options),
    });
    if (!activated.changes) fail('This game has already started.', 'Already started');
    if (stake > 0) hold(session, userId, stake, now, settings);
    economy.setCooldown(guildId, userId, cooldownKey(game), now + cooldownMs(game, settings));
    return load(session.id);
  }

  function runAction(session, actor, action, input, now, settings, rng) {
    const step = ENGINES[session.game].act(structuredClone(session.state), action, { rng, now, input, actor });
    if (step.invalid) fail(step.feedback, 'Not allowed');
    if (step.hold) hold(session, actor === 'host' ? session.host_id : session.opponent_id, step.hold, now, settings);
    q.saveState.run(JSON.stringify(step.state), session.id);
    const settlement = step.done ? settle({ ...session, state: step.state }, step.outcome, now, settings) : null;
    return { session: load(session.id), feedback: step.feedback ?? null, settlement };
  }

  /** What happens when time runs out (or a player quits): the game's own expiry rule. */
  function expireSession(session, now, settings, rng) {
    if (session.status === 'pending') {
      q.close.run({ id: session.id, status: 'expired', now, outcome: null });
      return { session: load(session.id), feedback: null, settlement: null };
    }
    if (session.status === 'open') {
      refund(session, 'expired', now, settings, 'not accepted');
      return { session: load(session.id), feedback: null, settlement: null, refunded: true };
    }
    const step = ENGINES[session.game].expire(structuredClone(session.state), { rng, now });
    if (!step) {
      refund(session, 'expired', now, settings, 'timed out');
      return { session: load(session.id), feedback: null, settlement: null, refunded: true };
    }
    q.saveState.run(JSON.stringify(step.state), session.id);
    const settlement = settle({ ...session, state: step.state }, { ...step.outcome, timedOut: true }, now, settings);
    return { session: load(session.id), feedback: step.feedback ?? null, settlement };
  }

  function insertSession({ guildId, game, hostId, opponentId = null, stake, options, status, channelId, now, expiresAt }) {
    const id = crypto.randomUUID();
    q.insert.run({ id, guildId, game, hostId, opponentId, stake, options: JSON.stringify(options), status, channelId, now, expiresAt });
    return load(id);
  }

  return {
    get: load,
    activeFor: (guildId, userId) => parse(q.activeSolo.get(guildId, userId)),
    setMessage: (id, channelId, messageId) => q.setMessage.run(channelId, messageId, id),

    /** A confirmation card for a staked game. Nothing is taken until it is confirmed with begin(). */
    open({ guildId, userId, game, stake = 0, options = {}, now = Date.now(), settings, channelId = null }) {
      if (!ENGINES[game] || isDuelGame(game)) throw new Error(`Unknown solo game ${game}`);
      return tx(() => {
        assertPlayable(guildId, userId, settings);
        assertStake(game, stake, settings);
        if (stake > 0) assertFunds(guildId, userId, stake, settings);
        assertCooldown(guildId, userId, game, now);
        q.cancelPending.run({ guildId, userId, now });
        return insertSession({ guildId, game, hostId: userId, stake, options, status: 'pending', channelId, now, expiresAt: now + PENDING_MS });
      });
    },

    /** Confirms a card: takes the stake, starts the game and optionally applies the first action. */
    begin({ sessionId, userId, action = null, input = null, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const session = load(sessionId);
        if (!session) fail('This game no longer exists.', 'This has expired');
        if (session.host_id !== userId) fail('This is not your game. Start your own from `/games`.', 'Not your game');
        if (session.status !== 'pending') fail(session.status === 'active' || session.status === 'settled' ? 'This game has already started.' : 'This offer is no longer available. Start a new game.', 'Already started');
        if (now > session.expires_at) fail('This offer has expired. Start a new game.', 'This has expired');
        if (session.stake > 0) assertFunds(session.guild_id, userId, session.stake, settings);
        const active = activate(session, now, settings, rng);
        return action ? runAction(active, 'host', action, input, now, settings, rng) : { session: active, feedback: null, settlement: null };
      });
    },

    /** Starts a game straight away (free games, and staked games confirmed elsewhere). */
    start({ guildId, userId, game, stake = 0, options = {}, now = Date.now(), settings, rng = secureRandom, channelId = null }) {
      if (!ENGINES[game] || isDuelGame(game)) throw new Error(`Unknown solo game ${game}`);
      return tx(() => {
        if (stake > 0) assertFunds(guildId, userId, stake, settings);
        const session = insertSession({ guildId, game, hostId: userId, stake, options, status: 'pending', channelId, now, expiresAt: now + PENDING_MS });
        return { session: activate(session, now, settings, rng), feedback: null, settlement: null };
      });
    },

    /** One player action. Only participants can act, and only while the game is active and in time. */
    act({ sessionId, userId, action, input = null, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const session = load(sessionId);
        if (!session) fail('This game no longer exists.', 'This has expired');
        const actor = session.host_id === userId ? 'host' : session.opponent_id === userId ? 'opponent' : null;
        if (!actor) fail('This is not your game.', 'Not your game');
        if (session.status !== 'active') fail(session.status === 'pending' ? 'Confirm the game first.' : 'This game is already finished.', 'Game finished');
        if (now > session.expires_at) return { ...expireSession(session, now, settings, rng), expired: true };
        return runAction(session, actor, action, input, now, settings, rng);
      });
    },

    /** Ends a solo game early by its expiry rule (blackjack stands, higher-lower cashes out, puzzles end). */
    quit({ sessionId = null, guildId, userId, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const session = sessionId ? load(sessionId) : parse(q.activeSolo.get(guildId, userId));
        if (!session || session.host_id !== userId || session.opponent_id) fail('You have no game in progress.', 'Nothing to quit');
        if (session.status !== 'active') fail('This game is already finished.', 'Game finished');
        return { ...expireSession(session, now, settings, rng), quit: true };
      });
    },

    /** Withdraws a card or challenge. The opponent declining a challenge also lands here. */
    cancel({ sessionId, userId, now = Date.now(), settings }) {
      return tx(() => {
        const session = load(sessionId);
        if (!session || (session.host_id !== userId && session.opponent_id !== userId)) fail('This is not your game.', 'Not your game');
        if (session.status === 'pending' && session.host_id === userId) {
          q.close.run({ id: session.id, status: 'cancelled', now, outcome: null });
          return load(session.id);
        }
        if (session.status === 'open') {
          refund(session, 'cancelled', now, settings, session.host_id === userId ? 'withdrawn' : 'declined');
          return load(session.id);
        }
        return fail('This game can no longer be cancelled.', 'Already started');
      });
    },

    // ── Duels ───────────────────────────────────────────────────────────────

    /** Opens a challenge and holds the challenger's stake. */
    challenge({ guildId, hostId, opponentId, game, stake = 0, options = {}, now = Date.now(), settings, rng = secureRandom, channelId = null }) {
      if (!isDuelGame(game)) throw new Error(`Unknown duel game ${game}`);
      if (hostId === opponentId) fail('You cannot challenge yourself.', 'Invalid opponent');
      return tx(() => {
        assertPlayable(guildId, hostId, settings);
        assertPlayable(guildId, opponentId, settings, false);
        assertStake(game, stake, settings);
        if (stake > 0) {
          assertFunds(guildId, hostId, stake, settings);
          assertFunds(guildId, opponentId, stake, settings, false);
        }
        assertCooldown(guildId, hostId, game, now);
        const existing = parse(q.hostDuel.get(guildId, hostId));
        if (existing && existing.expires_at <= now) expireSession(existing, now, settings, rng);
        else if (existing) fail(`You already have a duel open. It ends ${discordTimestamp(existing.expires_at, 'R')}.`, 'Duel in progress');
        const session = insertSession({ guildId, game, hostId, opponentId, stake, options, status: 'open', channelId, now, expiresAt: now + CHALLENGE_MS });
        if (stake > 0) hold(session, hostId, stake, now, settings);
        economy.setCooldown(guildId, hostId, cooldownKey(game), now + cooldownMs(game, settings));
        return load(session.id);
      });
    },

    /** The opponent accepts: their stake is held and the duel starts (instant duels settle at once). */
    accept({ sessionId, userId, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const session = load(sessionId);
        if (!session?.opponent_id) fail('This challenge no longer exists.', 'This has expired');
        if (session.opponent_id !== userId) fail('This challenge is not for you.', 'Not your duel');
        if (session.status !== 'open') fail('This challenge is no longer open.', 'Challenge closed');
        if (now > session.expires_at) fail('This challenge has expired.', 'This has expired');
        assertPlayable(session.guild_id, userId, settings);
        const timeLimitMs = timeLimitFor(session.game, session.options);
        const state = ENGINES[session.game].start({ stake: session.stake, options: session.options, rng, now, timeLimitMs });
        q.activate.run({ id: session.id, from: 'open', now, expiresAt: now + timeLimitMs, state: JSON.stringify(state), options: JSON.stringify(session.options) });
        if (session.stake > 0) hold(session, userId, session.stake, now, settings);
        const active = load(session.id);
        return ENGINES[session.game].instant ? runAction(active, 'host', 'play', null, now, settings, rng) : { session: active, feedback: null, settlement: null };
      });
    },

    /** Cancels a member's open or running duels (e.g. they left the server), returning every stake. */
    cancelForMember({ guildId, userId, now = Date.now(), settings }) {
      const ids = q.memberDuels.all(guildId, userId, userId).map((row) => row.id);
      return ids.map((id) => tx(() => {
        const session = load(id);
        if (!session || !['open', 'active'].includes(session.status)) return null;
        refund(session, 'cancelled', now, settings, 'a player left the server');
        return load(id);
      })).filter(Boolean);
    },

    /** Applies expiry rules to every overdue game. Each game is its own transaction. */
    expireDue(now, settingsFor, rng = secureRandom) {
      const results = [];
      for (const { id } of q.due.all(now)) {
        try {
          const result = tx(() => {
            const session = load(id);
            if (!session || !OPEN.includes(session.status) || session.expires_at > now) return null;
            return expireSession(session, now, settingsFor(session.guild_id), rng);
          });
          if (result) results.push(result);
        } catch (error) {
          results.push({ id, error });
        }
      }
      return results;
    },

    // ── Daily spin ──────────────────────────────────────────────────────────

    /** One spin per day in the server timezone. The stored period end makes timezone changes safe. */
    dailySpin({ guildId, userId, now = Date.now(), zone, settings, rng = secureRandom }) {
      return tx(() => {
        assertPlayable(guildId, userId, settings);
        const last = q.lastClaim.get(guildId, userId, 'dailyspin');
        if (last && now < last.period_end_at) fail(`You already spun today. Your next spin is ${discordTimestamp(last.period_end_at, 'R')}.`, 'Already spun');
        const { period, endAt } = rewardPeriod('daily', now, zone);
        const segment = weighted(rng, SPIN_SEGMENTS);
        q.insertClaim.run(guildId, userId, 'dailyspin', period, segment.key, now, endAt);
        let job = null;
        if (segment.jobXp) {
          job = jobs.topJob(guildId, userId) ?? pick(rng, Object.keys(JOBS));
          jobs.grantXp(guildId, userId, job, segment.jobXp, now);
        }
        // Pet XP goes to the active pet; members without a pet get the fallback coins instead.
        const pet = segment.petXp ? pets?.grantXp({ guildId, userId, xp: segment.petXp, now, settings }) ?? null : null;
        const coins = (segment.coins ?? 0) + (segment.petXp && !pet ? segment.fallbackCoins : 0);
        const xp = segment.xp ?? 0;
        const operationKey = `dailyspin:${period}`;
        if (coins || xp) {
          economy.settleStake({ guildId, userId, stake: 0, payout: coins, xp, type: 'daily_spin', reference: period, operationKey, now, settings });
        }
        const items = segment.items ?? [];
        if (items.length && !inventory) throw new Error('The daily spin needs the inventory service for item rewards');
        for (const { item, quantity } of items) inventory.grant({ guildId, userId, item, quantity, type: 'daily_spin', reference: period, operationKey, now });
        q.insertResult.run({ sessionId: operationKey, guildId, userId, game: 'dailyspin', opponentId: null, stake: 0, payout: coins, free: 0, result: 'win', now });
        q.upsertStats.run({ guildId, userId, game: 'dailyspin', win: 1, loss: 0, push: 0, stake: 0, payout: coins, net: coins, gameXp: 0, now });
        return { segment, coins, xp, job, jobXp: segment.jobXp ?? 0, pet, items, nextAt: endAt };
      });
    },
    spinReadyAt: (guildId, userId) => q.lastClaim.get(guildId, userId, 'dailyspin')?.period_end_at ?? 0,

    // ── Statistics ──────────────────────────────────────────────────────────

    stats: (guildId, userId) => q.stats.all(guildId, userId),
    statFor: (guildId, userId, game) => q.statFor.get(guildId, userId, game) ?? null,
    history: (guildId, userId, limit = 10) => q.history.all(guildId, userId, limit),
    summary: (guildId, userId, since, game = null) => q.summary.get({ guildId, userId, since, game }),
    freeEarnedSince: (guildId, userId, since) => q.freeEarned.get(guildId, userId, since).n,
    fishingLevel: (guildId, userId) => fishingLevel(q.statFor.get(guildId, userId, 'fish')?.xp ?? 0),
    prune: (before) => q.prune.run(before).changes,
  };
}
