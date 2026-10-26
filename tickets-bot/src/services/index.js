import { createCommissionService } from './commissionService.js';
import { createTicketService } from './ticketService.js';

const cache = new WeakMap();

/** Services bound to this bot's database, created once per process. */
export function getServices(ctx) {
  let services = cache.get(ctx.db);
  if (!services) {
    services = { tickets: createTicketService(ctx.db), commissions: createCommissionService(ctx.db) };
    cache.set(ctx.db, services);
  }
  return services;
}
