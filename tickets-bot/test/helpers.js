import { fileURLToPath } from 'node:url';
import { openDatabase } from '@lyss/shared/db.js';
import { createEmbedStyle } from '@lyss/shared/embedStyle.js';
import { createGuildConfig } from '@lyss/shared/guildConfig.js';
import config from '../src/config.js';

const MIGRATIONS = fileURLToPath(new URL('../src/db/migrations', import.meta.url));

/** A database with the shared and tickets migrations applied. */
export function ticketsDb() {
  return openDatabase(':memory:', { migrations: [{ namespace: 'tickets', dir: MIGRATIONS }] });
}

/** Enough of the bot context for services and embed builders. */
export function fakeCtx(db = ticketsDb()) {
  const guildConfig = createGuildConfig(db, config.guildDefaults);
  return {
    config,
    db,
    guildConfig,
    embeds: createEmbedStyle({ brand: config.brand, guildConfig }),
    logger: { info() {}, warn() {}, error() {} },
  };
}
