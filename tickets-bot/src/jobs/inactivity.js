import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { inactivityReminder } from '../embeds/ticketEmbeds.js';
import { getServices } from '../services/index.js';
import { closeTicket } from '../services/ticketActions.js';
import { ticketType } from '../services/ticketTypes.js';

/**
 * Decides what to do with an open ticket. Pure, so the timing rules can be tested.
 * @returns {'remind' | 'close' | null}
 */
export function inactivityAction(ticket, { now, reminderMs, closeMs, autoClose }) {
  if (!ticketType(ticket.type).inactivity) return null;
  if (!ticket.reminded_at) return now - ticket.last_activity_at >= reminderMs ? 'remind' : null;
  const quietSinceReminder = ticket.last_activity_at <= ticket.reminded_at;
  return autoClose && quietSinceReminder && now - ticket.reminded_at >= closeMs ? 'close' : null;
}

export default {
  type: 'tickets:inactivity',
  every: 10 * 60_000,
  async execute(payload, task, ctx) {
    const { tickets } = getServices(ctx);
    const now = Date.now();
    for (const ticket of tickets.listOpen()) {
      try {
        const settings = {
          now,
          reminderMs: ctx.guildConfig.get(ticket.guild_id, 'tickets.inactivityReminder'),
          closeMs: ctx.guildConfig.get(ticket.guild_id, 'tickets.inactivityClose'),
          autoClose: ctx.guildConfig.get(ticket.guild_id, 'tickets.autoClose'),
        };
        const action = inactivityAction(ticket, settings);
        if (action === 'remind' && tickets.markReminded(ticket.id, now)) {
          const channel = await ctx.client.channels.fetch(ticket.channel_id).catch(() => null);
          await safeSend(channel, inactivityReminder(ctx, ticket, settings.autoClose ? now + settings.closeMs : null), { logger: ctx.logger });
        } else if (action === 'close') {
          await closeTicket(ctx, ticket, { actorId: ctx.client.user.id, reason: 'Closed automatically after a period of inactivity.' });
        }
      } catch (error) {
        await ctx.errors.report(error, { source: 'job:tickets:inactivity', guildId: ticket.guild_id, channelId: ticket.channel_id });
      }
    }
  },
};
