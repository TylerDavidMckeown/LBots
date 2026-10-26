import { clamp, pick, randomInt, sample, shuffled, weighted } from './random.js';

/**
 * Interactive /work jobs: the catalogue, task generation, answer checking and the
 * central reward rules. Everything here is pure and deterministic for a given `rng`,
 * so outcomes are decided server-side and can be tested. Answers only ever live in
 * the stored session state; buttons carry nothing but an option index.
 */

export const DIFFICULTIES = Object.freeze({
  easy: { label: 'Easy', unlockLevel: 1, reward: [100, 300], xp: 20, timeMs: 90_000, maxMistakes: 3 },
  medium: { label: 'Medium', unlockLevel: 10, reward: [180, 450], xp: 35, timeMs: 75_000, maxMistakes: 3 },
  hard: { label: 'Hard', unlockLevel: 30, reward: [250, 600], xp: 60, timeMs: 60_000, maxMistakes: 2 },
});

export const LEVEL_UNLOCKS = Object.freeze([
  { level: 1, text: 'Basic tasks' },
  { level: 5, text: 'Better reward range (+10%)' },
  { level: 10, text: 'Medium difficulty' },
  { level: 20, text: 'Rare task variants (1.5× pay)' },
  { level: 30, text: 'Hard difficulty' },
  { level: 50, text: 'Exclusive job title' },
]);

export const RARE_LEVEL = 20;
export const RARE_CHANCE = 0.15;
export const TITLE_LEVEL = 50;

export const JOBS = Object.freeze({
  chef: { name: 'Chef', emoji: '🍳', kind: 'sequence', title: 'Head Chef', description: 'Kitchen Rush: assemble each customer order in the right order before time runs out.' },
  barista: { name: 'Barista', emoji: '☕', kind: 'sequence', title: 'Master Barista', description: 'Prepare drinks by following each recipe step by step.' },
  blacksmith: { name: 'Blacksmith', emoji: '⚒️', kind: 'sequence', title: 'Master Smith', description: 'Forge equipment by following the crafting sequence.' },
  miner: { name: 'Miner', emoji: '⛏️', kind: 'grid', title: 'Deep Delver', description: 'Choose which blocks to mine. Rare ores and relics pay the most.' },
  treasure: { name: 'Treasure Hunter', emoji: '🗺️', kind: 'grid', title: 'Legendary Explorer', description: 'Dig on the map. Every dig tells you how far away the treasure is.' },
  fisher: { name: 'Fisher', emoji: '🎣', kind: 'timing', title: 'Angler Supreme', description: 'Cast your line and reel in the moment a fish bites.' },
  delivery: { name: 'Delivery Driver', emoji: '🚚', kind: 'quiz', title: 'Road Legend', description: 'Choose the right route to each delivery address.' },
  courier: { name: 'Courier', emoji: '📦', kind: 'quiz', title: 'Sorting Supreme', description: 'Sort parcels to the correct depot as quickly as you can.' },
  hacker: { name: 'Hacker', emoji: '💻', kind: 'quiz', title: 'Code Wizard', description: 'Solve fictional code puzzles: sequences, patterns and simple ciphers.' },
  detective: { name: 'Detective', emoji: '🕵️', kind: 'quiz', title: 'Master Detective', description: 'Read the clues and name the culprit.' },
  gardener: { name: 'Gardener', emoji: '🌻', kind: 'quiz', title: 'Green Thumb', description: 'Decide what each plant needs: water, harvest, protect or prune.' },
  // Pays fewer coins (`payout`) but also Pet Treats (`items` per difficulty, doubled for rare tasks).
  caretaker: {
    name: 'Pet Caretaker', emoji: '🐾', kind: 'quiz', title: 'Pet Whisperer', payout: 0.6, items: { item: 'pet_treat', easy: 1, medium: 1, hard: 2 },
    description: 'Look after visiting animals by working out what each one needs. Pays Pet Treats and a few coins.',
  },
});

const invalid = (state, feedback) => ({ state, feedback, done: false });

// ── Sequence jobs: click the steps in order ─────────────────────────────────

const SEQUENCES = {
  chef: {
    pool: ['🍔 Burger', '🍟 Fries', '🥤 Lemonade', '🥗 Salad', '🍕 Pizza', '🌭 Hot dog', '🥛 Milkshake', '🌮 Taco', '🍲 Soup', '🍪 Cookie', '🧀 Nachos', '🥞 Pancakes'],
    subjects: ['Customer order', 'Table 4 order', 'Drive-through order', 'Takeaway order'],
  },
  barista: {
    pool: ['☕ Espresso', '🥛 Steamed milk', '🫧 Foam', '🍯 Honey', '🍫 Chocolate', '🍮 Caramel', '🧊 Ice', '💧 Hot water', '🌿 Vanilla', '🍵 Matcha', '🥥 Oat milk', '✨ Cinnamon'],
    subjects: ['Caramel Cloud', 'Honey Oat Latte', 'Mocha Storm', 'Vanilla Breeze', 'Matcha Dream', 'Spiced Cocoa'],
  },
  blacksmith: {
    pool: ['🔥 Heat', '🔨 Hammer', '🌀 Fold', '💧 Quench', '✨ Polish', '🪨 Grind', '📏 Measure', '🪵 Fit handle', '⚙️ Temper', '🧵 Wrap grip'],
    subjects: ['Iron Sword', 'Steel Shield', 'Copper Pickaxe', 'Silver Dagger', 'Bronze Helmet'],
  },
};
const SEQUENCE_LENGTH = { easy: 3, medium: 4, hard: 5 };
const SEQUENCE_OPTIONS = { easy: 6, medium: 8, hard: 10 };

function generateSequence(job, difficulty, rng) {
  const spec = SEQUENCES[job];
  const target = sample(rng, spec.pool, SEQUENCE_LENGTH[difficulty]);
  const extras = sample(rng, spec.pool.filter((item) => !target.includes(item)), SEQUENCE_OPTIONS[difficulty] - target.length);
  return { kind: 'sequence', subject: pick(rng, spec.subjects), target, options: shuffled(rng, [...target, ...extras]), progress: 0, mistakes: 0 };
}

function applySequence(state, choice, maxMistakes) {
  const index = Number(choice);
  if (!Number.isInteger(index) || !state.options[index]) return invalid(state, 'That is not an option.');
  if (state.options[index] === state.target[state.progress]) {
    state.progress += 1;
    if (state.progress === state.target.length) {
      return { state, feedback: 'Every step done in the right order!', done: true, success: true, performance: clamp(1 - 0.2 * state.mistakes) };
    }
    return { state, feedback: `✅ ${state.options[index]}`, done: false };
  }
  state.mistakes += 1;
  if (state.mistakes > maxMistakes) return { state, feedback: 'Too many mistakes. This one is ruined.', done: true, success: false, performance: 0 };
  return { state, feedback: `❌ ${state.options[index]} is not next.`, done: false };
}

// ── Grid jobs: mining and treasure hunting ──────────────────────────────────

export const ORES = Object.freeze([
  { key: 'stone', emoji: '🪨', name: 'Stone', value: 0, weight: 38 },
  { key: 'coal', emoji: '⚫', name: 'Coal', value: 1, weight: 26 },
  { key: 'iron', emoji: '🔩', name: 'Iron', value: 2, weight: 17 },
  { key: 'gold', emoji: '🟡', name: 'Gold', value: 4, weight: 11 },
  { key: 'diamond', emoji: '💎', name: 'Diamond', value: 8, weight: 6 },
  { key: 'relic', emoji: '🏺', name: 'Ancient relic', value: 15, weight: 2 },
]);
export const ORE_BY_KEY = Object.freeze(Object.fromEntries(ORES.map((ore) => [ore.key, ore])));
const MINE_PICKS = { easy: 5, medium: 4, hard: 3 };

function generateMine(difficulty, rng, rare) {
  const cells = Array.from({ length: 16 }, () => weighted(rng, ORES).key);
  if (rare) cells[randomInt(rng, 0, cells.length - 1)] = 'relic';
  return { kind: 'grid', mode: 'mine', columns: 4, cells, revealed: [], picksLeft: MINE_PICKS[difficulty], mistakes: 0 };
}

function applyMine(state, choice) {
  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= state.cells.length || state.revealed.includes(index)) {
    return invalid(state, 'Pick a block you have not mined yet.');
  }
  state.revealed.push(index);
  state.picksLeft -= 1;
  const ore = ORE_BY_KEY[state.cells[index]];
  const feedback = `${ore.emoji} You found **${ore.name}**${ore.value ? ` (+${ore.value})` : ''}.`;
  if (state.picksLeft > 0) return { state, feedback, done: false };
  const found = state.revealed.reduce((sum, i) => sum + ORE_BY_KEY[state.cells[i]].value, 0);
  const best = state.cells.map((key) => ORE_BY_KEY[key].value).sort((a, b) => b - a)
    .slice(0, state.revealed.length).reduce((sum, value) => sum + value, 0);
  if (found === 0) return { state, feedback: `${feedback} Nothing valuable this shift.`, done: true, success: false, performance: 0 };
  return { state, feedback, done: true, success: true, performance: best ? clamp(found / best) : 1 };
}

const TREASURE = {
  easy: { cells: 16, columns: 4, moves: 6 },
  medium: { cells: 20, columns: 5, moves: 5 },
  hard: { cells: 20, columns: 5, moves: 4 },
};

export const gridDistance = (a, b, columns) => Math.abs(Math.floor(a / columns) - Math.floor(b / columns)) + Math.abs((a % columns) - (b % columns));
export const hintEmoji = (distance) => (distance === 0 ? '💰' : distance === 1 ? '🔥' : distance === 2 ? '🌡️' : '❄️');

function generateTreasure(difficulty, rng) {
  const { cells, columns, moves } = TREASURE[difficulty];
  return { kind: 'grid', mode: 'treasure', columns, size: cells, treasure: randomInt(rng, 0, cells - 1), digs: [], moves, movesLeft: moves, mistakes: 0 };
}

function applyTreasure(state, choice) {
  const index = Number(choice);
  if (!Number.isInteger(index) || index < 0 || index >= state.size || state.digs.some((d) => d.index === index)) {
    return invalid(state, 'Dig somewhere new.');
  }
  state.movesLeft -= 1;
  const distance = gridDistance(index, state.treasure, state.columns);
  state.digs.push({ index, distance });
  if (distance === 0) {
    return { state, feedback: '💰 You found the treasure!', done: true, success: true, performance: clamp(0.4 + 0.6 * (state.movesLeft / (state.moves - 1))) };
  }
  if (state.movesLeft === 0) return { state, feedback: `${hintEmoji(distance)} Out of digs. The treasure stays buried.`, done: true, success: false, performance: 0 };
  return { state, feedback: `${hintEmoji(distance)} The treasure is ${distance} step${distance === 1 ? '' : 's'} away.`, done: false };
}

// ── Timing job: fishing ─────────────────────────────────────────────────────

const REEL_WINDOW = { easy: 4_000, medium: 3_000, hard: 2_000 };
const CATCHES = [
  { min: 0.85, items: ['💰 Sunken treasure chest', '🦈 Shark tooth', '🐚 Pearl oyster'] },
  { min: 0.6, items: ['🐡 Pufferfish', '🦑 Squid', '🐠 Rainbow trout'] },
  { min: 0.3, items: ['🐟 Cod', '🐟 Mackerel', '🐠 Perch'] },
  { min: 0, items: ['👢 Old boot', '🥫 Tin can', '🌿 Seaweed'] },
];
const nextBite = (now, rng) => now + randomInt(rng, 2_500, 6_000);

function generateTiming(difficulty, rng, now) {
  return { kind: 'timing', castAt: now, biteAt: nextBite(now, rng), window: REEL_WINDOW[difficulty], mistakes: 0, catch: null };
}

/** Reaction time is measured with server timestamps; reeling before the bite is rejected. */
function applyTiming(state, choice, now, rng, maxMistakes) {
  if (choice !== 'reel') return invalid(state, 'Use the Reel in button.');
  if (now < state.biteAt) {
    state.mistakes += 1;
    if (state.mistakes > maxMistakes) return { state, feedback: '💦 All that splashing scared every fish away.', done: true, success: false, performance: 0 };
    state.biteAt = nextBite(now, rng);
    return { state, feedback: '💦 Too early! The fish swam off. Wait for the next bite.', done: false };
  }
  const reaction = now - state.biteAt;
  if (reaction > state.window) return { state, feedback: '🐟 Too slow. It got away!', done: true, success: false, performance: 0 };
  const performance = clamp(1 - (0.7 * reaction) / state.window);
  state.catch = pick(rng, CATCHES.find((c) => performance >= c.min).items);
  return { state, feedback: `🎣 You reeled in **${state.catch}** in ${(reaction / 1000).toFixed(2)}s!`, done: true, success: true, performance };
}

// ── Quiz jobs: several rounds of multiple choice ────────────────────────────

const QUIZ_ROUNDS = {
  delivery: { easy: 2, medium: 3, hard: 4 },
  courier: { easy: 4, medium: 5, hard: 6 },
  hacker: { easy: 3, medium: 4, hard: 5 },
  detective: { easy: 1, medium: 2, hard: 2 },
  gardener: { easy: 3, medium: 4, hard: 5 },
  caretaker: { easy: 3, medium: 4, hard: 5 },
};

/** Options as strings with the answer's index, shuffled. */
function withAnswer(rng, answer, distractors) {
  const options = shuffled(rng, [answer, ...distractors].map(String));
  return { options, answer: options.indexOf(String(answer)) };
}

function numericDistractors(rng, answer, deltas) {
  const values = new Set([answer]);
  for (const delta of shuffled(rng, deltas)) {
    if (values.size === 4) break;
    if (answer + delta >= 0) values.add(answer + delta);
  }
  for (let k = 3; values.size < 4; k += 1) values.add(answer + k * 7);
  values.delete(answer);
  return [...values];
}

const ARROW_FLIP = { '⬆️': '⬇️', '⬇️': '⬆️', '⬅️': '➡️', '➡️': '⬅️' };
const route = (segments) => segments.filter((s) => s.n > 0).map((s) => `${s.dir} ${s.n}`).join(' · ');

export function deliveryRound(rng) {
  const size = 5;
  let start;
  let dest;
  do {
    start = randomInt(rng, 0, size * size - 1);
    dest = randomInt(rng, 0, size * size - 1);
  } while (start === dest);
  const [sr, sc, dr, dc] = [Math.floor(start / size), start % size, Math.floor(dest / size), dest % size];
  const vertical = { dir: dr < sr ? '⬆️' : '⬇️', n: Math.abs(dr - sr) };
  const horizontal = { dir: dc > sc ? '➡️' : '⬅️', n: Math.abs(dc - sc) };
  const correct = route([vertical, horizontal]);
  const candidates = [
    route([{ ...vertical, dir: ARROW_FLIP[vertical.dir] }, horizontal]),
    route([vertical, { ...horizontal, dir: ARROW_FLIP[horizontal.dir] }]),
    route([{ ...vertical, n: vertical.n + 1 }, horizontal]),
    route([vertical, { ...horizontal, n: horizontal.n + 1 }]),
    route([{ ...vertical, n: Math.max(vertical.n - 1, 0) }, horizontal]),
    route([vertical, { ...horizontal, n: Math.max(horizontal.n - 1, 0) }]),
  ];
  const wrong = [...new Set(candidates)].filter((r) => r && r !== correct);
  const map = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (__, col) => {
    const cell = row * size + col;
    return cell === start ? '🚚' : cell === dest ? '🏠' : '⬜';
  }).join('')).join('\n');
  return { prompt: `Drive the 🚚 to the 🏠 using the shortest route.\n${map}`, ...withAnswer(rng, correct, sample(rng, wrong, 3)) };
}

const DEPOTS_BASIC = [['N', 'North'], ['E', 'East'], ['S', 'South'], ['W', 'West']];
const DEPOTS = {
  easy: DEPOTS_BASIC,
  medium: [...DEPOTS_BASIC, ['C', 'Central']],
  hard: [['N', 'North'], ['NE', 'North-East'], ['E', 'East'], ['SE', 'South-East'], ['S', 'South'], ['SW', 'South-West'], ['W', 'West'], ['NW', 'North-West']],
};
const POSTCODE_LETTERS = 'ABDEFGHJLNPQRSTUWXYZ';

function courierQuiz(difficulty, rng, rounds) {
  const depots = DEPOTS[difficulty];
  const options = depots.map(([, name]) => `${name} depot`);
  return {
    intro: `**Sorting rules:** ${depots.map(([prefix, name]) => `\`${prefix}\` → ${name}`).join(' · ')}`,
    rounds: Array.from({ length: rounds }, () => {
      const index = randomInt(rng, 0, depots.length - 1);
      const letters = `${pick(rng, [...POSTCODE_LETTERS])}${pick(rng, [...POSTCODE_LETTERS])}`;
      const postcode = `${depots[index][0]}${randomInt(rng, 1, 20)} ${randomInt(rng, 1, 9)}${letters}`;
      return { prompt: `📦 Parcel for **${postcode}**. Which depot?`, options, answer: index };
    }),
  };
}

const CIPHER_WORDS = ['LYSS', 'CODE', 'DATA', 'BYTE', 'PIXEL', 'ROBOT', 'LOGIC', 'CACHE', 'STACK', 'QUEUE', 'ARRAY', 'GHOST'];
const SYMBOLS = ['◆', '◇', '●', '○', '▲', '△', '■', '□'];
const shiftWord = (word, k) => [...word].map((c) => String.fromCharCode(((c.charCodeAt(0) - 65 + k) % 26) + 65)).join('');

const HACKER_PUZZLES = {
  arithmetic(rng, hard) {
    const start = randomInt(rng, 1, 20);
    const step = randomInt(rng, 2, hard ? 15 : 9);
    const terms = [0, 1, 2, 3].map((i) => start + i * step);
    const answer = start + 4 * step;
    return { prompt: `Find the next number: \`${terms.join(', ')}, ?\``, ...withAnswer(rng, answer, numericDistractors(rng, answer, [step, -step, 1, -1, 2 * step])) };
  },
  geometric(rng) {
    const start = randomInt(rng, 1, 4);
    const ratio = randomInt(rng, 2, 3);
    const terms = [0, 1, 2, 3].map((i) => start * ratio ** i);
    const answer = start * ratio ** 4;
    return { prompt: `Find the next number: \`${terms.join(', ')}, ?\``, ...withAnswer(rng, answer, numericDistractors(rng, answer, [terms[3], -terms[3], ratio, -ratio, 1])) };
  },
  binary(rng, hard) {
    const n = randomInt(rng, 5, hard ? 255 : 63);
    return { prompt: `Convert binary \`${n.toString(2)}\` to decimal.`, ...withAnswer(rng, n, numericDistractors(rng, n, [1, -1, 2, -2, 8, -8])) };
  },
  cipher(rng, hard) {
    const word = pick(rng, CIPHER_WORDS);
    const k = randomInt(rng, 1, hard ? 7 : 3);
    return { prompt: `Decode \`${shiftWord(word, k)}\`. Every letter was shifted forward by ${k}.`, ...withAnswer(rng, word, sample(rng, CIPHER_WORDS.filter((w) => w !== word), 3)) };
  },
  pattern(rng) {
    const unit = sample(rng, SYMBOLS, randomInt(rng, 2, 3));
    const sequence = Array.from({ length: 7 }, (_, i) => unit[i % unit.length]);
    const hidden = randomInt(rng, 2, 6);
    const answer = sequence[hidden];
    sequence[hidden] = '❓';
    return { prompt: `Which symbol is missing? \`${sequence.join(' ')}\``, ...withAnswer(rng, answer, sample(rng, SYMBOLS.filter((s) => s !== answer), 3)) };
  },
  expression(rng) {
    const [a, b, c] = [randomInt(rng, 2, 9), randomInt(rng, 2, 9), randomInt(rng, 2, 9)];
    const answer = a + b * c;
    const wrong = [...new Set([(a + b) * c, a + b + c, a * b + c, answer + 1, answer + 2])].filter((v) => v !== answer).slice(0, 3);
    return { prompt: `The script prints \`${a} + ${b} * ${c}\`. What is the output?`, ...withAnswer(rng, answer, wrong) };
  },
};
const HACKER_KINDS = {
  easy: ['arithmetic', 'binary', 'pattern'],
  medium: ['arithmetic', 'binary', 'pattern', 'cipher', 'expression'],
  hard: ['arithmetic', 'binary', 'pattern', 'cipher', 'expression', 'geometric'],
};

const SUSPECT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dex', 'Elle', 'Finn', 'Gus', 'Hana'];
const ATTRIBUTES = {
  coat: ['red', 'blue', 'green', 'yellow', 'purple'],
  item: ['an umbrella', 'a camera', 'a map', 'a key', 'a lantern'],
  place: ['the library', 'the garden', 'the kitchen', 'the attic', 'the cellar'],
};
const MYSTERIES = ['The prize trophy has vanished!', 'Someone ate the last slice of cake!', 'The museum\'s golden duck is missing!', 'The mayor\'s hat has been stolen!'];
const SUSPECTS = { easy: 3, medium: 4, hard: 5 };

export function clueText({ attr, value, positive }) {
  if (attr === 'coat') return positive ? `The culprit wore a ${value} coat.` : `The culprit did not wear a ${value} coat.`;
  if (attr === 'item') return positive ? `The culprit was carrying ${value}.` : `The culprit was not carrying ${value}.`;
  return positive ? `The culprit was seen in ${value}.` : `The culprit was never in ${value}.`;
}

export const matchesClue = (suspect, clue) => (suspect[clue.attr] === clue.value) === clue.positive;

/** Builds a case whose clues identify exactly one suspect. */
export function detectiveRound(rng, suspectCount) {
  const suspects = [];
  const seen = new Set();
  for (const name of sample(rng, SUSPECT_NAMES, suspectCount)) {
    let suspect;
    do {
      suspect = { name, coat: pick(rng, ATTRIBUTES.coat), item: pick(rng, ATTRIBUTES.item), place: pick(rng, ATTRIBUTES.place) };
    } while (seen.has(`${suspect.coat}|${suspect.item}|${suspect.place}`));
    seen.add(`${suspect.coat}|${suspect.item}|${suspect.place}`);
    suspects.push(suspect);
  }
  const culprit = pick(rng, suspects);
  const facts = [];
  for (const attr of Object.keys(ATTRIBUTES)) {
    facts.push({ attr, value: culprit[attr], positive: true });
    for (const other of new Set(suspects.map((s) => s[attr]).filter((v) => v !== culprit[attr]))) facts.push({ attr, value: other, positive: false });
  }
  // Add clues that each rule someone out, until only the culprit remains (at least two clues).
  const clues = [];
  let candidates = suspects;
  for (const fact of shuffled(rng, facts)) {
    if (candidates.length === 1 && clues.length >= 2) break;
    const narrowed = candidates.filter((s) => matchesClue(s, fact));
    if (narrowed.length < candidates.length || (candidates.length === 1 && clues.length < 2)) {
      clues.push(fact);
      candidates = narrowed;
    }
  }
  const lines = suspects.map((s) => `• **${s.name}**: ${s.coat} coat, ${s.item}, ${s.place}`);
  const prompt = `${pick(rng, MYSTERIES)}\n\n**Suspects**\n${lines.join('\n')}\n\n**Clues**\n${clues.map((c, i) => `${i + 1}. ${clueText(c)}`).join('\n')}`;
  const options = suspects.map((s) => s.name);
  return { prompt, options, answer: options.indexOf(culprit.name), clues, suspects };
}

const GARDEN_ACTIONS = ['💧 Water', '🧺 Harvest', '🛡️ Protect', '✂️ Prune', '⏸️ Leave it'];
const GARDEN_SCENARIOS = [
  ['The soil is dry and the leaves are drooping.', 0],
  ['It has not rained for a week and the soil is cracked.', 0],
  ['The fruit is ripe and starting to fall.', 1],
  ['The vegetables are plump and ready to pick.', 1],
  ['Aphids are crawling over the new shoots.', 2],
  ['Frost is forecast for tonight.', 2],
  ['Hungry birds are eyeing the seedlings.', 2],
  ['Dead stems are crowding out the new growth.', 3],
  ['Branches are tangled and blocking the light.', 3],
  ['The soil is soggy after heavy rain.', 4],
  ['The plant is healthy and was watered this morning.', 4],
];
const PLANTS = ['🌻 Sunflower', '🍅 Tomato', '🌹 Rose', '🥕 Carrot', '🍓 Strawberry', '🌿 Basil'];

const CARE_SCENARIOS = [
  ['is whining next to an empty food bowl.', '🍖 Feed it'],
  ['is panting after a long walk in the sun.', '💧 Give it water'],
  ['is trembling during a thunderstorm.', '🧸 Comfort it'],
  ['keeps dropping a ball at your feet.', '🎾 Play fetch'],
  ['has rolled in a muddy puddle.', '🛁 Give it a bath'],
  ['is yawning and can barely keep its eyes open.', '💤 Let it rest'],
  ['has a small scratch on its paw.', '🩹 Clean the scratch'],
  ['has a tangled, matted coat.', '🪮 Brush its fur'],
];
const CARE_ANIMALS = ['🐶 A puppy', '🐱 A kitten', '🐰 A rabbit', '🐹 A hamster', '🦜 A parrot', '🐴 A pony'];
const CARE_ACTIONS = CARE_SCENARIOS.map(([, action]) => action);

function generateQuiz(job, difficulty, rng, rare) {
  const rounds = QUIZ_ROUNDS[job][difficulty];
  switch (job) {
    case 'delivery':
      return { intro: null, rounds: Array.from({ length: rounds }, () => deliveryRound(rng)) };
    case 'courier':
      return courierQuiz(difficulty, rng, rounds);
    case 'hacker':
      return { intro: null, rounds: Array.from({ length: rounds }, () => HACKER_PUZZLES[pick(rng, HACKER_KINDS[difficulty])](rng, difficulty === 'hard')) };
    case 'detective':
      return { intro: null, rounds: Array.from({ length: rounds }, () => detectiveRound(rng, SUSPECTS[difficulty])) };
    case 'gardener':
      return {
        intro: null,
        rounds: sample(rng, GARDEN_SCENARIOS, rounds).map(([text, answer], i) => ({
          prompt: `**${rare && i === 0 ? '🌺 Moonflower (rare!)' : pick(rng, PLANTS)}**: ${text}`,
          options: GARDEN_ACTIONS,
          answer,
        })),
      };
    case 'caretaker':
      return {
        intro: null,
        rounds: sample(rng, CARE_SCENARIOS, rounds).map(([text, action], i) => ({
          prompt: `**${rare && i === 0 ? '🦄 A unicorn foal (rare!)' : pick(rng, CARE_ANIMALS)}** ${text}`,
          ...withAnswer(rng, action, sample(rng, CARE_ACTIONS.filter((a) => a !== action), 3)),
        })),
      };
    default:
      throw new Error(`No quiz generator for ${job}`);
  }
}

function applyQuiz(state, choice) {
  const index = Number(choice);
  const current = state.rounds[state.round];
  if (!current || !Number.isInteger(index) || index < 0 || index >= current.options.length) return invalid(state, 'That is not an option.');
  const right = index === current.answer;
  if (right) state.correct += 1;
  else state.mistakes += 1;
  state.round += 1;
  const feedback = right ? '✅ Correct!' : `❌ The answer was **${current.options[current.answer]}**.`;
  if (state.round < state.rounds.length) return { state, feedback, done: false };
  const success = state.correct >= Math.ceil(state.rounds.length / 2);
  return { state, feedback, done: true, success, performance: success ? state.correct / state.rounds.length : 0 };
}

// ── Engine ──────────────────────────────────────────────────────────────────

/** Creates the hidden state for a new task. */
export function generateTask(job, difficulty, { rng = Math.random, now = Date.now(), rare = false } = {}) {
  if (!JOBS[job]) throw new Error(`Unknown job ${job}`);
  if (!DIFFICULTIES[difficulty]) throw new Error(`Unknown difficulty ${difficulty}`);
  let state;
  if (SEQUENCES[job]) state = generateSequence(job, difficulty, rng);
  else if (job === 'miner') state = generateMine(difficulty, rng, rare);
  else if (job === 'treasure') state = generateTreasure(difficulty, rng);
  else if (job === 'fisher') state = generateTiming(difficulty, rng, now);
  else state = { kind: 'quiz', round: 0, correct: 0, mistakes: 0, ...generateQuiz(job, difficulty, rng, rare) };
  return { ...state, rare };
}

/**
 * Applies one player action to a copy of the state.
 * @returns {{ state, feedback: string, done: boolean, success?: boolean, performance?: number }}
 */
export function applyAction(state, choice, { now = Date.now(), rng = Math.random, maxMistakes = 3 } = {}) {
  const next = structuredClone(state);
  switch (next.kind) {
    case 'sequence': return applySequence(next, choice, maxMistakes);
    case 'grid': return next.mode === 'mine' ? applyMine(next, choice) : applyTreasure(next, choice);
    case 'timing': return applyTiming(next, choice, now, rng, maxMistakes);
    case 'quiz': return applyQuiz(next, choice);
    default: throw new Error(`Unknown task kind ${next.kind}`);
  }
}

// ── Central reward rules ────────────────────────────────────────────────────

/** Combines accuracy with speed. Luck and reaction jobs are scored on performance alone. */
export function finalScore({ performance, kind, startedAt, finishedAt, timeLimitMs }) {
  if (!(performance > 0)) return 0;
  if (kind === 'grid' || kind === 'timing') return clamp(performance);
  const speed = clamp(1 - (finishedAt - startedAt) / timeLimitMs);
  return clamp(performance * (0.85 + 0.15 * speed));
}

/** The only place job payouts are calculated. */
export function calculateReward({ difficulty, level, score, rare = false, payoutPercent = 100, job = null }) {
  if (!(score > 0)) return 0;
  const [min, max] = DIFFICULTIES[difficulty].reward;
  const rangeBoost = level >= 5 ? 1.1 : 1;
  const levelBonus = 1 + Math.min(level, 50) * 0.01;
  const jobRate = JOBS[job]?.payout ?? 1;
  const amount = (min + (max - min) * clamp(score)) * rangeBoost * levelBonus * (rare ? 1.5 : 1) * jobRate * (payoutPercent / 100);
  return Math.max(1, Math.round(amount));
}

/** Items a successful job pays on top of coins, e.g. Pet Treats for Pet Caretakers. */
export function jobItems(job, difficulty, rare = false) {
  const items = JOBS[job]?.items;
  if (!items?.[difficulty]) return [];
  return [{ item: items.item, quantity: items[difficulty] * (rare ? 2 : 1) }];
}

export function calculateXp({ difficulty, score, success }) {
  const base = DIFFICULTIES[difficulty].xp;
  return success ? Math.round(base * (0.5 + 0.5 * clamp(score))) : Math.round(base * 0.25);
}

/** Job level n needs 25·(n−1)² XP: level 10 ≈ 2,000 XP, level 50 ≈ 60,000 XP. */
export const jobLevelForXp = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 25));
export const xpForJobLevel = (level) => 25 * (level - 1) ** 2;

export function unlockedDifficulties(level) {
  return Object.entries(DIFFICULTIES).filter(([, d]) => level >= d.unlockLevel).map(([key]) => key);
}

export function newUnlocks(levelBefore, levelAfter) {
  return LEVEL_UNLOCKS.filter((u) => u.level > levelBefore && u.level <= levelAfter);
}
