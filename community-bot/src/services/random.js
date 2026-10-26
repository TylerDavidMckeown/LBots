import crypto from 'node:crypto';
import { randomInt } from './economyRules.js';

/**
 * Random helpers shared by jobs and games. Every helper takes an injected `rng`
 * (returning 0 ≤ x < 1), so outcomes are decided server-side and tests can seed them.
 */

export { randomInt };

/** Unpredictable source for real play (48 random bits → 0 ≤ x < 1). Outcomes are random, not provably fair. */
export const secureRandom = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

export const pick = (rng, list) => list[Math.floor(rng() * list.length)];

export function shuffled(rng, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const sample = (rng, list, n) => shuffled(rng, list).slice(0, n);

/** Picks one item in proportion to `weightOf(item)` (defaults to `item.weight`). */
export function weighted(rng, items, weightOf = (item) => item.weight) {
  let roll = rng() * items.reduce((sum, item) => sum + weightOf(item), 0);
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
