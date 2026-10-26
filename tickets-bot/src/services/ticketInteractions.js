import { MessageFlags } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { confirmRow } from '../embeds/ticketEmbeds.js';
import { isTicketHandler, requireHandler } from './access.js';
import { getServices } from './index.js';
import { closeTicket, logTicketEvent, reopenTicket } from './ticketActions.js';
import { ticketType } from './ticketTypes.js';

// Reply logic shared by the /ticket command and the ticket buttons.

export function assertCanClose(ctx, interaction, ticket) {
  if (ticket.status !== 'open') throw new UserError('This ticket is already closed.', { title: 'Already closed' });
  if (isTicketHandler(ctx, interaction, ticket.type)) return;
  if (ticketType(ticket.type).openerCanClose && interaction.user.id === ticket.opener_id) return;
  throw new UserError('Only the ticket team can close this ticket.', { title: 'Missing permission' });
}

export async function claim(ctx, interaction, ticket) {
  const { tickets } = getServices(ctx);
  if (ticket.status !== 'open') throw new UserError('Only open tickets can be claimed.', { title: 'Ticket closed' });
  requireHandler(ctx, interaction, ticket.type);
  if (!tickets.claim(ticket.id, interaction.user.id)) {
    const current = tickets.get(ticket.id);
    throw new UserError(
      current.claimed_by === interaction.user.id ? 'You have already claimed this ticket.' : `This ticket is already claimed by <@${current.claimed_by}>.`,
      { title: 'Already claimed' },
    );
  }
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.reply({ embeds: [kit.success('Ticket claimed', `${interaction.user} is now handling this ticket.`)] });
  await logTicketEvent(ctx, tickets.get(ticket.id), 'claimed', interaction.user.id);
}

export async function unclaim(ctx, interaction, ticket) {
  const { tickets } = getServices(ctx);
  if (ticket.status !== 'open') throw new UserError('Only open tickets can be unclaimed.', { title: 'Ticket closed' });
  requireHandler(ctx, interaction, ticket.type);
  if (!ticket.claimed_by) throw new UserError('This ticket is not claimed.', { title: 'Not claimed' });
  if (ticket.claimed_by !== interaction.user.id && ctx.permissions.tierOf(interaction) < Tier.ADMIN) {
    throw new UserError(`Only <@${ticket.claimed_by}> or an admin can unclaim this ticket.`, { title: 'Missing permission' });
  }
  tickets.unclaim(ticket.id);
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.reply({ embeds: [kit.info('Ticket unclaimed', `${interaction.user} released this ticket. Another team member can claim it.`)] });
  await logTicketEvent(ctx, tickets.get(ticket.id), 'unclaimed', interaction.user.id);
}

/** Closes and confirms privately. Works whether or not the interaction was already answered. */
export async function closeAndConfirm(ctx, interaction, ticket, reason = null) {
  assertCanClose(ctx, interaction, ticket);
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await closeTicket(ctx, ticket, { actorId: interaction.user.id, reason });
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.editReply({ embeds: [kit.success('Ticket closed', 'The ticket is closed and its transcript has been saved.')], components: [] });
}

export async function reopenAndConfirm(ctx, interaction, ticket) {
  if (ticket.status !== 'closed') throw new UserError('This ticket is not closed.', { title: 'Not closed' });
  requireHandler(ctx, interaction, ticket.type);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await reopenTicket(ctx, ticket, interaction.user.id);
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.editReply({ embeds: [kit.success('Ticket reopened', 'The opener can send messages again.')] });
}

/** Asks for confirmation before permanently deleting a closed ticket. */
export async function promptDelete(ctx, interaction, ticket) {
  requireHandler(ctx, interaction, ticket.type);
  if (ticket.status !== 'closed') throw new UserError('Close the ticket before deleting it, so a transcript is saved.', { title: 'Ticket still open' });
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.reply({
    embeds: [kit.warning('Delete this ticket?', 'The channel will be deleted permanently. The saved transcript is kept.')],
    components: [confirmRow(makeCustomId('tickets', 'ticket', 'deleteconfirm', ticket.id), 'Delete permanently')],
    flags: MessageFlags.Ephemeral,
  });
}
