import { fish, treasure } from './adventure.js';
import { blackjack, coinflip, dice, higherlower, roulette, scratchcard, slots } from './casino.js';
import { duelCoinflip, duelDice, duelRps, rps } from './duels.js';
import { guess, memory, pattern, quickmath, reaction, trivia, unscramble, wordguess } from './puzzles.js';

/** Session engines by game key (see engine.js for the protocol and catalogue.js for metadata). */
export const ENGINES = Object.freeze({
  coinflip,
  dice,
  slots,
  roulette,
  blackjack,
  higherlower,
  scratchcard,
  trivia,
  quickmath,
  guess,
  wordguess,
  memory,
  pattern,
  unscramble,
  reaction,
  fish,
  treasure,
  rps,
  'duel-dice': duelDice,
  'duel-coinflip': duelCoinflip,
  'duel-rps': duelRps,
});
