// Offline sanity check: loads every bot's config and commands without connecting to Discord.
// Usage: npm run check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandPayload } from '@lyss/shared/deploy.js';
import { collectModules } from '@lyss/shared/modules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const BOTS = ['tickets-bot', 'guard-bot', 'community-bot', 'ai-bot'];
const REQUIRED = ['help', 'status', 'setup'];
let failed = false;

for (const dir of BOTS) {
  const rootDir = path.join(root, dir);
  try {
    const { default: config } = await import(path.join(rootDir, 'src', 'config.js'));
    const { commands, components } = await collectModules(rootDir, config);
    const payload = commandPayload(commands);
    const problems = [];
    for (const name of REQUIRED) if (!commands.has(name)) problems.push(`missing /${name}`);
    for (const json of payload) {
      const size = JSON.stringify(json).length;
      if (size > 8000) problems.push(`/${json.name} definition is ${size} bytes (Discord limit 8000)`);
    }
    if (payload.length > 100) problems.push(`${payload.length} top-level commands (Discord limit 100)`);
    if (problems.length) throw new Error(problems.join('; '));
    console.log(`✓ ${config.name.padEnd(16)} ${commands.size} commands, ${components.size} components, ${config.setupItems.length} settings`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${dir}: ${error.message}`);
  }
}
process.exitCode = failed ? 1 : 0;
