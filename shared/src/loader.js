import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTier } from './permissions.js';

/**
 * Imports every `.js` file under `dir` (recursively, sorted). Files starting with `_`
 * and test files are skipped. Each file's default export may be one module or an array.
 * @returns {Promise<{ file: string, value: object }[]>}
 */
export async function importDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await importDir(full));
    } else if (entry.name.endsWith('.js') && !entry.name.startsWith('_') && !entry.name.endsWith('.test.js')) {
      const mod = await import(pathToFileURL(full).href);
      if (mod.default === undefined) continue;
      for (const value of [mod.default].flat()) results.push({ file: full, value });
    }
  }
  return results;
}

function fail(file, message) {
  throw new Error(`${path.basename(file)}: ${message}`);
}

export function validateCommand(command, file = 'command') {
  if (!command?.data?.name || typeof command.data.toJSON !== 'function') fail(file, 'command needs a SlashCommandBuilder in `data`');
  if (typeof command.execute !== 'function') fail(file, 'command needs an `execute` function');
  parseTier(command.tier ?? 'member');
  for (const tier of Object.values(command.subcommandTiers ?? {})) parseTier(tier);
  return command;
}

export function validateComponent(component, file = 'component') {
  if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(component?.id ?? '')) fail(file, 'component `id` must look like "feature:action"');
  if (typeof component.execute !== 'function') fail(file, 'component needs an `execute` function');
  parseTier(component.tier ?? 'member');
  return component;
}

export function validateEvent(event, file = 'event') {
  if (!event?.name) fail(file, 'event needs a `name`');
  if (typeof event.execute !== 'function') fail(file, 'event needs an `execute` function');
  return event;
}

export function validateJob(job, file = 'job') {
  if (!job?.type) fail(file, 'job needs a `type`');
  if (typeof job.execute !== 'function') fail(file, 'job needs an `execute` function');
  if (job.every !== undefined && !(Number.isFinite(job.every) && job.every >= 60_000)) fail(file, '`every` must be at least 60000 ms');
  return job;
}

/**
 * Merges modules into a Map keyed by `keyOf`. Later sources override earlier ones,
 * which lets a bot replace a shared built-in; duplicates within one source throw.
 */
export function mergeByKey(sources, keyOf) {
  const map = new Map();
  for (const source of sources) {
    const seen = new Set();
    for (const { file, value } of source) {
      const key = keyOf(value);
      if (seen.has(key)) fail(file, `duplicate definition for "${key}"`);
      seen.add(key);
      map.set(key, value);
    }
  }
  return map;
}

export async function loadCommands(dir) {
  return (await importDir(dir)).map(({ file, value }) => ({ file, value: validateCommand(value, file) }));
}

export async function loadComponents(dir) {
  return (await importDir(dir)).map(({ file, value }) => ({ file, value: validateComponent(value, file) }));
}

export async function loadEvents(dir) {
  return (await importDir(dir)).map(({ file, value }) => validateEvent(value, file));
}

export async function loadJobs(dir) {
  return (await importDir(dir)).map(({ file, value }) => validateJob(value, file));
}
