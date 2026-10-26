import { createCaseService } from './caseService.js';
import { createSpamDetector } from './spamDetector.js';
import { createAntispamStore, createMessageCache } from './stores.js';

const cache = new WeakMap();

/** Services bound to this bot's database, created once per process. */
export function getServices(ctx) {
  let services = cache.get(ctx.db);
  if (!services) {
    services = {
      cases: createCaseService(ctx.db),
      messages: createMessageCache(ctx.db),
      antispam: createAntispamStore(ctx.db),
      detector: createSpamDetector(),
    };
    cache.set(ctx.db, services);
  }
  return services;
}
