import { getServices } from '../services/index.js';
import { deleteTicket } from '../services/ticketActions.js';

/** Deletes a closed ticket's channel once its retention period ends. */
export default {
  type: 'ticket:delete',
  async execute({ ticketId, closedAt }, task, ctx) {
    const ticket = getServices(ctx).tickets.get(ticketId);
    // Skip if the ticket was reopened (or closed again later, which schedules its own job).
    if (!ticket || ticket.status !== 'closed' || ticket.closed_at !== closedAt) return;
    await deleteTicket(ctx, ticket, null, 'Retention period ended');
  },
};
