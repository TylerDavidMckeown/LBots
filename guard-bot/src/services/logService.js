import { PermissionFlagsBits } from 'discord.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';

const CATEGORY_CHANNELS = Object.freeze({
  member: 'channel.memberLog',
  message: 'channel.messageLog',
  server: 'channel.serverLog',
  moderation: 'channel.modLog',
});

export const LOG_CATEGORIES = Object.freeze({
  member: 'Joins, leaves, nicknames and roles',
  message: 'Message edits and deletions',
  server: 'Channels, roles and bans made outside the bot',
  moderation: 'Moderation cases and anti-spam actions',
});

/** The channel a log category posts to: its own channel, else the shared one. Null when disabled. */
export function logChannelId(ctx, guildId, category) {
  if (!ctx.guildConfig.get(guildId, `logs.${category}`)) return null;
  return ctx.guildConfig.get(guildId, CATEGORY_CHANNELS[category]) ?? ctx.guildConfig.get(guildId, 'channel.sharedLog') ?? null;
}

export function allLogChannelIds(ctx, guildId) {
  return [...Object.values(CATEGORY_CHANNELS), 'channel.sharedLog'].map((key) => ctx.guildConfig.get(guildId, key)).filter(Boolean);
}

/** Message logging skips ignored channels and the log channels themselves. */
export function isIgnoredChannel(ctx, guildId, ...channelIds) {
  const ignored = [...(ctx.guildConfig.get(guildId, 'logs.ignoredChannels') ?? []), ...allLogChannelIds(ctx, guildId)];
  return channelIds.some((id) => id && ignored.includes(id));
}

export async function sendLog(ctx, guild, category, payload) {
  const channelId = logChannelId(ctx, guild.id, category);
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? await ctx.client.channels.fetch(channelId).catch(() => null);
  return safeSend(channel, payload, { logger: ctx.logger });
}

// Deletions made by anti-spam are logged as moderation actions, not as individual message deletions.
const suppressed = new Map();
export function suppressDeleteLogs(messageIds, ms = 60_000) {
  const until = Date.now() + ms;
  for (const id of messageIds) suppressed.set(id, until);
  if (suppressed.size > 5_000) for (const [id, t] of suppressed) if (t < Date.now()) suppressed.delete(id);
}
export function isDeleteSuppressed(messageId) {
  const until = suppressed.get(messageId);
  return Boolean(until && until > Date.now());
}

/**
 * Finds who performed a recent action from the audit log. Returns null when the bot
 * lacks View Audit Log or no matching entry exists within `withinMs`.
 * @returns {Promise<{ executorId: string, reason: string | null } | null>}
 */
export async function findExecutor(guild, type, { targetId, withinMs = 10_000, match } = {}) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find((e) => (!targetId || e.targetId === targetId)
      && Date.now() - e.createdTimestamp < withinMs
      && (!match || match(e)));
    return entry ? { executorId: entry.executorId, reason: entry.reason ?? null } : null;
  } catch {
    return null;
  }
}
