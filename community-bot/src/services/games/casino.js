import { randomInt, sample, shuffled, weighted } from '../random.js';
import { finish, indexFrom, invalid, next, staked } from './engine.js';
import {
  BLACKJACK, HIGHER_LOWER, ROULETTE_BETS, ROULETTE_RED, SCRATCH_PRIZES, SLOT_PAIR_MULTIPLIER, SLOT_SYMBOLS,
} from './tables.js';

/** Casino-style games. Every outcome is drawn from the injected rng and paid from tables.js. */

// ── Coinflip ───────────────────────────────────────────────────────────────

export const coinflip = {
  start: ({ stake }) => ({ stake, choice: null, side: null }),
  act(state, action, { rng }) {
    if (action !== 'heads' && action !== 'tails') return invalid(state, 'Pick heads or tails.');
    state.choice = action;
    state.side = rng() < 0.5 ? 'heads' : 'tails';
    return finish(state, staked(state.stake, state.side === action ? state.stake * 2 : 0));
  },
  expire: () => null,
};

// ── Dice against the bot ───────────────────────────────────────────────────

export const rollTwo = (rng) => [randomInt(rng, 1, 6), randomInt(rng, 1, 6)];
export const total = (dice) => dice.reduce((sum, die) => sum + die, 0);

export const dice = {
  start: ({ stake }) => ({ stake, player: null, bot: null }),
  act(state, action, { rng }) {
    if (action !== 'roll') return invalid(state, 'Roll the dice.');
    state.player = rollTwo(rng);
    state.bot = rollTwo(rng);
    const [player, bot] = [total(state.player), total(state.bot)];
    return finish(state, staked(state.stake, player > bot ? state.stake * 2 : player === bot ? state.stake : 0));
  },
  expire: () => null,
};

// ── Slots ──────────────────────────────────────────────────────────────────

export function slotMultiplier(reels) {
  const counts = new Map();
  for (const symbol of reels) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  const [symbol, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (count === 3) return SLOT_SYMBOLS.find((s) => s.emoji === symbol).triple;
  return count === 2 ? SLOT_PAIR_MULTIPLIER : 0;
}

export const slots = {
  start: ({ stake }) => ({ stake, reels: null, multiplier: 0 }),
  act(state, action, { rng }) {
    if (action !== 'spin') return invalid(state, 'Pull the lever.');
    state.reels = [0, 1, 2].map(() => weighted(rng, SLOT_SYMBOLS).emoji);
    state.multiplier = slotMultiplier(state.reels);
    return finish(state, staked(state.stake, Math.floor(state.stake * state.multiplier)));
  },
  expire: () => null,
};

// ── Roulette ───────────────────────────────────────────────────────────────

export const rouletteColour = (n) => (n === 0 ? 'green' : ROULETTE_RED.has(n) ? 'red' : 'black');

export function rouletteWins(bet, number, n) {
  switch (bet) {
    case 'red': return ROULETTE_RED.has(n);
    case 'black': return n > 0 && !ROULETTE_RED.has(n);
    case 'odd': return n > 0 && n % 2 === 1;
    case 'even': return n > 0 && n % 2 === 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'number': return n === number;
    default: return false;
  }
}

export const roulette = {
  start: ({ stake, options }) => ({ stake, bet: options.bet, number: options.number ?? null, result: null }),
  act(state, action, { rng }) {
    if (action !== 'spin') return invalid(state, 'Spin the wheel.');
    state.result = randomInt(rng, 0, 36);
    const won = rouletteWins(state.bet, state.number, state.result);
    return finish(state, staked(state.stake, won ? state.stake * ROULETTE_BETS[state.bet].multiplier : 0));
  },
  expire: () => null,
};

// ── Blackjack: one deck, dealer stands on all 17s, 3:2 blackjack, double on two cards ──

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export const newDeck = (rng) => shuffled(rng, SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`)));

export function handValue(cards) {
  let sum = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = card.slice(0, -1);
    if (rank === 'A') {
      sum += 11;
      aces += 1;
    } else {
      sum += ['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank);
    }
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces -= 1;
  }
  return { total: sum, soft: aces > 0 };
}

export const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

function showdown(state, feedback = null) {
  state.phase = 'done';
  const player = handValue(state.player).total;
  if (player > 21) return finish(state, staked(state.stake, 0), feedback ?? 'Bust!');
  while (handValue(state.dealer).total < BLACKJACK.dealerStandsOn) state.dealer.push(state.deck.pop());
  const dealer = handValue(state.dealer).total;
  const payout = dealer > 21 || player > dealer ? state.stake * BLACKJACK.win : player === dealer ? state.stake : 0;
  const text = dealer > 21 ? 'The dealer busts!' : player > dealer ? 'You beat the dealer!' : player === dealer ? 'Push.' : 'The dealer wins.';
  return finish(state, staked(state.stake, payout), feedback ?? text);
}

export const blackjack = {
  start: ({ stake, rng }) => ({ stake, baseStake: stake, deck: newDeck(rng), player: [], dealer: [], doubled: false, phase: 'ready' }),
  act(state, action) {
    if (state.phase === 'ready') {
      if (action !== 'deal') return invalid(state, 'Deal the cards first.');
      for (let i = 0; i < 2; i += 1) {
        state.player.push(state.deck.pop());
        state.dealer.push(state.deck.pop());
      }
      state.phase = 'player';
      const [player, dealer] = [isNatural(state.player), isNatural(state.dealer)];
      if (!player && !dealer) return next(state);
      state.phase = 'done';
      const payout = player && dealer ? state.stake : player ? Math.floor(state.stake * BLACKJACK.natural) : 0;
      return finish(state, staked(state.stake, payout), player && dealer ? 'You both have blackjack.' : player ? 'Blackjack!' : 'The dealer has blackjack.');
    }
    if (state.phase !== 'player') return invalid(state, 'This hand is finished.');
    if (action === 'hit') {
      state.player.push(state.deck.pop());
      const value = handValue(state.player).total;
      if (value > 21) return showdown(state, 'Bust!');
      return value === 21 ? showdown(state) : next(state);
    }
    if (action === 'stand') return showdown(state);
    if (action === 'double') {
      if (state.player.length !== 2 || state.doubled) return invalid(state, 'You can only double down on your first two cards.');
      state.doubled = true;
      state.stake += state.baseStake;
      state.player.push(state.deck.pop());
      return { ...showdown(state, handValue(state.player).total > 21 ? 'Bust!' : null), hold: state.baseStake };
    }
    return invalid(state, 'Hit, stand or double down.');
  },
  /** An abandoned hand stands, so it still gets a fair result. */
  expire: (state) => (state.phase === 'player' ? showdown(state, 'Time ran out, so your hand stood.') : null),
};

// ── Higher or Lower ────────────────────────────────────────────────────────

const HL = HIGHER_LOWER;
export const hlChance = (current, direction) => (direction === 'higher' ? HL.max - current : current - HL.min) / (HL.max - HL.min);

/** The multiplier after a correct guess: returnRate ÷ chance, rounded down to 2 decimals. */
export function hlMultiplierAfter(multiplier, current, direction) {
  const chance = hlChance(current, direction);
  if (chance <= 0) return 0;
  return Math.min(HL.maxMultiplier, Math.floor(((multiplier * HL.returnRate) / chance) * 100) / 100);
}

function hlCashout(state, feedback) {
  if (state.free) {
    return finish(state, { result: state.streak > 0 ? 'win' : 'loss', payout: state.streak * HL.freeCoinsPerRound, xp: state.streak * HL.freeXpPerRound }, feedback);
  }
  return finish(state, staked(state.stake, Math.floor(state.stake * state.multiplier)), feedback);
}

export const higherlower = {
  start: ({ stake, rng }) => ({ stake, free: stake === 0, current: randomInt(rng, HL.min, HL.max), multiplier: 1, streak: 0, history: [] }),
  act(state, action, { rng }) {
    if (action === 'cashout') {
      if (state.free || state.streak === 0) return invalid(state, 'Win at least one round before cashing out.');
      return hlCashout(state, `Cashed out at ×${state.multiplier}.`);
    }
    if (action !== 'higher' && action !== 'lower') return invalid(state, 'Guess higher or lower.');
    if (hlChance(state.current, action) === 0) return invalid(state, `No number is ${action} than ${state.current}.`);
    // Draw from every number except the current one.
    const roll = randomInt(rng, HL.min, HL.max - 1);
    const drawn = roll >= state.current ? roll + 1 : roll;
    const correct = action === 'higher' ? drawn > state.current : drawn < state.current;
    state.history.push({ from: state.current, to: drawn, guess: action, correct });
    if (!correct) {
      state.current = drawn;
      if (state.free) return hlCashout(state, `It was **${drawn}**. Your streak ends at ${state.streak}.`);
      return finish(state, staked(state.stake, 0), `It was **${drawn}**. You lose your stake.`);
    }
    if (!state.free) state.multiplier = hlMultiplierAfter(state.multiplier, state.current, action);
    state.current = drawn;
    state.streak += 1;
    if (state.streak >= HL.maxRounds || state.multiplier >= HL.maxMultiplier) return hlCashout(state, `✅ It was **${drawn}**. That's the maximum, so you cash out!`);
    return next(state, `✅ It was **${drawn}**.`);
  },
  /** Time running out banks whatever has been won; with nothing won, the stake is refunded. */
  expire: (state) => (state.free || state.streak > 0 ? hlCashout(state, 'Time ran out, so your winnings were cashed out.') : null),
};

// ── Scratch cards: the prize is drawn when the card is bought ──────────────

export const SCRATCH_SYMBOLS = SCRATCH_PRIZES.filter((p) => p.symbol).map((p) => p.symbol);

/** A 3×3 grid with exactly three of the winning symbol, or no symbol three times. */
export function scratchGrid(rng, symbol) {
  const others = SCRATCH_SYMBOLS.filter((s) => s !== symbol);
  const cells = symbol
    ? [symbol, symbol, symbol, ...sample(rng, [...others, ...others], 6)]
    : sample(rng, [...SCRATCH_SYMBOLS, ...SCRATCH_SYMBOLS], 9);
  return shuffled(rng, cells);
}

function scratchResult(state) {
  return finish(state, staked(state.stake, state.prize), state.prize ? `Three ${state.symbol}!` : 'No match this time.');
}

export const scratchcard = {
  start({ stake, rng }) {
    const { prize, symbol } = weighted(rng, SCRATCH_PRIZES);
    return { stake, prize, symbol, grid: scratchGrid(rng, symbol), revealed: [] };
  },
  act(state, action) {
    if (action === 'all') {
      state.revealed = state.grid.map((_, i) => i);
    } else {
      const index = indexFrom(action, 'reveal', state.grid.length);
      if (index === null || state.revealed.includes(index)) return invalid(state, 'Scratch a hidden square.');
      state.revealed.push(index);
    }
    return state.revealed.length < state.grid.length ? next(state) : scratchResult(state);
  },
  /** The card was paid for and its prize already drawn, so it is revealed and paid. */
  expire(state) {
    state.revealed = state.grid.map((_, i) => i);
    return scratchResult(state);
  },
};
