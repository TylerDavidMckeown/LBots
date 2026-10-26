// Manual backup of every bot database using SQLite's online backup API.
// Safe to run while the bots are online. Usage: npm run backup
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { backupDatabase } from '@lyss/shared/backup.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const backupRoot = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
const keep = Number(process.env.BACKUP_KEEP) || 14;
const BOTS = { 'tickets-bot': 'tickets', 'guard-bot': 'guard', 'community-bot': 'community', 'ai-bot': 'ai' };

let failed = false;
for (const [dir, namespace] of Object.entries(BOTS)) {
  const file = path.join(root, dir, 'data', `${namespace}.db`);
  if (!fs.existsSync(file)) {
    console.log(`- ${dir}: no database yet, skipped`);
    continue;
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const out = await backupDatabase(db, path.join(backupRoot, namespace), { prefix: namespace, keep });
    console.log(`✓ ${dir}: ${path.relative(root, out)}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${dir}: ${error.message}`);
  } finally {
    db.close();
  }
}
process.exitCode = failed ? 1 : 0;
