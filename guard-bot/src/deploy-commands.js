// Usage: npm run deploy [-- --global] [-- --clear]
import { fileURLToPath } from 'node:url';
import { deployCommands } from '@lyss/shared/deploy.js';
import config from './config.js';

await deployCommands({ rootDir: fileURLToPath(new URL('..', import.meta.url)), config });
