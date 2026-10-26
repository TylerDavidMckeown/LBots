import path from 'node:path';
import dotenv from 'dotenv';

/** Loads `<botDir>/.env`. Variables already set in the environment take precedence. */
export function loadEnv(rootDir) {
  dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });
}

export function missingEnv(names, env = process.env) {
  return names.filter((name) => !env[name]?.trim());
}

/** OWNER_ID may hold one ID or a comma-separated list. */
export function ownerIdsFromEnv(env = process.env) {
  return (env.OWNER_ID ?? '').split(',').map((id) => id.trim()).filter((id) => /^\d{17,20}$/.test(id));
}
