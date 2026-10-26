import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { ticketLabel, ticketType } from '../services/ticketTypes.js';

const id = (...parts) => makeCustomId('tickets', ...parts);

export const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

function button(customId, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

export function openTicketRow(ticket) {
  return new ActionRowBuilder().addComponents(
    button(id('ticket', 'claim', ticket.id), 'Claim', ButtonStyle.Primary, '🙋'),
    button(id('ticket', 'close', ticket.id), 'Close', ButtonStyle.Danger, '🔒'),
    button(id('ticket', 'closereason', ticket.id), 'Close with reason', ButtonStyle.Secondary, '📝'),
  );
}

export function confirmRow(confirmId, confirmLabel) {
  return new ActionRowBuilder().addComponents(
    button(confirmId, confirmLabel, ButtonStyle.Danger),
    button(id('ticket', 'dismiss'), 'Cancel', ButtonStyle.Secondary),
  );
}

export function welcomeMessage(ctx, ticket, { mentionRoleIds = [], commission = null } = {}) {
  const type = ticketType(ticket.type);
  const kit = ctx.embeds.for(ticket.guild_id);
  const embed = kit.base({ title: `${type.emoji} ${ticketLabel(ticket)}`, description: type.welcome })
    .addFields(
      { name: 'Opened by', value: `<@${ticket.opener_id}>`, inline: true },
      { name: 'Opened', value: discordTimestamp(ticket.created_at, 'R'), inline: true },
    );
  if (ticket.subject) embed.addFields({ name: 'Subject', value: truncate(ticket.subject, 1024) });
  if (commission) {
    embed.addFields(
      { name: 'Project type', value: truncate(commission.project_type, 1024), inline: true },
      { name: 'Budget', value: truncate(commission.budget || 'Not specified', 1024), inline: true },
      { name: 'Deadline', value: truncate(commission.deadline || 'Flexible', 1024), inline: true },
      { name: 'Description', value: truncate(commission.description, 1024) },
    );
    if (commission.reference_links) embed.addFields({ name: 'References', value: truncate(commission.reference_links, 1024) });
  }
  return {
    content: [`<@${ticket.opener_id}>`, ...mentionRoleIds.map((r) => `<@&${r}>`)].join(' '),
    embeds: [embed],
    components: [openTicketRow(ticket)],
    allowedMentions: { users: [ticket.opener_id], roles: mentionRoleIds },
  };
}

/** Reopen / Delete for staff, plus an opener rating row until the ticket is rated. */
export function closedComponents(ticket, { askRating }) {
  const rows = [new ActionRowBuilder().addComponents(
    button(id('ticket', 'reopen', ticket.id), 'Reopen', ButtonStyle.Success, '🔓'),
    button(id('ticket', 'delete', ticket.id), 'Delete now', ButtonStyle.Danger, '🗑️'),
  )];
  if (askRating) {
    rows.push(new ActionRowBuilder().addComponents(
      [1, 2, 3, 4, 5].map((n) => button(id('ticket', 'rate', ticket.id, n), `${n} ★`, ButtonStyle.Secondary)),
    ));
  }
  return rows;
}

export function closedMessage(ctx, ticket, { transcript, deleteAt, askRating }) {
  const kit = ctx.embeds.for(ticket.guild_id);
  const lines = [`Closed by <@${ticket.closed_by}>.`];
  if (ticket.close_reason) lines.push(`**Reason:** ${truncate(ticket.close_reason, 1000)}`);
  if (askRating) lines.push('', `<@${ticket.opener_id}>, how did we do? Rate your experience below.`);
  const embed = kit.base({ title: '🔒 Ticket closed', description: lines.join('\n'), colour: kit.colours.secondary })
    .addFields(
      { name: 'Transcript', value: transcript ? `Saved (${transcript.messageCount} messages)` : 'Not available', inline: true },
      { name: 'Channel deleted', value: discordTimestamp(deleteAt, 'R'), inline: true },
    );
  return { embeds: [embed], components: closedComponents(ticket, { askRating }) };
}

export function inactivityReminder(ctx, ticket, closeAt) {
  const kit = ctx.embeds.for(ticket.guild_id);
  const text = closeAt
    ? `This ticket has been quiet for a while. Reply here to keep it open, or it will close automatically ${discordTimestamp(closeAt, 'R')}.`
    : 'This ticket has been quiet for a while. Reply here if you still need help.';
  return {
    content: `<@${ticket.opener_id}>`,
    embeds: [kit.warning('Are you still there?', text)],
    allowedMentions: { users: [ticket.opener_id] },
  };
}

const LOG_ACTIONS = {
  opened: { title: 'Ticket opened', emoji: '📬' },
  claimed: { title: 'Ticket claimed', emoji: '🙋' },
  unclaimed: { title: 'Ticket unclaimed', emoji: '↩️' },
  closed: { title: 'Ticket closed', emoji: '🔒' },
  reopened: { title: 'Ticket reopened', emoji: '🔓' },
  deleted: { title: 'Ticket deleted', emoji: '🗑️' },
  rated: { title: 'Ticket rated', emoji: '⭐' },
  member_added: { title: 'Member added', emoji: '➕' },
  member_removed: { title: 'Member removed', emoji: '➖' },
};

export function logEmbed(ctx, ticket, action, actorId, extra = {}) {
  const info = LOG_ACTIONS[action];
  const kit = ctx.embeds.for(ticket.guild_id);
  const embed = kit.base({ title: `${info.emoji} ${info.title}`, description: ticketLabel(ticket) })
    .addFields(
      { name: 'Ticket', value: ticket.channel_id && ticket.status !== 'deleted' ? `<#${ticket.channel_id}>` : `#${ticket.number}`, inline: true },
      { name: 'Opener', value: `<@${ticket.opener_id}>`, inline: true },
      { name: 'By', value: actorId ? `<@${actorId}>` : 'System', inline: true },
    );
  for (const [name, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') embed.addFields({ name, value: truncate(String(value), 1024) });
  }
  return embed;
}
