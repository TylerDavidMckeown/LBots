import { Events } from 'discord.js';
import { getServices } from '../services/index.js';
import { deleteJobKey, logTicketEvent } from '../services/ticketActions.js';

/** Keeps the database in sync when someone deletes a ticket channel by hand. */
export default {
  name: Events.ChannelDelete,
  async execute(channel, ctx) {
    const { tickets } = getServices(ctx);
    const ticket = tickets.getByChannel(channel.id);
    if (!ticket) return;
    if (ticket.closed_at) ctx.scheduler.cancel(deleteJobKey(ticket));
    if (tickets.markDeleted(ticket.id)) {
      await logTicketEvent(ctx, tickets.get(ticket.id), 'deleted', null, { Reason: 'Channel deleted manually' });
    }
  },
};
