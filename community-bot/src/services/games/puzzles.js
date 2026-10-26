import { clamp, pick, randomInt, sample, shuffled } from '../random.js';
import { QUESTIONS_BY_ID } from './data/trivia.js';
import { SCRAMBLE_WORDS, WORDGUESS_WORDS } from './data/words.js';
import { finish, free, indexFrom, invalid, next, wholeNumber } from './engine.js';
import { FREE_REWARDS } from './tables.js';

/** Free puzzle and reaction games. They pay coins and XP from tables.js on success. */

const speedOf = (state, now) => clamp(1 - (now - state.startedAt) / (state.endsAt - state.startedAt));
const lose = (feedback) => (state) => finish(state, free(false), typeof feedback === 'function' ? feedback(state) : feedback);

// ── Trivia ─────────────────────────────────────────────────────────────────

export const trivia = {
  start({ options, rng }) {
    const question = QUESTIONS_BY_ID[options.questionId];
    const choices = shuffled(rng, [question.answer, ...question.wrong]);
    return {
      questionId: question.id, category: question.category, difficulty: question.difficulty, question: question.question,
      choices, answer: choices.indexOf(question.answer), picked: null,
    };
  },
  act(state, action) {
    const index = indexFrom(action, 'pick', state.choices.length);
    if (index === null) return invalid(state, 'That is not an option.');
    state.picked = index;
    const reward = FREE_REWARDS.trivia[state.difficulty];
    const right = index === state.answer;
    return finish(state, free(right, reward.coins, right ? reward.xp : 0), right ? '✅ Correct!' : `❌ The answer was **${state.choices[state.answer]}**.`);
  },
  expire: lose((state) => `⏰ Time is up! The answer was **${state.choices[state.answer]}**.`),
};

// ── Quick Maths ────────────────────────────────────────────────────────────

export function mathProblem(difficulty, rng) {
  if (difficulty === 'easy') {
    const [a, b] = [randomInt(rng, 5, 60), randomInt(rng, 2, 40)];
    return rng() < 0.5 ? { text: `${a} + ${b}`, answer: a + b } : { text: `${Math.max(a, b)} − ${Math.min(a, b)}`, answer: Math.abs(a - b) };
  }
  if (difficulty === 'medium') {
    if (rng() < 0.5) {
      const [a, b] = [randomInt(rng, 3, 12), randomInt(rng, 3, 12)];
      return { text: `${a} × ${b}`, answer: a * b };
    }
    const [a, b] = [randomInt(rng, 15, 80), randomInt(rng, 10, 60)];
    const c = randomInt(rng, 5, a + b - 1);
    return { text: `${a} + ${b} − ${c}`, answer: a + b - c };
  }
  const kind = randomInt(rng, 0, 2);
  if (kind === 0) {
    const [a, b, c] = [randomInt(rng, 6, 15), randomInt(rng, 3, 12), randomInt(rng, 10, 99)];
    return { text: `${a} × ${b} + ${c}`, answer: a * b + c };
  }
  if (kind === 1) {
    const [a, b, c] = [randomInt(rng, 5, 30), randomInt(rng, 5, 30), randomInt(rng, 3, 9)];
    return { text: `(${a} + ${b}) × ${c}`, answer: (a + b) * c };
  }
  const [a, b] = [randomInt(rng, 6, 15), randomInt(rng, 6, 15)];
  const c = randomInt(rng, 5, a * b - 1);
  return { text: `${a} × ${b} − ${c}`, answer: a * b - c };
}

export const quickmath = {
  start: ({ options, rng, now, timeLimitMs }) => ({
    difficulty: options.difficulty, ...mathProblem(options.difficulty, rng), attemptsLeft: 2, tries: [], startedAt: now, endsAt: now + timeLimitMs,
  }),
  act(state, action, { input, now }) {
    if (action !== 'answer') return invalid(state, 'Use the Answer button.');
    const value = wholeNumber(input);
    if (value === null) return invalid(state, 'Enter a whole number, such as `42`.');
    state.tries.push(value);
    if (value === state.answer) {
      const reward = FREE_REWARDS.quickmath[state.difficulty];
      return finish(state, free(true, Math.round(reward.coins * (0.6 + 0.4 * speedOf(state, now))), reward.xp), `✅ ${state.text} = **${state.answer}**`);
    }
    state.attemptsLeft -= 1;
    if (state.attemptsLeft === 0) return finish(state, free(false), `❌ Not quite. ${state.text} = **${state.answer}**`);
    return next(state, `❌ **${value}** is not right. One more try.`);
  },
  expire: lose((state) => `⏰ Time is up! ${state.text} = **${state.answer}**`),
};

// ── Guess the Number ───────────────────────────────────────────────────────

export const GUESS_LEVELS = Object.freeze({
  easy: { max: 50, attempts: 6 },
  medium: { max: 100, attempts: 7 },
  hard: { max: 1_000, attempts: 10 },
});

export const guess = {
  start({ options, rng }) {
    const level = GUESS_LEVELS[options.difficulty];
    return { difficulty: options.difficulty, max: level.max, attempts: level.attempts, target: randomInt(rng, 1, level.max), guesses: [], low: 1, high: level.max };
  },
  act(state, action, { input }) {
    if (action !== 'answer') return invalid(state, 'Use the Guess button.');
    const value = wholeNumber(input);
    if (value === null || value < 1 || value > state.max) return invalid(state, `Enter a whole number from 1 to ${state.max}.`);
    if (state.guesses.includes(value)) return invalid(state, `You already guessed ${value}.`);
    state.guesses.push(value);
    if (value === state.target) {
      const reward = FREE_REWARDS.guess[state.difficulty];
      const spare = (state.attempts - state.guesses.length) / (state.attempts - 1);
      return finish(state, free(true, Math.round(reward.coins * (0.5 + 0.5 * spare)), reward.xp), `🎯 **${value}** is right! Found in ${state.guesses.length}.`);
    }
    if (value < state.target) state.low = Math.max(state.low, value + 1);
    else state.high = Math.min(state.high, value - 1);
    if (state.guesses.length >= state.attempts) return finish(state, free(false), `Out of guesses. The number was **${state.target}**.`);
    return next(state, value < state.target ? `⬆️ Higher than **${value}**.` : `⬇️ Lower than **${value}**.`);
  },
  expire: lose((state) => `⏰ Time is up! The number was **${state.target}**.`),
};

// ── Word Guess (five letters, six tries) ───────────────────────────────────

export const WORDGUESS_TRIES = 6;

/** Per-letter marks with correct handling of repeated letters. */
export function wordleMarks(guessWord, answer) {
  const marks = Array(guessWord.length).fill('miss');
  const remaining = new Map();
  for (let i = 0; i < guessWord.length; i += 1) {
    if (guessWord[i] === answer[i]) marks[i] = 'hit';
    else remaining.set(answer[i], (remaining.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guessWord.length; i += 1) {
    if (marks[i] !== 'hit' && remaining.get(guessWord[i]) > 0) {
      marks[i] = 'near';
      remaining.set(guessWord[i], remaining.get(guessWord[i]) - 1);
    }
  }
  return marks;
}

export const wordguess = {
  start: ({ rng }) => ({ answer: pick(rng, WORDGUESS_WORDS).toUpperCase(), guesses: [] }),
  act(state, action, { input }) {
    if (action !== 'answer') return invalid(state, 'Use the Guess button.');
    const word = String(input ?? '').trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(word)) return invalid(state, 'Guesses must be exactly 5 letters.');
    if (state.guesses.some((g) => g.word === word)) return invalid(state, `You already tried ${word}.`);
    state.guesses.push({ word, marks: wordleMarks(word, state.answer) });
    const used = state.guesses.length;
    if (word === state.answer) {
      const reward = FREE_REWARDS.wordguess;
      return finish(state, free(true, reward.base + reward.perSpareGuess * (WORDGUESS_TRIES + 1 - used), reward.xp), `🎉 Solved in ${used}!`);
    }
    if (used >= WORDGUESS_TRIES) return finish(state, free(false), `The word was **${state.answer}**.`);
    return next(state);
  },
  expire: lose((state) => `⏰ Time is up! The word was **${state.answer}**.`),
};

// ── Memory Match ───────────────────────────────────────────────────────────

export const MEMORY_LEVELS = Object.freeze({
  easy: { pairs: 6, columns: 4, maxMoves: 12 },
  medium: { pairs: 8, columns: 4, maxMoves: 16 },
  hard: { pairs: 10, columns: 5, maxMoves: 18 },
});
const MEMORY_SYMBOLS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🥝', '🍍', '🥥', '🍑', '🍋', '🫐', '🍉'];

function memoryResult(state, feedback) {
  const found = state.matched.length / 2;
  const spare = clamp((state.maxMoves - state.moves) / (state.maxMoves - state.pairs));
  const reward = FREE_REWARDS.memory[state.difficulty];
  const won = found >= Math.ceil(state.pairs / 2);
  return finish(state, free(won, Math.round(reward.coins * (found / state.pairs) * (0.6 + 0.4 * spare)), won ? reward.xp : 0), feedback);
}

export const memory = {
  start({ options, rng }) {
    const level = MEMORY_LEVELS[options.difficulty];
    const symbols = sample(rng, MEMORY_SYMBOLS, level.pairs);
    return { difficulty: options.difficulty, ...level, cards: shuffled(rng, [...symbols, ...symbols]), matched: [], first: null, shown: [], moves: 0 };
  },
  act(state, action) {
    const index = indexFrom(action, 'flip', state.cards.length);
    if (index === null || state.matched.includes(index) || index === state.first) return invalid(state, 'Pick a hidden card.');
    state.shown = [];
    if (state.first === null) {
      state.first = index;
      return next(state);
    }
    const first = state.first;
    state.first = null;
    state.moves += 1;
    let feedback;
    if (state.cards[first] === state.cards[index]) {
      state.matched.push(first, index);
      feedback = `✅ Match: ${state.cards[index]}`;
    } else {
      state.shown = [first, index];
      feedback = '❌ No match.';
    }
    if (state.matched.length === state.cards.length) return memoryResult(state, `🎉 All pairs found in ${state.moves} moves!`);
    if (state.moves >= state.maxMoves) return memoryResult(state, `${feedback} Out of moves.`);
    return next(state, feedback);
  },
  expire: (state) => memoryResult(state, '⏰ Time is up.'),
};

// ── Pattern Challenge ──────────────────────────────────────────────────────

const PATTERN_SYMBOLS = ['◆', '◇', '●', '○', '▲', '△', '■', '□', '★', '☆'];
export const PATTERN_ROUNDS = 3;

function numberChoices(rng, answer, deltas) {
  const values = new Set([answer]);
  for (const delta of shuffled(rng, deltas)) {
    if (values.size === 4) break;
    if (answer + delta >= 0) values.add(answer + delta);
  }
  for (let k = 3; values.size < 4; k += 1) values.add(answer + k * 7);
  const options = shuffled(rng, [...values].map(String));
  return { options, answer: options.indexOf(String(answer)) };
}

/** Hides one term of a numeric sequence; the last term is a "what comes next?" question. */
function numberRound(rng, terms, deltas) {
  const hidden = randomInt(rng, 2, terms.length - 1);
  const shown = terms.map((t, i) => (i === hidden ? '❓' : String(t)));
  const prompt = hidden === terms.length - 1 ? `What comes next? \`${shown.join(', ')}\`` : `Which number is missing? \`${shown.join(', ')}\``;
  return { prompt, ...numberChoices(rng, terms[hidden], deltas) };
}

export const PATTERN_GENERATORS = {
  arithmetic(rng, hard) {
    const [start, step] = [randomInt(rng, 1, 20), randomInt(rng, 2, hard ? 17 : 9)];
    return numberRound(rng, Array.from({ length: 6 }, (_, i) => start + i * step), [step, -step, 1, -1, 2]);
  },
  geometric(rng) {
    const [start, ratio] = [randomInt(rng, 1, 4), randomInt(rng, 2, 3)];
    const terms = Array.from({ length: 6 }, (_, i) => start * ratio ** i);
    return numberRound(rng, terms, [start, -start, ratio, -ratio, 1, 2]);
  },
  squares(rng) {
    const start = randomInt(rng, 1, 6);
    return numberRound(rng, Array.from({ length: 6 }, (_, i) => (start + i) ** 2), [1, -1, 2, -2, start + 1]);
  },
  alternating(rng) {
    const [start, up] = [randomInt(rng, 10, 30), randomInt(rng, 3, 9)];
    const down = randomInt(rng, 1, up - 1);
    const terms = [start];
    for (let i = 1; i < 6; i += 1) terms.push(terms[i - 1] + (i % 2 ? up : -down));
    return numberRound(rng, terms, [up, -up, down, -down, 1]);
  },
  fibonacci(rng) {
    const a = randomInt(rng, 1, 5);
    const terms = [a, randomInt(rng, a, 8)];
    for (let i = 2; i < 6; i += 1) terms.push(terms[i - 1] + terms[i - 2]);
    return numberRound(rng, terms, [1, -1, 2, terms[1], -terms[1]]);
  },
  symbols(rng) {
    const unit = sample(rng, PATTERN_SYMBOLS, randomInt(rng, 2, 3));
    const sequence = Array.from({ length: 7 }, (_, i) => unit[i % unit.length]);
    const hidden = randomInt(rng, 2, 6);
    const answer = sequence[hidden];
    sequence[hidden] = '❓';
    const options = shuffled(rng, [answer, ...sample(rng, PATTERN_SYMBOLS.filter((s) => s !== answer), 3)]);
    return { prompt: `Which symbol is missing? \`${sequence.join(' ')}\``, options, answer: options.indexOf(answer) };
  },
};

const PATTERN_KINDS = {
  easy: ['arithmetic', 'symbols', 'squares'],
  medium: ['arithmetic', 'symbols', 'geometric', 'alternating', 'squares'],
  hard: ['arithmetic', 'geometric', 'alternating', 'fibonacci', 'squares'],
};

export const pattern = {
  start: ({ options, rng }) => ({
    difficulty: options.difficulty,
    rounds: Array.from({ length: PATTERN_ROUNDS }, () => PATTERN_GENERATORS[pick(rng, PATTERN_KINDS[options.difficulty])](rng, options.difficulty === 'hard')),
    round: 0,
    correct: 0,
  }),
  act(state, action) {
    const current = state.rounds[state.round];
    const index = current ? indexFrom(action, 'pick', current.options.length) : null;
    if (index === null) return invalid(state, 'That is not an option.');
    const right = index === current.answer;
    if (right) state.correct += 1;
    state.round += 1;
    const feedback = right ? '✅ Correct!' : `❌ It was **${current.options[current.answer]}**.`;
    if (state.round < state.rounds.length) return next(state, feedback);
    return patternResult(state, feedback);
  },
  expire: (state) => patternResult(state, '⏰ Time is up.'),
};

function patternResult(state, feedback) {
  const reward = FREE_REWARDS.pattern;
  const perfect = state.correct === state.rounds.length;
  const coins = Math.round((state.correct * reward.perCorrect + (perfect ? reward.perfectBonus : 0)) * reward.multiplier[state.difficulty]);
  return finish(state, free(state.correct >= 2, coins, state.correct * reward.xpPerCorrect), `${feedback}\n${state.correct}/${state.rounds.length} correct.`);
}

// ── Unscramble ─────────────────────────────────────────────────────────────

export const UNSCRAMBLE_ATTEMPTS = 3;
export const HINT_PENALTY = 0.7;

export function scramble(word, rng) {
  for (let i = 0; i < 20; i += 1) {
    const mixed = shuffled(rng, [...word]).join('');
    if (mixed !== word) return mixed;
  }
  return word.slice(1) + word[0];
}

export const unscramble = {
  start({ options, rng, now, timeLimitMs }) {
    const word = pick(rng, SCRAMBLE_WORDS[options.difficulty]).toUpperCase();
    return { difficulty: options.difficulty, word, scrambled: scramble(word, rng), attemptsLeft: UNSCRAMBLE_ATTEMPTS, hint: false, tries: [], startedAt: now, endsAt: now + timeLimitMs };
  },
  act(state, action, { input, now }) {
    if (action === 'hint') {
      if (state.hint) return invalid(state, 'You already have the hint.');
      state.hint = true;
      return next(state, `💡 It starts with **${state.word[0]}** and ends with **${state.word.at(-1)}**.`);
    }
    if (action !== 'answer') return invalid(state, 'Use the Answer button.');
    const word = String(input ?? '').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(word)) return invalid(state, 'Answers use letters only.');
    state.tries.push(word);
    if (word === state.word) {
      const reward = FREE_REWARDS.unscramble[state.difficulty];
      const coins = Math.round(reward.coins * (state.hint ? HINT_PENALTY : 1) * (0.6 + 0.4 * speedOf(state, now)));
      return finish(state, free(true, coins, reward.xp), `✅ **${state.word}** is right!`);
    }
    state.attemptsLeft -= 1;
    if (state.attemptsLeft === 0) return finish(state, free(false), `❌ The word was **${state.word}**.`);
    return next(state, `❌ Not **${word}**. ${state.attemptsLeft} ${state.attemptsLeft === 1 ? 'try' : 'tries'} left.`);
  },
  expire: lose((state) => `⏰ Time is up! The word was **${state.word}**.`),
};

// ── Reaction Challenge ─────────────────────────────────────────────────────

export const REACTION = Object.freeze({
  colours: Object.freeze([
    { emoji: '🔴', name: 'red' }, { emoji: '🟡', name: 'yellow' }, { emoji: '🟢', name: 'green' },
    { emoji: '🔵', name: 'blue' }, { emoji: '🟣', name: 'purple' },
  ]),
  minDelayMs: 2_000,
  maxDelayMs: 5_000,
  windowMs: 3_000,
});

export const reaction = {
  start: ({ now, rng }) => ({
    goAt: now + randomInt(rng, REACTION.minDelayMs, REACTION.maxDelayMs),
    order: shuffled(rng, REACTION.colours.map((_, i) => i)),
    target: randomInt(rng, 0, REACTION.colours.length - 1),
    pressed: null,
    reactionMs: null,
  }),
  /** Times come from the server clock; a click before the signal is rejected. */
  act(state, action, { now }) {
    const position = indexFrom(action, 'press', state.order.length);
    if (position === null) return invalid(state, 'Press one of the coloured buttons.');
    state.pressed = position;
    if (now < state.goAt) return finish(state, free(false), '⛔ Too early! Wait for the signal.');
    if (state.order[position] !== state.target) return finish(state, free(false), `❌ Wrong colour. You needed ${REACTION.colours[state.target].emoji}.`);
    const ms = now - state.goAt;
    state.reactionMs = ms;
    if (ms > REACTION.windowMs) return finish(state, free(false), `🐢 Too slow (${(ms / 1000).toFixed(2)}s).`);
    const reward = FREE_REWARDS.reaction;
    return finish(state, free(true, Math.round(reward.min + (reward.max - reward.min) * (1 - ms / REACTION.windowMs)), reward.xp), `⚡ ${(ms / 1000).toFixed(3)}s!`);
  },
  expire: lose('⏰ No click in time.'),
};
