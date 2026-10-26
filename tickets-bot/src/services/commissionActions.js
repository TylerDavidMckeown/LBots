import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { reviewPrompt, statusChangeEmbed } from '../embeds/commissionEmbeds.js';
import { refreshCommissionPanel } from './ticketActions.js';

/** Posts in the commission's ticket channel, if it still exists. */
export async function postInCommission(ctx, commission, payload) {
  if (!commission.channel_id || commission.ticket_status === 'deleted') return null;
  const channel = await ctx.client.channels.fetch(commission.channel_id).catch(() => null);
  return safeSend(channel, payload, { logger: ctx.logger });
}

/** Best-effort DM. Members with closed DMs simply do not receive it. */
export async function dm(ctx, userId, payload) {
  try {
    const user = await ctx.client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch {
    return false;
  }
}

/** Tells the client about a status change in the ticket and by DM, and keeps the panel counter current. */
export async function notifyStatusChange(ctx, { from, to, commission }, actorId, note = null) {
  const embed = statusChangeEmbed(ctx, commission, from, to, actorId, note);
  await postInCommission(ctx, commission, {
    content: `<@${commission.client_id}>`,
    embeds: [embed],
    allowedMentions: { users: [commission.client_id] },
  });
  const guild = ctx.client.guilds.cache.get(commission.guild_id);
  await dm(ctx, commission.client_id, { content: `Your commission in **${guild?.name ?? 'the server'}** was updated.`, embeds: [embed] });
  if (to === 'completed') await postInCommission(ctx, commission, reviewPrompt(ctx, commission));
  await refreshCommissionPanel(ctx, commission.guild_id);
}
