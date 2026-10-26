import { fileURLToPath } from 'node:url';
import { startBot } from '@lyss/shared/bootstrap.js';
import config from './config.js';

await startBot({ rootDir: fileURLToPath(new URL('..', import.meta.url)), config });
