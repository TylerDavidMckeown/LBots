import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineBotConfig } from '../src/botConfig.js';
import { commandPayload } from '../src/deploy.js';
import { visibleCategories } from '../src/helpCommand.js';
import { collectModules } from '../src/modules.js';
import { Tier } from '../src/permissions.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const BOTS = {
  'tickets-bot': { name: 'Lyss Tickets', db: 'tickets.db' },
  'guard-bot': { name: 'Lyss Guard', db: 'guard.db' },
  'community-bot': { name: 'Lyss Community', db: 'community.db' },
  'ai-bot': { name: 'ALYSS', db: 'ai.db' },
};

for (const [dir, expected] of Object.entries(BOTS)) {
  test(`${dir} loads with /help, /status and /setup`, async () => {
    const rootDir = path.join(repoRoot, dir);
    const { default: config } = await import(path.join(rootDir, 'src', 'config.js'));
    assert.equal(config.name, expected.name);
    assert.equal(config.databaseFile, expected.db);

    const { commands, components } = await collectModules(rootDir, config);
    for (const name of ['help', 'status', 'setup']) assert.ok(commands.has(name), `missing /${name}`);
    assert.ok(components.has('help:category'));

    for (const json of commandPayload(commands)) {
      assert.deepEqual(json.contexts, [0], `/${json.name} should be guild-only`);
      assert.ok(JSON.stringify(json).length <= 8000);
    }
  });
}

test('every bot uses a distinct namespace and database', async () => {
  const configs = await Promise.all(Object.keys(BOTS).map(async (dir) => (await import(path.join(repoRoot, dir, 'src', 'config.js'))).default));
  assert.equal(new Set(configs.map((c) => c.namespace)).size, 4);
  assert.equal(new Set(configs.map((c) => c.databaseFile)).size, 4);
});

test('help hides admin commands from members', async () => {
  const rootDir = path.join(repoRoot, 'community-bot');
  const { default: config } = await import(path.join(rootDir, 'src', 'config.js'));
  const { commands } = await collectModules(rootDir, config);

  const memberLines = [...visibleCategories(commands, Tier.MEMBER).values()].flat().join('\n');
  assert.match(memberLines, /\/help/);
  assert.match(memberLines, /\/status/);
  assert.doesNotMatch(memberLines, /\/setup/);

  const adminLines = [...visibleCategories(commands, Tier.ADMIN).values()].flat().join('\n');
  assert.match(adminLines, /\/setup view/);
  assert.match(adminLines, /\/setup check/);
});

test('defineBotConfig rejects invalid configuration', () => {
  const base = { name: 'Test', namespace: 'test', databaseFile: 'test.db' };
  assert.doesNotThrow(() => defineBotConfig(base));
  assert.throws(() => defineBotConfig({ ...base, namespace: 'Bad Name' }), /namespace/);
  assert.throws(() => defineBotConfig({ ...base, databaseFile: '../escape.db' }), /databaseFile/);
  assert.throws(() => defineBotConfig({ ...base, intents: ['Guildz'] }), /unknown intent/);
  assert.throws(() => defineBotConfig({ ...base, requiredPermissions: ['BeAdmin'] }), /unknown permission/);
  assert.throws(() => defineBotConfig({ ...base, statusIntervalMs: 5_000 }), /statusIntervalMs/);
  assert.throws(() => defineBotConfig({ ...base, setup: [{ key: 'timezone', type: 'timezone', label: 'Dup' }] }), /duplicate/);
  assert.throws(() => defineBotConfig({ ...base, setup: [{ key: 'x', type: 'emoji', label: 'X' }] }), /unknown type/);
});

test('setup defaults become guild defaults', () => {
  const config = defineBotConfig({
    name: 'Test', namespace: 'test', databaseFile: 'test.db', timezone: 'Europe/London',
    setup: [{ key: 'feature.delay', type: 'duration', label: 'Delay', default: 60_000 }],
  });
  assert.equal(config.guildDefaults.timezone, 'Europe/London');
  assert.equal(config.guildDefaults['feature.delay'], 60_000);
  assert.ok(config.guildDefaults['brand.primary']);
});
