import { formatNumber } from '@lyss/shared/utils/text.js';
import { BATTLE } from '../pets/battle.js';
import {
  BLACKJACK, FREE_REWARDS, HIGHER_LOWER, ROULETTE_BETS, SCRATCH_PRICE, SCRATCH_PRIZES, SLOT_PAIR_MULTIPLIER, SLOT_SYMBOLS,
  SPIN_SEGMENTS, TREASURE,
} from './tables.js';

/**
 * Game metadata: rules, cooldowns, time limits and stake modes. The payout lines are
 * generated from tables.js, so the published odds always match what the code pays.
 *
 * stake: 'required' (a bet), 'optional' (bet or play free), 'fixed' (a price), 'none' (free).
 * timeLimitMs: a number, or one per difficulty.
 */

const SECOND = 1_000;
const MINUTE = 60_000;

/** How long a confirmation card stays valid (nothing is taken until it is confirmed). */
export const PENDING_MS = 5 * MINUTE;
/** How long a duel challenge waits for the opponent. */
export const CHALLENGE_MS = 2 * MINUTE;

export const DIFFICULTIES = Object.freeze({ easy: 'Easy', medium: 'Medium', hard: 'Hard' });

export const GAME_CATEGORIES = Object.freeze({
  casino: { label: 'Casino-style', emoji: '🎰', description: 'Virtual Lyss Coin games of chance with published payout tables.' },
  puzzle: { label: 'Puzzles', emoji: '🧩', description: 'Free brain teasers that pay coins and XP.' },
  reaction: { label: 'Reaction', emoji: '⚡', description: 'Timing games measured by the server clock.' },
  multiplayer: { label: 'Multiplayer', emoji: '⚔️', description: 'Play other members. Stakes are held until the game settles.' },
  pet: { label: 'Pet games', emoji: '🐾', description: 'Games for your pets.' },
  daily: { label: 'Daily', emoji: '📅', description: 'Once-a-day rewards.' },
});

const percent = (weight, totalWeight) => `${((weight / totalWeight) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const coins = (amount) => `${formatNumber(amount)} LC`;
const freeLine = (table) => Object.entries(table).map(([level, r]) => `${level[0].toUpperCase()}${level.slice(1)}: up to ${coins(r.coins)} + ${r.xp} XP`).join(' · ');

const slotTotal = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const scratchTotal = SCRATCH_PRIZES.reduce((sum, p) => sum + p.weight, 0);
const spinTotal = SPIN_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);

export const GAMES = Object.freeze({
  coinflip: {
    name: 'Coinflip', emoji: '🪙', category: 'casino', command: '/coinflip', stake: 'required', cooldownMs: 5 * SECOND, timeLimitMs: MINUTE,
    rules: 'Pick heads or tails, then the coin is flipped once.',
    payouts: ['Win (50%): your stake back plus the same again', 'Lose (50%): you lose your stake'],
    modes: ['Solo', 'Duel another member with `/duel game:Coinflip`'],
  },
  dice: {
    name: 'Dice', emoji: '🎲', category: 'casino', command: '/dice roll', stake: 'required', cooldownMs: 5 * SECOND, timeLimitMs: MINUTE,
    rules: 'You and the bot each roll two dice. The higher total wins.',
    payouts: ['Higher total: your stake back plus the same again', 'Same total: your stake is returned', 'Lower total: you lose your stake'],
    modes: ['Solo against the bot', 'Duel another member with `/dice duel`'],
  },
  slots: {
    name: 'Slots', emoji: '🎰', category: 'casino', command: '/slots', stake: 'required', cooldownMs: 5 * SECOND, timeLimitMs: MINUTE,
    rules: 'Three reels spin independently. Matching symbols pay a multiple of your stake.',
    payouts: [
      ...[...SLOT_SYMBOLS].reverse().map((s) => `${s.emoji}${s.emoji}${s.emoji} pays ×${s.triple} (each reel shows ${s.emoji} ${percent(s.weight, slotTotal)} of the time)`),
      `Any two matching symbols: ×${SLOT_PAIR_MULTIPLIER}`,
      'No match: you lose your stake',
    ],
    modes: ['Solo'],
  },
  roulette: {
    name: 'Roulette', emoji: '🎡', category: 'casino', command: '/roulette', stake: 'required', cooldownMs: 5 * SECOND, timeLimitMs: MINUTE,
    rules: 'A European wheel with numbers 0–36. Zero is green and loses every colour, odd/even and low/high bet.',
    payouts: Object.values(ROULETTE_BETS).map((bet) => `${bet.label}: ×${bet.multiplier}`),
    modes: ['Solo'],
  },
  blackjack: {
    name: 'Blackjack', emoji: '🃏', category: 'casino', command: '/blackjack', stake: 'required', cooldownMs: 10 * SECOND, timeLimitMs: 3 * MINUTE,
    rules: `One shuffled deck. Get closer to 21 than the dealer without going over. The dealer draws to ${BLACKJACK.dealerStandsOn} and stands on all ${BLACKJACK.dealerStandsOn}s. You can double down on your first two cards (double stake, one more card). No splits or insurance. An unfinished hand stands when time runs out.`,
    payouts: [`Win: ×${BLACKJACK.win}`, `Blackjack (ace + ten-value card): ×${BLACKJACK.natural}`, 'Push: stake returned', 'Bust or lower than the dealer: you lose your stake'],
    modes: ['Solo against the dealer'],
  },
  higherlower: {
    name: 'Higher or Lower', emoji: '🔢', category: 'casino', command: '/higherlower', stake: 'optional', cooldownMs: 10 * SECOND, timeLimitMs: 3 * MINUTE,
    rules: `A number from ${HIGHER_LOWER.min} to ${HIGHER_LOWER.max} is shown. Guess whether the next one is higher or lower. It is never the same number. Up to ${HIGHER_LOWER.maxRounds} rounds.`,
    payouts: [
      `With a stake: each correct guess multiplies it by ${HIGHER_LOWER.returnRate} ÷ the chance of that guess (shown on the buttons), up to ×${HIGHER_LOWER.maxMultiplier}. Cash out any time. A wrong guess loses the stake. Time running out cashes out.`,
      `Free play: ${coins(HIGHER_LOWER.freeCoinsPerRound)} and ${HIGHER_LOWER.freeXpPerRound} XP per correct guess, kept when the streak ends.`,
    ],
    modes: ['Staked streak with cash-out', 'Free streak'],
  },
  scratchcard: {
    name: 'Scratch Card', emoji: '🎟️', category: 'casino', command: '/scratchcard', stake: 'fixed', price: SCRATCH_PRICE, cooldownMs: 15 * SECOND, timeLimitMs: 3 * MINUTE,
    rules: `Each card costs ${coins(SCRATCH_PRICE)}. Scratch the nine squares; three matching symbols win that prize. The prize is decided when you buy the card.`,
    payouts: SCRATCH_PRIZES.map((p) => (p.symbol ? `${p.symbol}${p.symbol}${p.symbol}: ${coins(p.prize)} (${percent(p.weight, scratchTotal)})` : `No match: nothing (${percent(p.weight, scratchTotal)})`)),
    modes: ['Solo'],
  },
  trivia: {
    name: 'Trivia', emoji: '❓', category: 'puzzle', command: '/trivia', stake: 'none', cooldownMs: 20 * SECOND, timeLimitMs: 25 * SECOND,
    rules: 'Answer one multiple-choice question before the timer ends. You will not see the same question again until you have seen the rest.',
    payouts: [freeLine(FREE_REWARDS.trivia)],
    modes: ['Categories: general, gaming, Minecraft, technology, science, geography, entertainment'],
  },
  quickmath: {
    name: 'Quick Maths', emoji: '➗', category: 'puzzle', command: '/quickmath', stake: 'none', cooldownMs: 20 * SECOND,
    timeLimitMs: { easy: 30 * SECOND, medium: 35 * SECOND, hard: 45 * SECOND },
    rules: 'Solve the equation before the timer ends. You get two tries. Faster answers pay more.',
    payouts: [freeLine(FREE_REWARDS.quickmath)],
    modes: ['Easy, medium or hard'],
  },
  guess: {
    name: 'Guess the Number', emoji: '🎯', category: 'puzzle', command: '/guess', stake: 'none', cooldownMs: MINUTE, timeLimitMs: 3 * MINUTE,
    rules: 'Find the hidden number. After each guess you learn whether it is higher or lower. Easy: 1–50 in 6 · Medium: 1–100 in 7 · Hard: 1–1,000 in 10.',
    payouts: [`${freeLine(FREE_REWARDS.guess)}. Fewer guesses pay more.`],
    modes: ['Easy, medium or hard'],
  },
  wordguess: {
    name: 'Word Guess', emoji: '🔤', category: 'puzzle', command: '/wordguess', stake: 'none', cooldownMs: 3 * MINUTE, timeLimitMs: 5 * MINUTE,
    rules: 'Find the five-letter word in six guesses. 🟩 right letter, right place · 🟨 in the word, wrong place · ⬛ not in the word.',
    payouts: [`${coins(FREE_REWARDS.wordguess.base + FREE_REWARDS.wordguess.perSpareGuess * 6)} for a first-guess win, ${coins(FREE_REWARDS.wordguess.perSpareGuess)} less for each extra guess, + ${FREE_REWARDS.wordguess.xp} XP`],
    modes: ['Solo'],
  },
  memory: {
    name: 'Memory Match', emoji: '🧠', category: 'puzzle', command: '/memory', stake: 'none', cooldownMs: 2 * MINUTE, timeLimitMs: 3 * MINUTE,
    rules: 'Flip two cards at a time to find matching pairs, within a limited number of moves. Easy: 6 pairs in 12 moves · Medium: 8 in 16 · Hard: 10 in 18.',
    payouts: [`${freeLine(FREE_REWARDS.memory)}. Pay depends on pairs found and moves left; you need at least half the pairs.`],
    modes: ['Easy, medium or hard'],
  },
  pattern: {
    name: 'Pattern Challenge', emoji: '🔷', category: 'puzzle', command: '/pattern', stake: 'none', cooldownMs: 30 * SECOND, timeLimitMs: 90 * SECOND,
    rules: 'Three rounds: find the missing or next item in each sequence of numbers or symbols.',
    payouts: [`${coins(FREE_REWARDS.pattern.perCorrect)} per correct answer plus ${coins(FREE_REWARDS.pattern.perfectBonus)} for a perfect round, ×1.5 on medium and ×2 on hard. You need at least 2 of 3.`],
    modes: ['Easy, medium or hard'],
  },
  unscramble: {
    name: 'Unscramble', emoji: '🔀', category: 'puzzle', command: '/unscramble', stake: 'none', cooldownMs: 30 * SECOND,
    timeLimitMs: { easy: 45 * SECOND, medium: 60 * SECOND, hard: 75 * SECOND },
    rules: 'Rebuild the scrambled word. Three tries. A hint shows the first and last letters but lowers the reward by 30%.',
    payouts: [`${freeLine(FREE_REWARDS.unscramble)}. Faster answers pay more.`],
    modes: ['Easy, medium or hard'],
  },
  reaction: {
    name: 'Reaction Challenge', emoji: '⚡', category: 'reaction', command: '/reaction', stake: 'none', cooldownMs: 30 * SECOND, timeLimitMs: 15 * SECOND,
    rules: 'Wait for the signal, then press the colour it names. Clicking early or on the wrong colour ends the game. Times use the server clock, so connection speed counts too.',
    payouts: [`${coins(FREE_REWARDS.reaction.min)}–${coins(FREE_REWARDS.reaction.max)} depending on speed (within 3 seconds) + ${FREE_REWARDS.reaction.xp} XP`],
    modes: ['Solo'],
  },
  fish: {
    name: 'Fishing', emoji: '🎣', category: 'reaction', command: '/fish', stake: 'none', cooldownMs: 2 * MINUTE, timeLimitMs: MINUTE,
    rules: 'Cast, wait for a bite, then reel in quickly. Better timing and a higher fishing level make rare fish more likely. Reeling early three times scares the fish away.',
    payouts: ['Catches sell for 5–1,000 LC depending on rarity, and give fishing XP'],
    modes: ['Solo, with its own fishing level'],
  },
  treasure: {
    name: 'Treasure Hunt', emoji: '🗺️', category: 'reaction', command: '/treasure', stake: 'none', cooldownMs: 10 * MINUTE, timeLimitMs: 3 * MINUTE,
    rules: `Dig up to ${TREASURE.digs} times on a ${TREASURE.columns}×${TREASURE.size / TREASURE.columns} map. Empty holes tell you how far the nearest treasure is. ${TREASURE.traps} traps end the hunt, but you keep what you found.`,
    payouts: [...TREASURE.loot.map((l) => `${l.emoji} ${l.name} ×${l.count}: ${coins(l.value)} each`), `${TREASURE.rare.emoji} Rare ${TREASURE.rare.name} (${TREASURE.rare.chance * 100}%): ${coins(TREASURE.rare.value)}`],
    modes: ['Solo'],
  },
  rps: {
    name: 'Rock, Paper, Scissors', emoji: '✂️', category: 'multiplayer', command: '/rps', stake: 'optional', cooldownMs: 5 * SECOND, timeLimitMs: 2 * MINUTE,
    rules: 'Rock beats scissors, scissors beats paper, paper beats rock. Drawn rounds are replayed; after 9 rounds without a winner the match is a draw.',
    payouts: ['With a stake: win ×2, draw returns the stake', `Free: ${coins(FREE_REWARDS.rps.coins)} + ${FREE_REWARDS.rps.xp} XP for a win`],
    modes: ['Against the bot', 'Against a member with `/rps opponent:`', 'Single round or best of three'],
  },
  'duel-dice': {
    name: 'Dice duel', emoji: '🎲', category: 'multiplayer', kind: 'duel', listed: false, stake: 'optional', cooldownKey: 'duel', cooldownMs: 15 * SECOND, timeLimitMs: MINUTE,
    rules: 'Each round, both players roll two dice and the higher total takes the round. Tied rolls are rolled again. First to 2 rounds wins. After 10 rolls without a winner, the duel is a draw and both stakes are returned.',
  },
  'duel-coinflip': {
    name: 'Coinflip duel', emoji: '🪙', category: 'multiplayer', kind: 'duel', listed: false, stake: 'optional', cooldownKey: 'duel', cooldownMs: 15 * SECOND, timeLimitMs: MINUTE,
    rules: 'The challenger is heads and the opponent is tails. One flip decides it.',
  },
  'duel-rps': {
    name: 'Rock, Paper, Scissors duel', emoji: '✂️', category: 'multiplayer', kind: 'duel', listed: false, stake: 'optional', cooldownKey: 'duel', cooldownMs: 15 * SECOND, timeLimitMs: 2 * MINUTE,
    rules: 'Both players pick in secret. Drawn rounds are replayed; after 9 rounds without a winner the duel is a draw and both stakes are returned. If time runs out after only one player picked, the other forfeits; if neither picked, both stakes are returned.',
  },
});

/** Dashboard entries without their own session engine. */
export const LISTINGS = Object.freeze({
  duels: {
    name: 'Duels', emoji: '⚔️', category: 'multiplayer', command: '/duel · /dice duel · /rps opponent:', stake: 'optional', cooldownMs: 15 * SECOND,
    rules: 'Challenge a member to dice, coinflip or rock-paper-scissors. Your stake is held when you challenge; theirs when they accept. Declined or unanswered challenges (2 minutes) return your stake, and so does either player leaving the server. After a duel, either player can offer a rematch with the same stake.',
    payouts: ['The winner receives both stakes', 'A draw returns both stakes', `The winner also gets ${FREE_REWARDS.duelWinnerXp} XP`],
    modes: ['Dice (first to 2 rounds)', 'Coinflip', 'Rock, paper, scissors (single or best of three)'],
  },
  dailyspin: {
    name: 'Daily Spin', emoji: '🎡', category: 'daily', command: '/dailyspin', stake: 'none', cooldownText: 'Once per day (server timezone)',
    rules: 'Spin the wheel once a day for a free reward. The day resets at midnight in the server timezone.',
    payouts: SPIN_SEGMENTS.map((s) => `${s.emoji} ${s.label} (${percent(s.weight, spinTotal)})`),
    modes: ['Daily'],
  },
  petbattle: {
    name: 'Pet Battle', emoji: '🐾', category: 'pet', command: '/pet battle', stake: 'none', cooldownMs: BATTLE.cooldownMs,
    rules: `Challenge a member's pet to a turn-based battle. Each turn, attack, guard (blocks half the next hit and heals a little) or use an ability your pet has unlocked. The faster pet moves first. Each pet uses ${BATTLE.energy} energy. If a player does not move within ${BATTLE.turnMs / 1_000} seconds, they forfeit. After ${BATTLE.maxTurns} turns, the pet with more health left wins.`,
    payouts: [
      `Win: ${BATTLE.xp.win} pet XP · Loss: ${BATTLE.xp.loss} pet XP · Draw: ${BATTLE.xp.draw} pet XP`,
      `Rewards count for your first ${BATTLE.rewardLimit} battles in any 24 hours`,
      'No coins are staked',
    ],
    modes: ['Player against player'],
  },
});

export const DASHBOARD = Object.freeze([
  ...Object.entries(GAMES).filter(([, game]) => game.listed !== false),
  ...Object.entries(LISTINGS),
].map(([key, game]) => ({ key, ...game })));

export const isDuelGame = (game) => GAMES[game]?.kind === 'duel';
export const cooldownKey = (game) => `game:${GAMES[game].cooldownKey ?? game}`;
export const timeLimitFor = (game, options = {}) => {
  const limit = GAMES[game].timeLimitMs;
  return typeof limit === 'number' ? limit : limit[options.difficulty ?? 'easy'];
};
/** Free games pay rewards (subject to the daily cap) instead of settling a stake. */
export const isFreePlay = (game, stake) => GAMES[game].stake === 'none' || (GAMES[game].stake === 'optional' && stake === 0);
