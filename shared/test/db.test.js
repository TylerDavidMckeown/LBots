import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { healthCheck, openDatabase, runMigrations, runOnce, SHARED_MIGRATIONS_DIR } from '../src/db.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyss-db-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('shared migrations create the core tables and are idempotent', () => {
  const db = openDatabase(':memory:');
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  for (const name of ['guild_config', 'scheduled_tasks', 'error_log', 'processed_operations', 'schema_migrations']) {
    assert.ok(tables.includes(name), `missing ${name}`);
  }
  assert.deepEqual(runMigrations(db, [{ namespace: 'shared', dir: SHARED_MIGRATIONS_DIR }]), []);
  assert.equal(healthCheck(db).ok, true);
});

test('a failing migration rolls back and later migrations are not applied', (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (x INTEGER);');
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b (x INTEGER); THIS IS NOT SQL;');
  fs.writeFileSync(path.join(dir, '003_c.sql'), 'CREATE TABLE c (x INTEGER);');
  const db = openDatabase(':memory:');

  assert.throws(() => runMigrations(db, [{ namespace: 'bot', dir }]));
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
  assert.ok(tables.includes('a'));
  assert.ok(!tables.includes('b'), 'partial migration must roll back');
  assert.ok(!tables.includes('c'));
  const applied = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
  assert.ok(applied.includes('bot/001_a.sql'));
  assert.ok(!applied.includes('bot/002_b.sql'));
});

test('migrations persist across reopening a file database', (t) => {
  const file = path.join(tempDir(t), 'test.db');
  const first = openDatabase(file);
  first.prepare('INSERT INTO guild_config (guild_id, key, value, updated_at) VALUES (?, ?, ?, ?)').run('g', 'k', '"v"', 1);
  first.close();
  const second = openDatabase(file);
  assert.equal(second.prepare('SELECT value FROM guild_config').get().value, '"v"');
  second.close();
});

function walletDb() {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE wallet (id TEXT PRIMARY KEY, coins INTEGER NOT NULL CHECK (coins >= 0))');
  db.prepare('INSERT INTO wallet VALUES (?, 0)').run('u1');
  const coins = () => db.prepare('SELECT coins FROM wallet WHERE id = ?').get('u1').coins;
  return { db, coins };
}

test('runOnce applies an operation exactly once and returns the stored result', () => {
  const { db, coins } = walletDb();
  const claim = () => runOnce(db, 'daily:u1:2026-10-23', () => {
    db.prepare('UPDATE wallet SET coins = coins + 500 WHERE id = ?').run('u1');
    return { granted: 500 };
  });

  assert.deepEqual(claim(), { applied: true, result: { granted: 500 } });
  assert.deepEqual(claim(), { applied: false, result: { granted: 500 } });
  assert.equal(coins(), 500);
});

test('runOnce rolls back and records nothing when the operation throws', () => {
  const { db, coins } = walletDb();
  assert.throws(() => runOnce(db, 'op-1', () => {
    db.prepare('UPDATE wallet SET coins = coins + 100 WHERE id = ?').run('u1');
    throw new Error('item grant failed');
  }), /item grant failed/);
  assert.equal(coins(), 0, 'coins must be rolled back');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM processed_operations').get().n, 0);

  // The same key can be retried successfully after a failure.
  const retry = runOnce(db, 'op-1', () => {
    db.prepare('UPDATE wallet SET coins = coins + 100 WHERE id = ?').run('u1');
  });
  assert.equal(retry.applied, true);
  assert.equal(coins(), 100);
});

test('database constraints reject negative balances', () => {
  const { db, coins } = walletDb();
  assert.throws(() => runOnce(db, 'overspend', () => {
    db.prepare('UPDATE wallet SET coins = coins - 1 WHERE id = ?').run('u1');
  }), /CHECK constraint/);
  assert.equal(coins(), 0);
});

test('runOnce requires a key', () => {
  const { db } = walletDb();
  assert.throws(() => runOnce(db, '', () => {}), /operation key/);
});
