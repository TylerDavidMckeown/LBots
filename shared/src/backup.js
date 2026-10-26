import fs from 'node:fs';
import path from 'node:path';

/**
 * Creates a consistent copy of a live database with SQLite's online backup API
 * (safe while the bot is writing), then prunes old copies beyond `keep`.
 * @param {import('better-sqlite3').Database} db
 */
export async function backupDatabase(db, destDir, { prefix, keep = 14 } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(destDir, `${prefix}-${stamp}.db`);
  await db.backup(file);

  const old = fs.readdirSync(destDir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.db'))
    .sort()
    .reverse()
    .slice(keep);
  for (const name of old) fs.rmSync(path.join(destDir, name), { force: true });
  return file;
}
