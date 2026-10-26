import { ChannelType, OverwriteType, PermissionFlagsBits as P, RESTJSONErrorCodes } from 'discord.js';
import { runOnce } from '@lyss/shared/db.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { caseEmbed, dmEmbed } from '../embeds/caseEmbeds.js';
import { escalationFor, MAX_TIMEOUT_MS, parseEscalation } from './caseService.js';
import { getServices } from './index.js';
import { sendLog } from './logService.js';

/**
 * Moderation actions. Each one validates, performs the Discord action, then records a
 * numbered case and posts it to the moderation log. The Discord action comes first,
 * so a case is never recorded for something that did not happen.
 */

export const actorOf = (user) => ({ id: user.id, tag: user.tag });
export const botActor = (ctx) => actorOf(ctx.client.user);

const auditReason = (actor, reason) => truncate(`${actor.tag}: ${reason || 'No reason provided'}`, 512);

/** Turns Discord permission failures into a clear message instead of an error reference. */
async function attempt(action, what) {
  try {
    return await action();
  } catch (error) {
    if (error.code === RESTJSONErrorCodes.MissingPermissions || error.code === RESTJSONErrorCodes.MissingAccess) {
      throw new UserError(`I do not have permission to ${what}. Check my role position and permissions with \`/setup check\`.`, { title: 'Missing permissions' });
    }
    throw error;
  }
}

export async function recordCase(ctx, guild, data) {
  const { cases } = getServices(ctx);
  const related = data.relatedCaseId ? cases.getById(data.relatedCaseId) : null;
  const metadata = related ? { ...data.metadata, relatedNumber: related.number } : data.metadata;
  const created = cases.create({ guildId: guild.id, ...data, metadata });
  const message = await sendLog(ctx, guild, 'moderation', { embeds: [caseEmbed(ctx, created)] });
  if (message) cases.setLogMessage(created.id, message.channelId, message.id);
  ctx.logger.info('Moderation case', { guildId: guild.id, case: created.number, action: created.action, target: created.target_id, moderator: created.moderator_id });
  return created;
}

async function notify(ctx, guild, user, action, reason, durationMs) {
  if (!ctx.guildConfig.get(guild.id, 'guard.dmTargets')) return false;
  try {
    await user.send({ embeds: [dmEmbed(ctx, guild, action, reason, durationMs)] });
    return true;
  } catch {
    return false; // DMs closed.
  }
}

export async function timeout(ctx, guild, actor, member, durationMs, reason, { source = 'manual', relatedCaseId = null } = {}) {
  if (!(durationMs >= 60_000 && durationMs <= MAX_TIMEOUT_MS)) throw new UserError('Timeouts must be between 1 minute and 28 days.', { title: 'Invalid duration' });
  if (!member.moderatable) throw new UserError(`I cannot time out ${member}. Their role may be above mine, or I am missing Timeout Members.`, { title: 'Cannot time out' });
  await notify(ctx, guild, member.user, 'timeout', reason, durationMs);
  await attempt(() => member.timeout(durationMs, auditReason(actor, reason)), 'time out members');
  return recordCase(ctx, guild, {
    action: 'timeout', targetId: member.id, moderatorId: actor.id, reason, durationMs, expiresAt: Date.now() + durationMs, source, relatedCaseId,
  });
}

/** Applies the configured escalation once per warning. */
async function escalate(ctx, guild, member, warnCase) {
  const rules = parseEscalation(ctx.guildConfig.get(guild.id, 'guard.escalation'));
  if (!rules) {
    ctx.logger.warn('Invalid warning escalation configuration', { guildId: guild.id });
    return null;
  }
  const active = getServices(ctx).cases.activeWarnings(guild.id, warnCase.target_id).length;
  const rule = escalationFor(rules, active);
  if (!rule || !member?.moderatable) return null;
  // Claim the escalation first so retries or duplicate events can never apply it twice.
  if (!runOnce(ctx.db, `guard:escalation:${warnCase.id}`, () => ({ count: rule.count })).applied) return null;
  const reason = `Automatic: reached ${rule.count} active warnings`;
  return { rule, case: await timeout(ctx, guild, botActor(ctx), member, rule.durationMs, reason, { source: 'escalation', relatedCaseId: warnCase.id }) };
}

export async function warn(ctx, guild, actor, user, reason, { member = null, source = 'manual' } = {}) {
  const expiry = ctx.guildConfig.get(guild.id, 'guard.warningExpiry');
  await notify(ctx, guild, user, 'warn', reason);
  const warnCase = await recordCase(ctx, guild, {
    action: 'warn', targetId: user.id, moderatorId: actor.id, reason, expiresAt: Date.now() + expiry, source,
  });
  // Anti-spam has its own escalation, so only manual warnings trigger warning escalation.
  const escalation = source === 'manual' ? await escalate(ctx, guild, member, warnCase) : null;
  return { warnCase, escalation };
}

export async function unwarn(ctx, guild, actor, number, reason) {
  const revoked = getServices(ctx).cases.revokeWarning(guild.id, number, { by: actor.id, reason });
  const record = await recordCase(ctx, guild, {
    action: 'unwarn', targetId: revoked.target_id, moderatorId: actor.id, reason, relatedCaseId: revoked.id,
  });
  return { revoked, record };
}

export async function untimeout(ctx, guild, actor, member, reason) {
  if (!member.isCommunicationDisabled()) throw new UserError(`${member} is not timed out.`, { title: 'Not timed out' });
  if (!member.moderatable) throw new UserError(`I cannot change ${member}'s timeout. Their role may be above mine.`, { title: 'Cannot remove timeout' });
  await attempt(() => member.timeout(null, auditReason(actor, reason)), 'remove timeouts');
  return recordCase(ctx, guild, { action: 'untimeout', targetId: member.id, moderatorId: actor.id, reason });
}

export async function kick(ctx, guild, actor, member, reason) {
  if (!member.kickable) throw new UserError(`I cannot kick ${member}. Their role may be above mine, or I am missing Kick Members.`, { title: 'Cannot kick' });
  // DM before kicking: afterwards the member may share no server with the bot.
  await notify(ctx, guild, member.user, 'kick', reason);
  await attempt(() => member.kick(auditReason(actor, reason)), 'kick members');
  return recordCase(ctx, guild, { action: 'kick', targetId: member.id, moderatorId: actor.id, reason });
}

async function isBanned(guild, userId) {
  return Boolean(await guild.bans.fetch({ user: userId, force: true }).catch(() => null));
}

/** Bans permanently, or temporarily when `durationMs` is given (an unban job is scheduled). */
export async function ban(ctx, guild, actor, user, reason, { deleteMessageSeconds = 0, durationMs = null } = {}) {
  if (await isBanned(guild, user.id)) throw new UserError(`${user} is already banned.`, { title: 'Already banned' });
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member && !member.bannable) throw new UserError(`I cannot ban ${member}. Their role may be above mine, or I am missing Ban Members.`, { title: 'Cannot ban' });
  const action = durationMs ? 'tempban' : 'ban';
  if (member) await notify(ctx, guild, user, action, reason, durationMs);
  await attempt(() => guild.members.ban(user.id, { reason: auditReason(actor, reason), deleteMessageSeconds }), 'ban members');
  const created = await recordCase(ctx, guild, {
    action, targetId: user.id, moderatorId: actor.id, reason, durationMs, expiresAt: durationMs ? Date.now() + durationMs : null,
  });
  if (durationMs) {
    ctx.scheduler.schedule('guard:unban', created.expires_at, { guildId: guild.id, userId: user.id, caseId: created.id }, { dedupeKey: `tempban:${created.id}` });
  }
  return created;
}

export async function unban(ctx, guild, actor, userId, reason, { source = 'manual', relatedCaseId = null } = {}) {
  if (!await isBanned(guild, userId)) throw new UserError(`<@${userId}> is not banned.`, { title: 'Not banned' });
  await attempt(() => guild.members.unban(userId, auditReason(actor, reason)), 'unban members');
  return recordCase(ctx, guild, { action: 'unban', targetId: userId, moderatorId: actor.id, reason, source, relatedCaseId });
}

const BULK_DELETE_MAX_AGE = 14 * 86_400_000 - 60_000;

/** Deletes up to `amount` recent messages (optionally from one member). Pinned messages are kept. */
export async function purge(ctx, guild, actor, channel, amount, { user = null, reason = null } = {}) {
  const fetched = await attempt(() => channel.messages.fetch({ limit: 100 }), 'read this channel');
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE;
  const candidates = [...fetched.values()]
    .filter((m) => !m.pinned && m.createdTimestamp > cutoff && (!user || m.author.id === user.id))
    .slice(0, amount);
  if (!candidates.length) throw new UserError('There are no messages to delete. Only messages from the last 14 days can be purged.', { title: 'Nothing to delete' });
  const deleted = await attempt(() => channel.bulkDelete(candidates.map((m) => m.id), true), 'delete messages here');
  return recordCase(ctx, guild, {
    action: 'purge', channelId: channel.id, targetId: user?.id ?? null, moderatorId: actor.id, reason, metadata: { count: deleted.size },
  });
}

export async function slowmode(ctx, guild, actor, channel, seconds, reason) {
  if (!('setRateLimitPerUser' in channel)) throw new UserError('Slowmode can only be set on text channels and threads.', { title: 'Unsupported channel' });
  await attempt(() => channel.setRateLimitPerUser(seconds, auditReason(actor, reason)), 'edit this channel');
  return recordCase(ctx, guild, { action: 'slowmode', channelId: channel.id, moderatorId: actor.id, reason, durationMs: seconds * 1000 });
}

const LOCK_PERMISSIONS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];

export function isLocked(channel) {
  return Boolean(channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(P.SendMessages));
}

/** Locks or unlocks a channel for @everyone. Roles with an explicit Send Messages allow are unaffected. */
export async function setLocked(ctx, guild, actor, channel, locked, reason) {
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice].includes(channel.type)) {
    throw new UserError('Only text, announcement, forum and voice channels can be locked.', { title: 'Unsupported channel' });
  }
  if (isLocked(channel) === locked) throw new UserError(`${channel} is already ${locked ? 'locked' : 'unlocked'}.`, { title: 'No change' });
  const overwrite = Object.fromEntries(LOCK_PERMISSIONS.map((name) => [name, locked ? false : null]));
  await attempt(() => channel.permissionOverwrites.edit(guild.roles.everyone, overwrite, { type: OverwriteType.Role, reason: auditReason(actor, reason) }), 'edit channel permissions');
  return recordCase(ctx, guild, { action: locked ? 'lock' : 'unlock', channelId: channel.id, moderatorId: actor.id, reason });
}
