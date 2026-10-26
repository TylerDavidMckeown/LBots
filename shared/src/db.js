import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export const SHARED_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Opens a bot database, applies pragmas and runs migrations.
 * @param {string} file Path to the SQLite file, or ':memory:'.
 * @param {{ migrations?: { namespace: string, dir: string }[], logger?: object }} options
 */
export function openDatabase(file, { migrations = [], logger } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  const applied = runMigrations(db, [{ namespace: 'shared', dir: SHARED_MIGRATIONS_DIR }, ...migrations]);
  for (const id of applied) logger?.info('Applied migration', { migration: id });
  return db;
}

/**
 * Applies every unapplied `.sql` file in each directory, in filename order.
 * Each migration runs in its own transaction, so a failure leaves the schema unchanged.
 * Migration IDs are namespaced so shared and bot migrations never collide.
 * @returns {string[]} IDs of the migrations applied by this call.
 */
export function runMigrations(db, sources) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const isApplied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const markApplied = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  const applied = [];

  for (const { namespace, dir } of sources) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const id = `${namespace}/${file}`;
      if (isApplied.get(id)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        markApplied.run(id, Date.now());
      })();
      applied.push(id);
    }
  }
  return applied;
}

/**
 * Runs `fn` inside a transaction exactly once per `key`.
 * If the key was already processed, `fn` is not called and the stored result is returned.
 * Use this for every reward, settlement or scheduled grant so retries and
 * double-clicks can never apply the same operation twice.
 * @returns {{ applied: boolean, result: any }}
 */
export function runOnce(db, key, fn) {
  if (!key) throw new Error('runOnce requires an operation key');
  return db.transaction(() => {
    const existing = db.prepare('SELECT result FROM processed_operations WHERE key = ?').get(key);
    if (existing) return { applied: false, result: existing.result === null ? null : JSON.parse(existing.result) };
    const result = fn();
    db.prepare('INSERT INTO processed_operations (key, result, created_at) VALUES (?, ?, ?)')
      .run(key, result === undefined ? null : JSON.stringify(result), Date.now());
    return { applied: true, result: result ?? null };
  }).immediate();
}

export function healthCheck(db) {
  try {
    const result = db.pragma('quick_check', { simple: true });
    const migrations = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
    return { ok: result === 'ok', detail: result, migrations };
  } catch (error) {
    return { ok: false, detail: error.message, migrations: 0 };
  }
}
