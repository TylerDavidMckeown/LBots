import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { formatDuration, parseDuration } from '@lyss/shared/utils/time.js';

/** Helpers shared by the Lyss Community feature modules. */

export const cid = (...parts) => makeCustomId('community', ...parts);
export const EPHEMERAL = MessageFlags.Ephemeral;

/** The configured channel ID for `key`, or a friendly error naming the setting. */
export function requireChannelSetting(ctx, guildId, key, label) {
  const id = ctx.guildConfig.get(guildId, key);
  if (!id) throw new UserError(`The ${label} has not been set up yet. An admin can set it with \`/setup channel\`.`, { title: 'Not set up' });
  return id;
}

export async function fetchChannel(ctx, channelId) {
  if (!channelId) return null;
  return ctx.client.channels.fetch(channelId).catch(() => null);
}

/** Throws unless the bot can post embeds in the channel. */
export async function assertCanPost(channel, extra = []) {
  if (!channel?.isTextBased?.()) throw new UserError('That channel could not be found or is not a text channel.', { title: 'Invalid channel' });
  const me = channel.guild.members.me ?? await channel.guild.members.fetchMe();
  const needed = ['ViewChannel', 'SendMessages', 'EmbedLinks', ...extra];
  const missing = needed.filter((name) => !channel.permissionsFor(me)?.has(PermissionFlagsBits[name]));
  if (missing.length) throw new UserError(`I need ${missing.join(', ')} in ${channel} to do that.`, { title: 'Missing permissions' });
  return channel;
}

/** Parses a duration option with bounds, e.g. for giveaways and polls. */
export function readDuration(text, { min, max, label }) {
  const ms = parseDuration(text);
  if (!ms) throw new UserError('Use a duration such as 30m, 2h or 3d.', { title: 'Invalid duration' });
  if (ms < min || ms > max) throw new UserError(`${label} must be between ${formatDuration(min)} and ${formatDuration(max)}.`, { title: 'Invalid duration' });
  return ms;
}

/** "Rules: #rules" style lines from the configured link channels. */
export function linkLines(ctx, guildId) {
  const links = [
    ['📜 Rules', 'channel.rules'],
    ['ℹ️ Information', 'channel.info'],
    ['🎭 Roles', 'channel.roles'],
    ['🛟 Support', 'channel.support'],
  ];
  return links.map(([label, key]) => [label, ctx.guildConfig.get(guildId, key)]).filter(([, id]) => id).map(([label, id]) => `${label}: <#${id}>`);
}

/** Splits components into action rows of five. */
export function rowsOf(items, size = 5) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
