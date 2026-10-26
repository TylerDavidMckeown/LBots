import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catchWeights, fish, fishingLevel, gridDistance, LOOT, REEL, treasure } from '../src/services/games/adventure.js';
import {
  blackjack, coinflip, dice, handValue, higherlower, hlChance, hlMultiplierAfter, isNatural, roulette, rouletteWins,
  SCRATCH_SYMBOLS, scratchcard, scratchGrid, slotMultiplier, slots, total,
} from '../src/services/games/casino.js';
import { DASHBOARD, GAME_CATEGORIES, GAMES, timeLimitFor } from '../src/services/games/catalogue.js';
import { QUESTIONS, TRIVIA_CATEGORIES } from '../src/services/games/data/trivia.js';
import { SCRAMBLE_WORDS, WORDGUESS_WORDS } from '../src/services/games/data/words.js';
import { DUEL_DICE, duelDice, duelRps, RPS_MAX_ROUNDS, rps, rpsRound } from '../src/services/games/duels.js';
import { ENGINES } from '../src/services/games/index.js';
import {
  GUESS_LEVELS, guess, mathProblem, memory, pattern, PATTERN_GENERATORS, quickmath, REACTION, reaction, scramble, trivia, unscramble,
  wordguess, wordleMarks,
} from '../src/services/games/puzzles.js';
import {
  HIGHER_LOWER, ROULETTE_BETS, SCRATCH_PRICE, SCRATCH_PRIZES, SLOT_SYMBOLS, TREASURE,
} from '../src/services/games/tables.js';
import { secureRandom } from '../src/services/random.js';
import { seeded } from './helpers.js';

const T0 = Date.UTC(2026, 9, 23, 12);
const ctx = (overrides = {}) => ({ rng: seeded(1), now: T0, ...overrides });
const play = (engine, state, action, overrides) => engine.act(structuredClone(state), action, ctx(overrides));

test('the production random source returns well-spread values in [0, 1)', () => {
  const values = Array.from({ length: 2_000 }, () => secureRandom());
  assert.ok(values.every((v) => v >= 0 && v < 1));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(mean > 0.4 && mean < 0.6, `mean ${mean}`);
  assert.ok(new Set(values).size > 1_990);
  // Every engine must run on it, not just on seeded test sources.
  assert.equal(typeof play(coinflip, coinflip.start({ stake: 1 }), 'heads', { rng: secureRandom }).outcome.payout, 'number');
});

test('every engine has catalogue metadata and every listed game is reachable', () => {
  for (const key of Object.keys(ENGINES)) {
    assert.ok(GAMES[key], `${key} metadata`);
    assert.ok(['required', 'optional', 'fixed', 'none'].includes(GAMES[key].stake));
    for (const difficulty of ['easy', 'medium', 'hard']) assert.ok(timeLimitFor(key, { difficulty }) > 0);
  }
  for (const key of Object.keys(GAMES)) assert.ok(ENGINES[key], `${key} engine`);
  for (const entry of DASHBOARD) {
    assert.ok(GAME_CATEGORIES[entry.category], `${entry.key} category`);
    assert.ok(entry.rules && Array.isArray(entry.payouts));
  }
});

test('coinflip pays even money and is decided by the rng', () => {
  const state = coinflip.start({ stake: 500 });
  assert.equal(play(coinflip, state, 'heads', { rng: () => 0.1 }).outcome.payout, 1000);
  assert.equal(play(coinflip, state, 'heads', { rng: () => 0.9 }).outcome.payout, 0);
  assert.equal(play(coinflip, state, 'tails', { rng: () => 0.9 }).outcome.result, 'win');
  assert.ok(play(coinflip, state, 'edge').invalid);
});

test('dice against the bot: higher total wins, ties push', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const step = play(dice, dice.start({ stake: 100 }), 'roll', { rng: seeded(seed) });
    const [p, b] = [total(step.state.player), total(step.state.bot)];
    assert.equal(step.outcome.payout, p > b ? 200 : p === b ? 100 : 0);
  }
});

test('slots: the published table returns between 90% and 97% of stakes', () => {
  const totalWeight = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let expected = 0;
  for (const a of SLOT_SYMBOLS) {
    for (const b of SLOT_SYMBOLS) {
      for (const c of SLOT_SYMBOLS) {
        expected += ((a.weight * b.weight * c.weight) / totalWeight ** 3) * slotMultiplier([a.emoji, b.emoji, c.emoji]);
      }
    }
  }
  assert.ok(expected > 0.9 && expected < 0.97, `slots return ${expected}`);
  assert.equal(slotMultiplier(['7️⃣', '7️⃣', '7️⃣']), 50);
  assert.equal(slotMultiplier(['🍒', '⭐', '🍒']), 1.5);
  assert.equal(slotMultiplier(['🍒', '⭐', '💎']), 0);
  const step = play(slots, slots.start({ stake: 100 }), 'spin');
  assert.equal(step.outcome.payout, Math.floor(100 * slotMultiplier(step.state.reels)));
});

test('roulette: every bet returns exactly 36/37 of the stake on average', () => {
  for (const bet of Object.keys(ROULETTE_BETS)) {
    let returned = 0;
    for (let n = 0; n <= 36; n += 1) if (rouletteWins(bet, 17, n)) returned += ROULETTE_BETS[bet].multiplier;
    assert.equal(returned, 36, bet);
  }
  for (const bet of ['red', 'black', 'odd', 'even', 'low', 'high']) assert.equal(rouletteWins(bet, null, 0), false, `0 loses ${bet}`);
  const step = play(roulette, roulette.start({ stake: 10, options: { bet: 'number', number: 7 } }), 'spin', { rng: () => 7 / 37 + 0.0001 });
  assert.equal(step.state.result, 7);
  assert.equal(step.outcome.payout, 360);
});

test('blackjack hand values, naturals, dealer rules and doubling down', () => {
  assert.deepEqual(handValue(['A♠', 'K♥']), { total: 21, soft: true });
  assert.equal(handValue(['A♠', 'A♥', '9♦']).total, 21);
  assert.equal(handValue(['K♠', 'Q♥', '5♦']).total, 25);
  assert.ok(isNatural(['A♠', 'J♥']));
  assert.ok(!isNatural(['7♠', '7♥', '7♦']));

  // Cards are dealt from the end of the deck: player, dealer, player, dealer.
  const dealt = (cards, stake = 100) => ({ ...blackjack.start({ stake, rng: seeded(1) }), deck: [...cards].reverse() });
  const natural = play(blackjack, dealt(['A♠', '9♥', 'K♣', '7♦']), 'deal');
  assert.equal(natural.outcome.payout, 250);
  const both = play(blackjack, dealt(['A♠', 'A♥', 'K♣', 'Q♦']), 'deal');
  assert.equal(both.outcome.result, 'push');

  // Player 10+7 stands; dealer A+6 (soft 17) stands → push at 17.
  let state = play(blackjack, dealt(['10♠', 'A♥', '7♣', '6♦', '5♠']), 'deal').state;
  const stand = play(blackjack, state, 'stand');
  assert.equal(handValue(stand.state.dealer).total, 17);
  assert.equal(stand.state.dealer.length, 2);
  assert.equal(stand.outcome.result, 'push');

  // Double down: one card, stake doubled, the extra stake is requested.
  state = play(blackjack, dealt(['6♠', '10♥', '5♣', '7♦', '10♠', '9♣']), 'deal').state;
  const doubled = play(blackjack, state, 'double');
  assert.equal(doubled.hold, 100);
  assert.equal(doubled.state.stake, 200);
  assert.equal(doubled.state.player.length, 3);
  assert.equal(doubled.outcome.payout, 400, '21 beats the dealer 17 after 10+7');
  assert.ok(play(blackjack, play(blackjack, state, 'hit').state, 'double').invalid, 'cannot double after hitting');

  // Bust ends the hand; an abandoned hand stands.
  const bust = play(blackjack, dealt(['10♠', '9♥', '6♣', '8♦', 'K♠']), 'deal');
  assert.equal(play(blackjack, bust.state, 'hit').outcome.payout, 0);
  const expired = blackjack.expire(structuredClone(bust.state));
  assert.equal(expired.done, true);
  assert.equal(expired.outcome.result, 'loss', '16 stands against dealer 17');
});

test('higher or lower: honest multipliers, no impossible guesses, cash-out rules', () => {
  assert.equal(hlChance(50, 'higher'), 50 / 99);
  assert.equal(hlMultiplierAfter(1, 50, 'higher'), Math.floor((0.95 / (50 / 99)) * 100) / 100);
  assert.equal(hlMultiplierAfter(1, 99, 'higher'), HIGHER_LOWER.maxMultiplier);
  for (let seed = 1; seed <= 200; seed += 1) {
    const start = higherlower.start({ stake: 100, rng: seeded(seed) });
    const step = play(higherlower, start, start.current === HIGHER_LOWER.max ? 'lower' : 'higher', { rng: seeded(seed + 1000) });
    assert.notEqual(step.state.history[0].to, step.state.history[0].from, 'never the same number');
  }
  const top = { ...higherlower.start({ stake: 100, rng: seeded(1) }), current: 100 };
  assert.ok(play(higherlower, top, 'higher').invalid);
  assert.ok(play(higherlower, top, 'cashout').invalid, 'nothing to cash out yet');
  assert.equal(higherlower.expire(structuredClone(top)), null, 'no rounds won: stake refunded on expiry');

  // rng 0 draws the lowest remaining number, so "lower" from 2 is correct.
  const low = { ...higherlower.start({ stake: 100, rng: seeded(1) }), current: 2 };
  const won = play(higherlower, low, 'lower', { rng: () => 0 });
  assert.equal(won.state.streak, 1);
  const cash = play(higherlower, won.state, 'cashout');
  assert.equal(cash.outcome.payout, Math.floor(100 * won.state.multiplier));

  const freeGame = { ...higherlower.start({ stake: 0, rng: seeded(1) }), current: 2 };
  const freeWin = play(higherlower, freeGame, 'lower', { rng: () => 0 });
  const freeLoss = play(higherlower, { ...freeWin.state, current: 1 }, 'lower');
  assert.ok(freeLoss.invalid);
  const ended = play(higherlower, { ...freeWin.state, current: 99 }, 'higher', { rng: () => 0 });
  assert.equal(ended.outcome.payout, HIGHER_LOWER.freeCoinsPerRound, 'a free streak keeps what it won');
});

test('scratch cards: 84% return, grids that match the drawn prize', () => {
  const weights = SCRATCH_PRIZES.reduce((sum, p) => sum + p.weight, 0);
  const expected = SCRATCH_PRIZES.reduce((sum, p) => sum + (p.weight / weights) * p.prize, 0) / SCRATCH_PRICE;
  assert.ok(Math.abs(expected - 0.84) < 1e-9, `scratch return ${expected}`);
  for (let seed = 1; seed <= 200; seed += 1) {
    for (const symbol of [null, ...SCRATCH_SYMBOLS]) {
      const grid = scratchGrid(seeded(seed), symbol);
      const counts = SCRATCH_SYMBOLS.map((s) => grid.filter((c) => c === s).length);
      assert.equal(grid.length, 9);
      SCRATCH_SYMBOLS.forEach((s, i) => assert.equal(counts[i] === 3, s === symbol, `seed ${seed} ${symbol}`));
    }
  }
  const card = scratchcard.start({ stake: SCRATCH_PRICE, rng: seeded(4) });
  let state = card;
  for (let i = 0; i < 8; i += 1) state = play(scratchcard, state, `reveal:${i}`).state;
  assert.ok(play(scratchcard, state, 'reveal:0').invalid);
  const last = play(scratchcard, state, 'reveal:8');
  assert.equal(last.outcome.payout, card.prize);
  assert.equal(scratchcard.expire(structuredClone(card)).outcome.payout, card.prize, 'an abandoned card is still paid');
});

test('trivia: well-formed questions and fair scoring', () => {
  const ids = new Set();
  for (const question of QUESTIONS) {
    assert.ok(!ids.has(question.id), question.id);
    ids.add(question.id);
    assert.ok(TRIVIA_CATEGORIES[question.category], question.id);
    assert.ok(['easy', 'medium', 'hard'].includes(question.difficulty));
    assert.equal(new Set([question.answer, ...question.wrong]).size, 4, question.id);
  }
  for (const category of Object.keys(TRIVIA_CATEGORIES)) assert.ok(QUESTIONS.filter((x) => x.category === category).length >= 10, category);
  const state = trivia.start({ options: { questionId: 'mc-8' }, rng: seeded(2) });
  assert.equal(state.choices[state.answer], '10');
  assert.equal(play(trivia, state, `pick:${state.answer}`).outcome.payout, 100);
  assert.equal(play(trivia, state, `pick:${(state.answer + 1) % 4}`).outcome.result, 'loss');
  assert.ok(play(trivia, state, 'pick:9').invalid);
});

test('quick maths problems are correct and two tries are allowed', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const problem = mathProblem(difficulty, seeded(seed));
      // eslint-disable-next-line no-new-func
      assert.equal(Function(`return ${problem.text.replace(/×/g, '*').replace(/−/g, '-')}`)(), problem.answer, problem.text);
      assert.ok(problem.answer >= 0);
    }
  }
  const state = quickmath.start({ options: { difficulty: 'easy' }, rng: seeded(1), now: T0, timeLimitMs: 30_000 });
  assert.ok(play(quickmath, state, 'answer', { input: 'twelve' }).invalid);
  const wrong = play(quickmath, state, 'answer', { input: String(state.answer + 1) });
  assert.equal(wrong.done, undefined);
  const right = play(quickmath, wrong.state, 'answer', { input: ` ${state.answer} `, now: T0 });
  assert.equal(right.outcome.payout, 50, 'instant answers get the full reward');
  assert.equal(play(quickmath, wrong.state, 'answer', { input: '-1' }).outcome.result, 'loss');
});

test('guess the number: binary search always wins in the allowed attempts', () => {
  for (const [difficulty, level] of Object.entries(GUESS_LEVELS)) {
    for (let seed = 1; seed <= 50; seed += 1) {
      let state = guess.start({ options: { difficulty }, rng: seeded(seed) });
      let step;
      do {
        step = play(guess, state, 'answer', { input: String(Math.floor((state.low + state.high) / 2)) });
        state = step.state;
      } while (!step.done);
      assert.equal(step.outcome.result, 'win', `${difficulty} seed ${seed}`);
      assert.ok(state.guesses.length <= level.attempts);
    }
  }
  const state = guess.start({ options: { difficulty: 'easy' }, rng: seeded(1) });
  assert.ok(play(guess, state, 'answer', { input: '51' }).invalid);
  assert.ok(play(guess, play(guess, state, 'answer', { input: '25' }).state, 'answer', { input: '25' }).invalid);
});

test('word guess marks repeated letters correctly', () => {
  assert.deepEqual(wordleMarks('ALLEY', 'APPLE'), ['hit', 'near', 'miss', 'near', 'miss']);
  assert.deepEqual(wordleMarks('EERIE', 'THEME'), ['near', 'miss', 'miss', 'miss', 'hit']);
  assert.deepEqual(wordleMarks('SPOON', 'SPOON'), Array(5).fill('hit'));
  assert.ok(WORDGUESS_WORDS.every((w) => /^[a-z]{5}$/.test(w)));
  assert.equal(new Set(WORDGUESS_WORDS).size, WORDGUESS_WORDS.length);
  const state = wordguess.start({ rng: seeded(3) });
  assert.ok(play(wordguess, state, 'answer', { input: 'abc' }).invalid);
  assert.equal(play(wordguess, state, 'answer', { input: state.answer.toLowerCase() }).outcome.payout, 240);
});

test('memory match: perfect play earns the full reward, mismatches stay visible', () => {
  const state = memory.start({ options: { difficulty: 'medium' }, rng: seeded(5) });
  let current = state;
  const order = [...new Set(state.cards)].flatMap((symbol) => state.cards.map((c, i) => (c === symbol ? i : -1)).filter((i) => i >= 0));
  let step;
  for (const index of order) {
    step = play(memory, current, `flip:${index}`);
    current = step.state;
  }
  assert.equal(step.outcome.result, 'win');
  assert.equal(step.outcome.payout, 120);
  assert.equal(current.moves, 8);

  const a = 0;
  const b = state.cards.findIndex((c, i) => i > 0 && c !== state.cards[0]);
  const miss = play(memory, play(memory, state, `flip:${a}`).state, `flip:${b}`);
  assert.deepEqual(miss.state.shown, [a, b]);
  assert.ok(play(memory, miss.state, `flip:${a}`).state.shown.length === 0, 'the next flip hides them again');
});

test('pattern rounds always offer four distinct options including the answer', () => {
  for (const [name, generate] of Object.entries(PATTERN_GENERATORS)) {
    for (let seed = 1; seed <= 100; seed += 1) {
      const round = generate(seeded(seed), seed % 2 === 0);
      assert.equal(new Set(round.options).size, 4, `${name} ${seed}`);
      assert.ok(round.answer >= 0 && round.answer < 4);
    }
  }
  let state = pattern.start({ options: { difficulty: 'hard' }, rng: seeded(9) });
  let step;
  while (!step?.done) {
    step = play(pattern, state, `pick:${state.rounds[state.round].answer}`);
    state = step.state;
  }
  assert.equal(step.outcome.payout, (3 * 40 + 30) * 2);
});

test('unscramble: scrambles differ, hints cost 30%', () => {
  const all = Object.values(SCRAMBLE_WORDS).flat();
  assert.equal(new Set(all).size, all.length, 'no word appears twice');
  for (const word of all) {
    const mixed = scramble(word.toUpperCase(), seeded(word.length));
    assert.notEqual(mixed, word.toUpperCase());
    assert.equal([...mixed].sort().join(''), [...word.toUpperCase()].sort().join(''));
  }
  const state = unscramble.start({ options: { difficulty: 'easy' }, rng: seeded(1), now: T0, timeLimitMs: 45_000 });
  const hinted = play(unscramble, state, 'hint');
  assert.ok(play(unscramble, hinted.state, 'hint').invalid);
  assert.equal(play(unscramble, hinted.state, 'answer', { input: state.word }).outcome.payout, Math.round(50 * 0.7));
  assert.ok(play(unscramble, state, 'answer', { input: 'abc1' }).invalid);
});

test('reaction: early, wrong and slow presses lose; fast presses pay more', () => {
  const state = reaction.start({ now: T0, rng: seeded(1) });
  const target = state.order.indexOf(state.target);
  const wrong = state.order.findIndex((colour) => colour !== state.target);
  assert.match(play(reaction, state, `press:${target}`, { now: state.goAt - 1 }).feedback, /Too early/);
  assert.equal(play(reaction, state, `press:${wrong}`, { now: state.goAt + 100 }).outcome.result, 'loss');
  assert.equal(play(reaction, state, `press:${target}`, { now: state.goAt + REACTION.windowMs + 1 }).outcome.result, 'loss');
  const fast = play(reaction, state, `press:${target}`, { now: state.goAt + 200 }).outcome.payout;
  const slow = play(reaction, state, `press:${target}`, { now: state.goAt + 2_500 }).outcome.payout;
  assert.ok(fast > slow && slow >= 30 && fast <= 120);
});

test('fishing: timing and level shift the odds; repeated early reels end the trip', () => {
  const perfect = Object.fromEntries(catchWeights(1, 1).map((w) => [w.rarity, w.weight]));
  assert.equal(perfect.junk, 0);
  const slowWeights = Object.fromEntries(catchWeights(0, 1).map((w) => [w.rarity, w.weight]));
  const levelled = Object.fromEntries(catchWeights(0, 50).map((w) => [w.rarity, w.weight]));
  assert.ok(perfect.legendary > slowWeights.legendary && levelled.legendary > slowWeights.legendary);
  assert.equal(fishingLevel(0), 1);
  assert.equal(fishingLevel(20 * 9), 4);

  let state = fish.start({ options: { level: 1 }, rng: seeded(1), now: T0 });
  for (let i = 0; i < REEL.maxEarly; i += 1) state = play(fish, state, 'reel', { now: T0 }).state;
  assert.equal(play(fish, state, 'reel', { now: T0 }).outcome.result, 'loss');
  const caught = play(fish, fish.start({ options: { level: 1 }, rng: seeded(1), now: T0 }), 'reel', { now: T0 + REEL.maxWaitMs + 100 });
  assert.equal(caught.outcome.payout, caught.state.catch.value);
  assert.ok(caught.outcome.gameXp > 0);
});

test('treasure hunt: hints point at real treasure, traps end the hunt, loot is kept', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const state = treasure.start({ rng: seeded(seed) });
    assert.equal(state.cells.filter((c) => c === 'trap').length, TREASURE.traps);
    const empty = state.cells.findIndex((c) => c === null);
    const step = play(treasure, state, `dig:${empty}`);
    const loot = state.cells.map((c, i) => (c && c !== 'trap' ? i : -1)).filter((i) => i >= 0);
    assert.equal(step.state.dug[0].distance, Math.min(...loot.map((i) => gridDistance(empty, i, TREASURE.columns))));
  }
  const state = treasure.start({ rng: seeded(2) });
  const lootIndex = state.cells.findIndex((c) => c && c !== 'trap');
  const found = play(treasure, state, `dig:${lootIndex}`);
  const trap = play(treasure, found.state, `dig:${state.cells.indexOf('trap')}`);
  assert.equal(trap.outcome.payout, LOOT[state.cells[lootIndex]].value);
  assert.ok(play(treasure, found.state, `dig:${lootIndex}`).invalid);
  assert.equal(play(treasure, state, 'leave').outcome.result, 'loss', 'leaving empty-handed pays nothing');
});

test('rock paper scissors: rules, best of three, replays and secret duel picks', () => {
  assert.equal(rpsRound('rock', 'scissors'), 1);
  assert.equal(rpsRound('rock', 'paper'), -1);
  assert.equal(rpsRound('paper', 'paper'), 0);

  // Against the bot: rng 0 makes the bot pick rock.
  const solo = rps.start({ stake: 100, options: { mode: 'bo3' } });
  const round1 = play(rps, solo, 'pick:paper', { rng: () => 0 });
  assert.equal(round1.done, undefined);
  assert.equal(play(rps, round1.state, 'pick:paper', { rng: () => 0 }).outcome.payout, 200);
  let draw = rps.start({ stake: 100, options: {} });
  let step;
  for (let i = 0; i < RPS_MAX_ROUNDS; i += 1) {
    step = play(rps, draw, 'pick:rock', { rng: () => 0 });
    draw = step.state;
  }
  assert.equal(step.outcome.result, 'push');
  // Quitting before any round refunds; quitting after losing a round forfeits.
  assert.equal(rps.expire(structuredClone(solo)), null);
  const losing = play(rps, solo, 'pick:scissors', { rng: () => 0 });
  assert.equal(losing.state.score.opponent, 1);
  assert.equal(rps.expire(structuredClone(losing.state)).outcome.payout, 0);

  // Duel: the first pick is hidden until both have picked.
  const duel = duelRps.start({ options: { mode: 'single' } });
  const hostPicked = play(duelRps, duel, 'pick:rock', { actor: 'host' });
  assert.equal(hostPicked.done, undefined);
  assert.ok(play(duelRps, hostPicked.state, 'pick:paper', { actor: 'host' }).invalid, 'one pick per round');
  assert.deepEqual(play(duelRps, hostPicked.state, 'pick:paper', { actor: 'opponent' }).outcome, { winner: 'opponent' });
  assert.equal(duelRps.expire(structuredClone(hostPicked.state)).outcome.winner, 'host', 'the player who did not pick forfeits');
  assert.equal(duelRps.expire(structuredClone(duel)), null, 'nobody picked: refund');
});

test('dice duel: first to two rounds; endless ties are a draw', () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const step = play(duelDice, duelDice.start(), 'play', { rng: seeded(seed) });
    const { winner } = step.outcome;
    if (winner) assert.equal(step.state.score[winner], DUEL_DICE.roundsToWin);
    else assert.equal(step.state.rolls.length, DUEL_DICE.maxRolls);
  }
  const ties = play(duelDice, duelDice.start(), 'play', { rng: () => 0.5 });
  assert.equal(ties.outcome.winner, null);
  assert.equal(ties.state.rolls.length, DUEL_DICE.maxRolls);
});
