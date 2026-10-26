import { fileURLToPath } from 'node:url';
import { openDatabase } from '@lyss/shared/db.js';
import { createEmbedStyle } from '@lyss/shared/embedStyle.js';
import { createGuildConfig } from '@lyss/shared/guildConfig.js';
import config from '../src/config.js';

const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

export function guardDb() {
  return openDatabase(':memory:', { migrations: [{ namespace: 'guard', dir: MIGRATIONS }] });
}

export function fakeCtx(db = guardDb()) {
  const guildConfig = createGuildConfig(db, config.guildDefaults);
  return {
    config,
    db,
    guildConfig,
    embeds: createEmbedStyle({ brand: config.brand, guildConfig }),
    logger: { info() {}, warn() {}, error() {} },
  };
}
