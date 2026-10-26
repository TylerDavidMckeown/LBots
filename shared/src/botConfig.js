import { GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';
import { BASE_SETUP_ITEMS, SETTING_TYPES } from './setupKit.js';

/** Shared Lyss Tools branding. Each bot may override any part; guilds can override via /setup. */
export const DEFAULT_BRAND = Object.freeze({
  primary: '#C084FC',
  secondary: '#7C3AED',
  footer: 'Lyss Tools',
});

const DEFAULTS = {
  timezone: 'UTC',
  intents: ['Guilds'],
  partials: [],
  status: [],
  statusIntervalMs: 45_000,
  setup: [],
  defaults: {},
  emojis: {},
  requiredPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks'],
  requiredEnv: ['DISCORD_TOKEN', 'CLIENT_ID'],
  optionalEnv: ['GUILD_ID', 'OWNER_ID'],
  defaultCooldownSeconds: 2,
  retention: { errorLogDays: 30, finishedJobDays: 30 },
  backup: { enabled: true, intervalHours: 24, keep: 14 },
  help: {},
};

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid bot config: ${message}`);
}

/**
 * Fills in defaults and validates a bot's config.js so mistakes fail at startup
 * rather than when a command is first used.
 */
export function defineBotConfig(input) {
  const config = {
    ...DEFAULTS,
    ...input,
    brand: { ...DEFAULT_BRAND, ...input.brand },
    retention: { ...DEFAULTS.retention, ...input.retention },
    backup: { ...DEFAULTS.backup, ...input.backup },
  };

  assert(typeof config.name === 'string' && config.name, '`name` is required');
  assert(/^[a-z][a-z0-9-]*$/.test(config.namespace ?? ''), '`namespace` must be lowercase letters, digits or dashes');
  assert(/^[\w-]+\.db$/.test(config.databaseFile ?? ''), '`databaseFile` must look like "name.db"');
  for (const intent of config.intents) assert(intent in GatewayIntentBits, `unknown intent "${intent}"`);
  for (const partial of config.partials) assert(partial in Partials, `unknown partial "${partial}"`);
  for (const permission of config.requiredPermissions) assert(permission in PermissionFlagsBits, `unknown permission "${permission}"`);
  assert(config.statusIntervalMs >= 30_000, '`statusIntervalMs` must be at least 30000');

  const setupItems = [...BASE_SETUP_ITEMS, ...config.setup];
  const keys = new Set();
  for (const item of setupItems) {
    assert(item.key && !keys.has(item.key), `duplicate or missing setup key "${item.key}"`);
    keys.add(item.key);
    assert(SETTING_TYPES.includes(item.type), `setup "${item.key}" has unknown type "${item.type}"`);
    assert(item.label, `setup "${item.key}" needs a label`);
    for (const permission of item.permissions ?? []) assert(permission in PermissionFlagsBits, `setup "${item.key}" uses unknown permission "${permission}"`);
  }
  config.setupItems = setupItems;

  // Values every guild starts with until /setup overrides them.
  config.guildDefaults = {
    timezone: config.timezone,
    'brand.primary': config.brand.primary,
    'brand.secondary': config.brand.secondary,
    'brand.footer': config.brand.footer,
    ...Object.fromEntries(setupItems.filter((i) => i.default !== undefined).map((i) => [i.key, i.default])),
    ...config.defaults,
  };
  return Object.freeze(config);
}
