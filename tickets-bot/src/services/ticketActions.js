import { AttachmentBuilder, ChannelType, OverwriteType, PermissionFlagsBits as P, RESTJSONErrorCodes } from 'discord.js';
import { ownerIdsFromEnv } from '@lyss/shared/env.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { closedMessage, logEmbed, welcomeMessage } from '../embeds/ticketEmbeds.js';
import { viewerRoleIds } from './access.js';
import { getServices } from './index.js';
import { assertCommissionsAvailable, refreshPanel } from './panelService.js';
import { formatTicketNumber, ticketLabel, ticketType } from './ticketTypes.js';
import { buildTranscript } from './transcriptService.js';

const OPENER_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const HANDLER_ALLOW = [...OPENER_ALLOW, P.ManageMessages];
const BOT_ALLOW = [...HANDLER_ALLOW, P.ManageChannels];

export const deleteJobKey = (ticket) => `ticket:delete:${ticket.id}:${ticket.closed_at}`;

/** Checks run before showing the open-ticket form and again before creating the channel. */
export function assertCanOpen(ctx, guildId, userId, typeKey) {
  const { tickets } = getServices(ctx);
  const type = ticketType(typeKey);
  const blacklisted = tickets.isBlacklisted(guildId, userId);
  if (blacklisted) {
    throw new UserError(`You are not able to open tickets in this server.${blacklisted.reason ? `\n**Reason:** ${blacklisted.reason}` : ''}`, { title: 'Tickets unavailable' });
  }
  const existing = tickets.findOpen(guildId, userId, typeKey);
  if (existing) {
    const where = existing.channel_id ? `: <#${existing.channel_id}>` : '. It is still being created.';
    throw new UserError(`You already have an open ${type.label.toLowerCase()} ticket${where}`, { title: 'Ticket already open' });
  }
  if (typeKey === 'commissions') assertCommissionsAvailable(ctx, guildId);
}

async function buildOverwrites(ctx, guild, type, openerId) {
  const overwrites = [
    { id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: ctx.client.user.id, type: OverwriteType.Member, allow: BOT_ALLOW },
    { id: openerId, type: OverwriteType.Member, allow: OPENER_ALLOW },
  ];
  for (const roleId of viewerRoleIds(ctx, guild.id, type.key)) {
    if (guild.roles.cache.has(roleId)) overwrites.push({ id: roleId, type: OverwriteType.Role, allow: HANDLER_ALLOW });
  }
  if (type.includeOwners) {
    for (const ownerId of ownerIdsFromEnv()) {
      if (ownerId === openerId || ownerId === ctx.client.user.id) continue;
      // Overwrites can only target current members.
      if (await guild.members.fetch(ownerId).catch(() => null)) {
        overwrites.push({ id: ownerId, type: OverwriteType.Member, allow: HANDLER_ALLOW });
      }
    }
  }
  return overwrites;
}

export async function logTicketEvent(ctx, ticket, action, actorId, extra) {
  const channelId = ctx.guildConfig.get(ticket.guild_id, 'channel.ticketLog');
  if (!channelId) return;
  const channel = await ctx.client.channels.fetch(channelId).catch(() => null);
  await safeSend(channel, { embeds: [logEmbed(ctx, ticket, action, actorId, extra)] }, { logger: ctx.logger });
}

/**
 * Creates a ticket: database reservation first (prevents duplicates), then the
 * private channel. If the channel cannot be created the reservation is released.
 * @param {{ subject?: string, commission?: object }} details
 */
export async function openTicket(ctx, interaction, typeKey, details = {}) {
  const { tickets, commissions } = getServices(ctx);
  const { guild, user } = interaction;
  const type = ticketType(typeKey);
  assertCanOpen(ctx, guild.id, user.id, typeKey);

  const categoryId = ctx.guildConfig.get(guild.id, type.categoryKey);
  const category = categoryId ? guild.channels.cache.get(categoryId) ?? await guild.channels.fetch(categoryId).catch(() => null) : null;
  if (category?.type !== ChannelType.GuildCategory) {
    throw new UserError(`${type.label} tickets are not set up yet. Please let a server admin know.`, { title: 'Tickets not set up' });
  }

  let commission = null;
  const reserved = tickets.reserve({
    guildId: guild.id,
    type: typeKey,
    openerId: user.id,
    subject: details.subject ?? null,
    onReserved: details.commission
      ? (ticket) => { commission = commissions.create({ ...details.commission, guildId: guild.id, ticketId: ticket.id, clientId: user.id }); }
      : undefined,
  });

  let channel;
  try {
    channel = await guild.channels.create({
      name: `${type.key}-${formatTicketNumber(reserved.number)}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `${ticketLabel(reserved)} · opened by ${user.tag} (${user.id})`,
      permissionOverwrites: await buildOverwrites(ctx, guild, type, user.id),
      reason: `${ticketLabel(reserved)} opened by ${user.tag}`,
    });
  } catch (error) {
    tickets.release(reserved.id);
    if (error.code === RESTJSONErrorCodes.MissingPermissions || error.code === RESTJSONErrorCodes.MissingAccess) {
      throw new UserError('I do not have permission to create the ticket channel. Please let a server admin know so they can run `/setup check`.', { title: 'Missing permissions' });
    }
    if (error.code === RESTJSONErrorCodes.MaximumNumberOfGuildChannelsReached || /maximum number of channels/i.test(error.message)) {
      throw new UserError('The ticket category is full. Please let a server admin know.', { title: 'Category full' });
    }
    throw error;
  }

  tickets.attachChannel(reserved.id, channel.id);
  const ticket = tickets.get(reserved.id);
  const mentionRoleIds = type.handlerRoleKeys.map((key) => ctx.guildConfig.get(guild.id, key)).filter(Boolean);
  await channel.send(welcomeMessage(ctx, ticket, { mentionRoleIds, commission }));
  ctx.logger.info('Ticket opened', { guildId: guild.id, ticketId: ticket.id, type: typeKey, userId: user.id });
  await logTicketEvent(ctx, ticket, 'opened', user.id, { Subject: ticket.subject });
  return { ticket, channel, commission };
}

async function fetchTicketChannel(ctx, ticket) {
  if (!ticket.channel_id) return null;
  return ctx.client.channels.fetch(ticket.channel_id).catch(() => null);
}

async function setSendPermission(ctx, channel, ticket, allowed) {
  const userIds = [ticket.opener_id, ...getServices(ctx).tickets.members(ticket.id).map((m) => m.user_id)];
  for (const userId of userIds) {
    await channel.permissionOverwrites.edit(userId, { SendMessages: allowed }, { type: OverwriteType.Member })
      .catch((error) => ctx.logger.warn('Could not update ticket permissions', { ticketId: ticket.id, userId, error: error.message }));
  }
}

async function sendTranscript(ctx, guild, ticket, transcript) {
  const { tickets } = getServices(ctx);
  let url = null;
  const transcriptChannelId = ctx.guildConfig.get(guild.id, 'channel.transcripts');
  if (transcriptChannelId) {
    const channel = await ctx.client.channels.fetch(transcriptChannelId).catch(() => null);
    const message = await safeSend(channel, {
      embeds: [logEmbed(ctx, ticket, 'closed', ticket.closed_by, { Reason: ticket.close_reason, Messages: transcript.messageCount })],
      files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })],
    }, { logger: ctx.logger });
    url = message?.url ?? null;
  }
  tickets.setTranscript(ticket.id, transcript.filePath, url);

  if (ctx.guildConfig.get(guild.id, 'tickets.dmTranscripts')) {
    const user = await ctx.client.users.fetch(ticket.opener_id).catch(() => null);
    await user?.send({
      content: `Here is the transcript of your ${ticketLabel(ticket).toLowerCase()} in **${guild.name}**.`,
      files: [new AttachmentBuilder(Buffer.from(transcript.html), { name: transcript.fileName })],
    }).catch(() => null); // DMs may be closed; that is fine.
  }
}

/**
 * Closes a ticket exactly once: locks the channel, saves the transcript, posts the
 * closed message and schedules deletion after the retention period.
 */
export async function closeTicket(ctx, ticket, { actorId, reason = null }) {
  const { tickets } = getServices(ctx);
  if (!tickets.close(ticket.id, { by: actorId, reason })) {
    throw new UserError('This ticket is already closed.', { title: 'Already closed' });
  }
  const closed = tickets.get(ticket.id);
  // Schedule deletion first so a crash below can never leave a closed ticket forever.
  const deleteAt = closed.closed_at + ctx.guildConfig.get(closed.guild_id, 'tickets.retention');
  ctx.scheduler.schedule('ticket:delete', deleteAt, { ticketId: closed.id, closedAt: closed.closed_at }, { dedupeKey: deleteJobKey(closed) });

  const guild = await ctx.client.guilds.fetch(closed.guild_id);
  const channel = await fetchTicketChannel(ctx, closed);
  let transcript = null;
  if (channel) {
    await setSendPermission(ctx, channel, closed, false);
    try {
      transcript = await buildTranscript(ctx, guild, channel, closed);
      await sendTranscript(ctx, guild, closed, transcript);
    } catch (error) {
      // The ticket still closes; staff can find the reference in the error log.
      await ctx.errors.report(error, { source: 'tickets:transcript', guildId: closed.guild_id, channelId: closed.channel_id });
    }
  }

  const type = ticketType(closed.type);
  const askRating = type.ratings && ctx.guildConfig.get(closed.guild_id, 'tickets.ratings');
  if (channel) await safeSend(channel, closedMessage(ctx, closed, { transcript, deleteAt, askRating }), { logger: ctx.logger });
  ctx.logger.info('Ticket closed', { guildId: closed.guild_id, ticketId: closed.id, by: actorId });
  await logTicketEvent(ctx, closed, 'closed', actorId, { Reason: reason });
  return closed;
}

export async function reopenTicket(ctx, ticket, actorId) {
  const { tickets } = getServices(ctx);
  const channel = await fetchTicketChannel(ctx, ticket);
  if (!channel) throw new UserError('The ticket channel no longer exists, so it cannot be reopened.', { title: 'Cannot reopen' });
  const previous = tickets.get(ticket.id);
  if (!tickets.reopen(ticket.id)) throw new UserError('This ticket is not closed.', { title: 'Not closed' });
  ctx.scheduler.cancel(deleteJobKey(previous));
  const reopened = tickets.get(ticket.id);
  await setSendPermission(ctx, channel, reopened, true);
  const kit = ctx.embeds.for(reopened.guild_id);
  await safeSend(channel, {
    content: `<@${reopened.opener_id}>`,
    embeds: [kit.success('Ticket reopened', `Reopened by <@${actorId}>. You can continue the conversation here.`)],
    allowedMentions: { users: [reopened.opener_id] },
  });
  await logTicketEvent(ctx, reopened, 'reopened', actorId);
  return reopened;
}

/** Deletes the channel (if it still exists) and marks the ticket deleted. Safe to repeat. */
export async function deleteTicket(ctx, ticket, actorId, reason = 'Ticket deleted') {
  const { tickets } = getServices(ctx);
  const channel = await fetchTicketChannel(ctx, ticket);
  if (channel) {
    try {
      await channel.delete(reason);
    } catch (error) {
      if (error.code !== RESTJSONErrorCodes.UnknownChannel) throw error;
    }
  }
  if (ticket.closed_at) ctx.scheduler.cancel(deleteJobKey(ticket));
  if (tickets.markDeleted(ticket.id)) {
    await logTicketEvent(ctx, tickets.get(ticket.id), 'deleted', actorId, { Reason: reason });
  }
}

/** Refreshes the commission panel counter; never throws. */
export async function refreshCommissionPanel(ctx, guildId) {
  await refreshPanel(ctx, guildId, 'commissions').catch(() => {});
}
