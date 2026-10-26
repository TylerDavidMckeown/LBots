import fs from 'node:fs';
import path from 'node:path';
import { redactObject, redact } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 10 * 1024 * 1024;

// Rotates once at startup so a long-running deployment cannot fill the disk.
function rotateIfLarge(file) {
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // File does not exist yet.
  }
}

/**
 * Structured JSON-lines logger. Every entry is redacted before it is written.
 */
export function createLogger({ name, logDir, level = process.env.LOG_LEVEL ?? 'info', console: out = console }) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  let file = null;
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    file = path.join(logDir, `${name}.log`);
    rotateIfLarge(file);
  }

  const write = (lvl, msg, meta) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, bot: name, msg: redact(msg), ...redactObject(meta ?? {}) };
    const line = JSON.stringify(entry);
    (LEVELS[lvl] >= LEVELS.warn ? out.error : out.log)(line);
    if (file) fs.appendFile(file, `${line}\n`, () => {});
  };

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
