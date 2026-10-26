import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { backupDatabase } from '../src/backup.js';
import { openDatabase } from '../src/db.js';
import { buildEmbed } from '../src/embedBuilder/builder.js';
import { embedLength, parseColour, validateEmbed } from '../src/embedBuilder/validators.js';
import { createErrorReporter, makeErrorId } from '../src/errorReporter.js';
import { createGuildConfig } from '../src/guildConfig.js';
import { redact, redactObject } from '../src/redact.js';
import { renderStatusText } from '../src/statusRotator.js';
import { paginate, pageRow } from '../src/utils/pagination.js';
import { formatNumber, plural, progressBar, truncate } from '../src/utils/text.js';
import { formatDuration, parseDuration, startOfLocalDay } from '../src/utils/time.js';

test('parseDuration accepts compound durations and rejects junk', () => {
  assert.equal(parseDuration('30m'), 1_800_000);
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2d 4h'), 187_200_000);
  assert.equal(parseDuration('1w'), 604_800_000);
  for (const bad of ['', 'abc', '10x', '0m', '5', 'h1', '-1h', '1h abc']) assert.equal(parseDuration(bad), null, bad);
});

test('formatDuration shows the largest units', () => {
  assert.equal(formatDuration(90_061_000), '1d 1h 1m');
  assert.equal(formatDuration(500), '0s');
  assert.equal(formatDuration(3_600_000), '1h');
});

test('startOfLocalDay respects the server timezone', () => {
  // 2026-10-23 23:30 UTC is already 2026-10-24 in Tokyo.
  const at = Date.UTC(2026, 9, 23, 23, 30);
  assert.equal(new Date(startOfLocalDay('UTC', at)).toISOString(), '2026-10-23T00:00:00.000Z');
  assert.equal(new Date(startOfLocalDay('Asia/Tokyo', at)).toISOString(), '2026-10-23T15:00:00.000Z');
});

test('text helpers', () => {
  assert.equal(truncate('hello world', 6), 'hello…');
  assert.equal(truncate('short', 10), 'short');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(plural(1, 'coin'), '1 coin');
  assert.equal(plural(2500, 'coin'), '2,500 coins');
  assert.equal(progressBar(5, 10, 10), '▰▰▰▰▰▱▱▱▱▱');
  assert.equal(progressBar(50, 10, 4), '▰▰▰▰');
});

test('paginate clamps pages and pageRow builds unique IDs', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(paginate(items, 3, 10), { items: [20, 21, 22], page: 3, totalPages: 3, total: 23 });
  assert.equal(paginate(items, 99, 10).page, 3);
  assert.equal(paginate([], 1, 10).totalPages, 1);

  const row = pageRow((p) => `community:shop:page:${p}`, 1, 3).toJSON();
  const ids = row.components.map((c) => c.custom_id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(row.components[0].disabled, true);
  assert.equal(row.components[3].disabled, false);
});

test('embed validation enforces Discord limits', () => {
  assert.deepEqual(validateEmbed({ title: 'Hi', color: '#C084FC' }), []);
  assert.ok(validateEmbed({}).length, 'empty embed');
  assert.ok(validateEmbed({ title: 'x'.repeat(257) }).some((e) => /Title/.test(e)));
  assert.ok(validateEmbed({ title: 'x', image: 'ftp://nope' }).some((e) => /Image/.test(e)));
  assert.ok(validateEmbed({ title: 'x', color: 'blue' }).some((e) => /Colour/.test(e)));
  assert.ok(validateEmbed({ title: 'x', fields: Array.from({ length: 26 }, () => ({ name: 'a', value: 'b' })) }).length);
  const big = { description: 'x'.repeat(4000), fields: [{ name: 'a', value: 'y'.repeat(1024) }, { name: 'b', value: 'z'.repeat(1024) }] };
  assert.ok(embedLength(big) > 6000);
  assert.ok(validateEmbed(big).some((e) => /6000/.test(e)));
  assert.equal(parseColour('#ffffff'), 0xffffff);
  assert.equal(parseColour('nope'), null);
});

test('buildEmbed returns a builder or the validation errors', () => {
  const ok = buildEmbed({ title: 'Rules', description: 'Be kind', color: '#C084FC', fields: [{ name: 'One', value: 'Two', inline: true }] });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.embed.data.color, 0xc084fc);
  const bad = buildEmbed({});
  assert.equal(bad.embed, null);
  assert.ok(bad.errors.length);
});

test('status text placeholders', () => {
  assert.equal(renderStatusText('over {guilds} servers {unknown}', { guilds: 3 }), 'over 3 servers {unknown}');
});

test('redact removes secrets by value and by pattern', () => {
  const env = { DISCORD_TOKEN: 'super-secret-token-value', GROQ_API_KEY: 'gsk_abcdefghijklmnopqrstuvwxyz', GUILD_ID: '12345678901234567' };
  const text = 'token=super-secret-token-value key=gsk_abcdefghijklmnopqrstuvwxyz guild=12345678901234567';
  assert.equal(redact(text, env), 'token=[REDACTED] key=[REDACTED] guild=12345678901234567');
  assert.equal(redact('MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789', {}), '[REDACTED]');
  assert.deepEqual(redactObject({ apiKey: 'value123456', nested: { msg: 'super-secret-token-value' } }, env), { apiKey: '[REDACTED]', nested: { msg: '[REDACTED]' } });
});

test('error reporter stores a redacted record and returns a reference', async () => {
  const db = openDatabase(':memory:');
  const logged = [];
  const logger = { error: (msg, meta) => logged.push({ msg, meta }), warn() {}, info() {} };
  process.env.TEST_SECRET_TOKEN = 'leaky-secret-value-123';
  try {
    const reporter = createErrorReporter({ botName: 'Test', db, logger, guildConfig: createGuildConfig(db) });
    const ref = await reporter.report(new Error('failed with leaky-secret-value-123'), { source: 'command:/x', userId: 'u1' });
    assert.match(ref, /^LYS-[0-9A-F]{5}$/);
    const row = db.prepare('SELECT * FROM error_log WHERE id = ?').get(ref);
    assert.equal(row.message, 'failed with [REDACTED]');
    assert.equal(row.source, 'command:/x');
    assert.doesNotMatch(row.stack, /leaky-secret-value-123/);
    assert.doesNotMatch(JSON.stringify(logged), /leaky-secret-value-123/);
  } finally {
    delete process.env.TEST_SECRET_TOKEN;
  }
  assert.match(makeErrorId(), /^LYS-[0-9A-F]{5}$/);
});

test('guild config overrides defaults per guild', () => {
  const config = createGuildConfig(openDatabase(':memory:'), { timezone: 'UTC' });
  assert.equal(config.get('g1', 'timezone'), 'UTC');
  config.set('g1', 'timezone', 'Europe/London', 'u1');
  assert.equal(config.get('g1', 'timezone'), 'Europe/London');
  assert.equal(config.get('g2', 'timezone'), 'UTC');
  assert.equal(config.isSet('g1', 'timezone'), true);
  assert.deepEqual(config.all('g1'), { timezone: 'Europe/London' });
  assert.equal(config.unset('g1', 'timezone'), true);
  assert.equal(config.get('g1', 'timezone'), 'UTC');
  assert.throws(() => config.set('g1', 'x', undefined));
});

test('backups are readable copies and old ones are pruned', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyss-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(path.join(dir, 'live.db'));
  db.prepare('INSERT INTO guild_config (guild_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run('g', 'k', '"v"', 1);

  const out = path.join(dir, 'backups');
  for (let i = 0; i < 3; i += 1) {
    await backupDatabase(db, out, { prefix: 'test', keep: 2 });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const files = fs.readdirSync(out).sort();
  assert.equal(files.length, 2);
  const copy = new Database(path.join(out, files.at(-1)), { readonly: true });
  assert.equal(copy.prepare('SELECT value FROM guild_config').get().value, '"v"');
  copy.close();
  db.close();
});
