import { clamp, pick, randomInt, shuffled, weighted } from '../random.js';
import { finish, free, indexFrom, invalid, next } from './engine.js';
import { FISH, FISH_RARITIES, TREASURE } from './tables.js';

/** Fishing and treasure hunting: free activities with their own progression. */

// ── Fishing ────────────────────────────────────────────────────────────────

export const REEL = Object.freeze({ windowMs: 3_000, minWaitMs: 2_500, maxWaitMs: 7_000, maxEarly: 2 });

/** Fishing level from the fishing XP stored in game statistics. */
export const fishingLevel = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 20));

/** Better timing (quality 0–1) shifts the odds from junk towards rare fish; levels help with rare+. */
export function catchWeights(quality, level) {
  return Object.entries(FISH_RARITIES).map(([rarity, r]) => ({
    rarity,
    weight: r.weight
      * (r.qualityBonus < 0 ? 1 - quality : 1 + quality * r.qualityBonus)
      * (r.levelBonus ? 1 + Math.min(level, 50) * 0.02 : 1),
  }));
}

export function rollCatch(rng, quality, level) {
  const { rarity } = weighted(rng, catchWeights(quality, level));
  return pick(rng, FISH.filter((fish) => fish.rarity === rarity));
}

const nextBite = (now, rng) => now + randomInt(rng, REEL.minWaitMs, REEL.maxWaitMs);

export const fish = {
  start: ({ options, rng, now }) => ({ level: options.level ?? 1, castAt: now, biteAt: nextBite(now, rng), window: REEL.windowMs, early: 0, catch: null, reactionMs: null }),
  act(state, action, { now, rng }) {
    if (action !== 'reel') return invalid(state, 'Use the Reel in button.');
    if (now < state.biteAt) {
      state.early += 1;
      if (state.early > REEL.maxEarly) return finish(state, free(false), '💦 All that splashing scared the fish away.');
      state.biteAt = nextBite(now, rng);
      return next(state, '💦 Too early! Wait for a bite.');
    }
    const ms = now - state.biteAt;
    state.reactionMs = ms;
    if (ms > state.window) return finish(state, free(false), '🐟 Too slow. It got away!');
    state.catch = rollCatch(rng, clamp(1 - ms / state.window), state.level);
    const rarity = FISH_RARITIES[state.catch.rarity].label;
    return finish(state, free(true, state.catch.value, 3, { gameXp: state.catch.xp }), `🎣 You caught **${state.catch.emoji} ${state.catch.name}** (${rarity}) in ${(ms / 1000).toFixed(2)}s!`);
  },
  expire: (state) => finish(state, free(false), '⏰ The line went slack.'),
};

// ── Treasure hunt ──────────────────────────────────────────────────────────

export const LOOT = Object.freeze(Object.fromEntries([...TREASURE.loot, TREASURE.rare].map((item) => [item.key, item])));
export const gridDistance = (a, b, columns) => Math.abs(Math.floor(a / columns) - Math.floor(b / columns)) + Math.abs((a % columns) - (b % columns));

const isLoot = (cell) => cell !== null && cell !== 'trap';
const undugLoot = (state) => state.cells.map((cell, i) => i).filter((i) => isLoot(state.cells[i]) && !state.dug.some((d) => d.index === i));

function treasureEnd(state, feedback) {
  return finish(state, free(state.value > 0, state.value, TREASURE.xp, { gameXp: state.found.length * 5 }), feedback);
}

export const treasure = {
  start({ rng }) {
    const pieces = TREASURE.loot.flatMap((item) => Array(item.count).fill(item.key));
    if (rng() < TREASURE.rare.chance) pieces[pieces.indexOf('relic')] = TREASURE.rare.key;
    const empty = TREASURE.size - pieces.length - TREASURE.traps;
    const cells = shuffled(rng, [...pieces, ...Array(TREASURE.traps).fill('trap'), ...Array(empty).fill(null)]);
    return { cells, columns: TREASURE.columns, dug: [], digsLeft: TREASURE.digs, value: 0, found: [] };
  },
  act(state, action) {
    if (action === 'leave') return treasureEnd(state, 'You head home with your loot.');
    const index = indexFrom(action, 'dig', state.cells.length);
    if (index === null || state.dug.some((d) => d.index === index)) return invalid(state, 'Dig somewhere new.');
    state.digsLeft -= 1;
    const cell = state.cells[index];
    if (cell === 'trap') {
      state.dug.push({ index, kind: 'trap' });
      return treasureEnd(state, '💥 A trap! You escape with what you already found.');
    }
    let feedback;
    if (isLoot(cell)) {
      const item = LOOT[cell];
      state.dug.push({ index, kind: 'loot', key: cell });
      state.found.push(cell);
      state.value += item.value;
      feedback = `${item.emoji} You found **${item.name}** (+${item.value} LC)!`;
    } else {
      const left = undugLoot(state);
      const distance = left.length ? Math.min(...left.map((i) => gridDistance(index, i, state.columns))) : null;
      state.dug.push({ index, kind: 'empty', distance });
      feedback = distance === null ? 'Nothing here.' : `Nothing here. The nearest treasure is **${distance}** step${distance === 1 ? '' : 's'} away.`;
    }
    if (!undugLoot(state).length) return treasureEnd(state, `${feedback}\n🎉 You found every treasure!`);
    if (state.digsLeft === 0) return treasureEnd(state, `${feedback}\nOut of digs.`);
    return next(state, feedback);
  },
  expire: (state) => treasureEnd(state, '⏰ Time is up. You keep what you found.'),
};
