import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { getServices } from './index.js';
import { ticketType } from './ticketTypes.js';

function roleIdsOf(member) {
  if (!member?.roles) return [];
  if (member.roles.cache) return [...member.roles.cache.keys()];
  return Array.isArray(member.roles) ? member.roles : [];
}

/** Configured role IDs that should be able to see tickets of this type. */
export function viewerRoleIds(ctx, guildId, typeKey) {
  return [...new Set(ticketType(typeKey).viewerRoleKeys.map((key) => ctx.guildConfig.get(guildId, key)).filter(Boolean))];
}

/**
 * Whether the interacting member may manage tickets of this type
 * (claim, add members, close any ticket, reopen, delete).
 * Owners handle everything; support is open to Staff and above; contact and
 * commission tickets are limited to their configured role so they stay private.
 */
export function isTicketHandler(ctx, interaction, typeKey) {
  const type = ticketType(typeKey);
  const tier = ctx.permissions.tierOf(interaction);
  if (tier >= Tier.OWNER) return true;
  if (type.staffTierAccess && tier >= Tier.STAFF) return true;
  const roles = roleIdsOf(interaction.member);
  return type.handlerRoleKeys.some((key) => {
    const roleId = ctx.guildConfig.get(interaction.guildId, key);
    return roleId && roles.includes(roleId);
  });
}

export function requireHandler(ctx, interaction, typeKey) {
  if (!isTicketHandler(ctx, interaction, typeKey)) {
    throw new UserError(`Only the ${ticketType(typeKey).label.toLowerCase()} team can do this.`, { title: 'Missing permission' });
  }
}

/** The ticket for the current channel, or a friendly error. */
export function requireTicketInChannel(ctx, interaction, { statuses = ['open', 'closed'] } = {}) {
  const ticket = getServices(ctx).tickets.getByChannel(interaction.channelId);
  if (!ticket) throw new UserError('Use this command inside a ticket channel.', { title: 'Not a ticket' });
  if (!statuses.includes(ticket.status)) throw new UserError(`This ticket is ${ticket.status}.`, { title: 'Ticket unavailable' });
  return ticket;
}

/** A ticket referenced by a button. Buttons on deleted tickets behave as expired. */
export function requireTicketById(ctx, rawId) {
  const ticket = getServices(ctx).tickets.get(Number(rawId));
  if (!ticket || ticket.status === 'deleted') throw new UserError('This ticket no longer exists.', { title: 'This has expired' });
  return ticket;
}

export function requireCommissionInChannel(ctx, interaction) {
  const commission = getServices(ctx).commissions.getByChannel(interaction.channelId);
  if (!commission) throw new UserError('Use this inside a commission ticket.', { title: 'Not a commission' });
  return commission;
}
