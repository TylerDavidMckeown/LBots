import { pick } from '../random.js';
import { rollTwo, total } from './casino.js';
import { finish, invalid, next, staked } from './engine.js';
import { FREE_REWARDS } from './tables.js';

/**
 * Head-to-head games. Duel engines report { winner: 'host' | 'opponent' | null };
 * gameService turns that into payouts (the winner takes both stakes, a draw refunds both).
 */

// ── Rock, Paper, Scissors ──────────────────────────────────────────────────

export const RPS_CHOICES = Object.freeze({
  rock: { emoji: '🪨', label: 'Rock', beats: 'scissors' },
  paper: { emoji: '📄', label: 'Paper', beats: 'rock' },
  scissors: { emoji: '✂️', label: 'Scissors', beats: 'paper' },
});
/** Drawn rounds are replayed, up to this many rounds in total; then the match is a draw. */
export const RPS_MAX_ROUNDS = 9;

export const rpsRound = (a, b) => (a === b ? 0 : RPS_CHOICES[a].beats === b ? 1 : -1);

const rpsStart = ({ options }) => ({
  mode: options.mode === 'bo3' ? 'bo3' : 'single',
  need: options.mode === 'bo3' ? 2 : 1,
  picks: { host: null, opponent: null },
  score: { host: 0, opponent: 0 },
  rounds: [],
});

/** Records a pick; resolves the round once both sides have picked. */
function rpsPick(state, action, { actor, rng }, vsBot) {
  const choice = /^pick:(rock|paper|scissors)$/.exec(action ?? '')?.[1];
  if (!choice) return { step: invalid(state, 'Pick rock, paper or scissors.') };
  if (state.picks[actor]) return { step: invalid(state, 'You already picked this round. Waiting for your opponent.') };
  state.picks[actor] = choice;
  if (vsBot) state.picks.opponent = pick(rng, Object.keys(RPS_CHOICES));
  if (!state.picks.host || !state.picks.opponent) return { step: next(state, 'Choice locked in.') };
  const result = rpsRound(state.picks.host, state.picks.opponent);
  state.rounds.push({ host: state.picks.host, opponent: state.picks.opponent, result });
  if (result > 0) state.score.host += 1;
  if (result < 0) state.score.opponent += 1;
  state.picks = { host: null, opponent: null };
  const winner = state.score.host >= state.need ? 'host' : state.score.opponent >= state.need ? 'opponent' : null;
  if (winner) return { winner };
  if (state.rounds.length >= RPS_MAX_ROUNDS) return { winner: null };
  return { step: next(state, result === 0 ? 'Draw! Go again.' : 'Next round!') };
}

/** Solo against the bot, with an optional stake. */
export const rps = {
  start: ({ stake, options }) => ({ ...rpsStart({ options }), stake }),
  act(state, action, ctx) {
    const played = rpsPick(state, action, { ...ctx, actor: 'host' }, true);
    if (played.step) return played.step;
    if (played.winner === 'host') {
      if (state.stake > 0) return finish(state, staked(state.stake, state.stake * 2), 'You win!');
      return finish(state, { result: 'win', payout: FREE_REWARDS.rps.coins, xp: FREE_REWARDS.rps.xp }, 'You win!');
    }
    if (played.winner === 'opponent') return finish(state, state.stake > 0 ? staked(state.stake, 0) : { result: 'loss', payout: 0 }, 'The bot wins.');
    return finish(state, state.stake > 0 ? staked(state.stake, state.stake) : { result: 'push', payout: 0 }, `${RPS_MAX_ROUNDS} rounds without a winner: it's a draw.`);
  },
  /** Before any round: refund. After a round, walking away forfeits (so quitting a losing match cannot refund it). */
  expire: (state) => (state.rounds.length
    ? finish(state, state.stake > 0 ? staked(state.stake, 0) : { result: 'loss', payout: 0 }, 'You walked away, so the bot wins.')
    : null),
};

/** Player against player. Both pick in secret; nobody sees a pick until the round resolves. */
export const duelRps = {
  start: rpsStart,
  act(state, action, ctx) {
    const played = rpsPick(state, action, ctx, false);
    if (played.step) return played.step;
    return finish(state, { winner: played.winner }, played.winner ? null : `${RPS_MAX_ROUNDS} rounds without a winner: it's a draw.`);
  },
  /** If only one player picked before time ran out, the other forfeits; otherwise both stakes are returned. */
  expire(state) {
    const { host, opponent } = state.picks;
    if (host && !opponent) return finish(state, { winner: 'host', forfeit: 'opponent' }, 'Your opponent ran out of time.');
    if (opponent && !host) return finish(state, { winner: 'opponent', forfeit: 'host' }, 'Your opponent ran out of time.');
    return null;
  },
};

// ── Dice duel: first to two rounds; tied rolls are rerolled ────────────────

export const DUEL_DICE = Object.freeze({ roundsToWin: 2, maxRolls: 10 });

export const duelDice = {
  instant: true,
  start: () => ({ rolls: [], score: { host: 0, opponent: 0 } }),
  act(state, action, { rng }) {
    if (action !== 'play') return invalid(state, 'Roll the dice.');
    while (state.rolls.length < DUEL_DICE.maxRolls && Math.max(state.score.host, state.score.opponent) < DUEL_DICE.roundsToWin) {
      const [host, opponent] = [rollTwo(rng), rollTwo(rng)];
      const diff = total(host) - total(opponent);
      state.rolls.push({ host, opponent, result: Math.sign(diff) });
      if (diff > 0) state.score.host += 1;
      if (diff < 0) state.score.opponent += 1;
    }
    const winner = state.score.host >= DUEL_DICE.roundsToWin ? 'host' : state.score.opponent >= DUEL_DICE.roundsToWin ? 'opponent' : null;
    return finish(state, { winner }, winner ? null : `${DUEL_DICE.maxRolls} rolls without a winner: it's a draw.`);
  },
  expire: () => null,
};

// ── Coinflip duel: the challenger is heads ─────────────────────────────────

export const duelCoinflip = {
  instant: true,
  start: () => ({ side: null }),
  act(state, action, { rng }) {
    if (action !== 'play') return invalid(state, 'Flip the coin.');
    state.side = rng() < 0.5 ? 'heads' : 'tails';
    return finish(state, { winner: state.side === 'heads' ? 'host' : 'opponent' });
  },
  expire: () => null,
};
