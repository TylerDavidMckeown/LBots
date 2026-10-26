import { fileURLToPath } from 'node:url';
import { openDatabase } from '@lyss/shared/db.js';
import { createEmbedStyle } from '@lyss/shared/embedStyle.js';
import { createGuildConfig } from '@lyss/shared/guildConfig.js';
import config from '../src/config.js';
import { ECONOMY_DEFAULTS } from '../src/services/economyRules.js';

export const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

export function communityDb(file = ':memory:') {
  return openDatabase(file, { migrations: [{ namespace: 'community', dir: MIGRATIONS }] });
}

export function fakeCtx(db = communityDb()) {
  const guildConfig = createGuildConfig(db, config.guildDefaults);
  return { config, db, guildConfig, embeds: createEmbedStyle({ brand: config.brand, guildConfig }), logger: { info() {}, warn() {}, error() {} } };
}

/** Default economy settings keyed without the "economy." prefix, with overrides. */
export const economyDefaults = (overrides = {}) => ({
  ...Object.fromEntries(Object.entries(ECONOMY_DEFAULTS).map(([k, v]) => [k.slice('economy.'.length), v])),
  ...overrides,
});

/** Small seeded PRNG (mulberry32) so generated games are reproducible. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic random source that returns the given values in turn. */
export const sequence = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
