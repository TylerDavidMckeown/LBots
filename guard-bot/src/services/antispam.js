import { Tier } from '@lyss/shared/permissions.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { logEmbed } from '../embeds/caseEmbeds.js';
import { getServices } from './index.js';
import { sendLog, suppressDeleteLogs } from './logService.js';
import { botActor, timeout, warn } from './moderation.js';
import {
  ANTISPAM_SETTINGS, BURST_COOLDOWN_MS, escalationStep, OFFENCE_WINDOW_MS, RULE_TEXT,
} from './spamDetector.js';

const lastOffenceAt = new Map();

/** Current settings for a guild, keyed without the "antispam." prefix. */
export function antispamSettings(ctx, guildId) {
  return Object.fromEntries(ANTISPAM_SETTINGS.map((s) => [s.key.slice('antispam.'.length), ctx.guildConfig.get(guildId, s.key)]));
}

/** Staff and whitelisted roles or channels (including a thread's parent) are exempt. */
export function isExempt(ctx, message) {
  if (ctx.permissions.tierOf(message.member) >= Tier.STAFF) return true;
  const channelIds = [message.channelId, message.channel?.parentId, message.channel?.parent?.parentId].filter(Boolean);
  return getServices(ctx).antispam.isWhitelisted(message.guildId, { channelIds, roleIds: [...message.member.roles.cache.keys()] });
}

async function deleteMessages(ctx, guild, refs) {
  const byChannel = new Map();
  for (const { messageId, channelId } of refs) {
    if (!byChannel.has(channelId)) byChannel.set(channelId, []);
    byChannel.get(channelId).push(messageId);
  }
  for (const [channelId, ids] of byChannel) {
    suppressDeleteLogs(ids);
    const channel = guild.channels.cache.get(channelId);
    try {
      if (ids.length === 1) await channel?.messages.delete(ids[0]);
      else await channel?.bulkDelete(ids, true);
    } catch (error) {
      ctx.logger.warn('Anti-spam could not delete messages', { guildId: guild.id, channelId, error: error.message });
    }
  }
}

async function punish(ctx, message, { rule, messages }) {
  const { detector, antispam } = getServices(ctx);
  const { guild, author, member } = message;
  detector.reset(guild.id, author.id);
  await deleteMessages(ctx, guild, messages);

  // Further detections in the same burst are cleaned up but not punished again.
  const key = `${guild.id}:${author.id}`;
  const now = Date.now();
  if (now - (lastOffenceAt.get(key) ?? 0) < BURST_COOLDOWN_MS) return;
  lastOffenceAt.set(key, now);
  if (lastOffenceAt.size > 10_000) for (const [k, t] of lastOffenceAt) if (now - t > BURST_COOLDOWN_MS) lastOffenceAt.delete(k);

  const count = antispam.recordOffence({ guildId: guild.id, userId: author.id, rule, channelId: message.channelId, now, windowMs: OFFENCE_WINDOW_MS });
  const step = escalationStep(count);
  const reason = `Anti-spam: ${RULE_TEXT[rule]}`;

  if (step.kind === 'notice') {
    const notice = await safeSend(message.channel, { content: `${author}, please stop ${RULE_TEXT[rule]}.`, allowedMentions: { users: [author.id] } });
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 8_000).unref?.();
    await sendLog(ctx, guild, 'moderation', {
      embeds: [logEmbed(ctx, guild.id, {
        title: '🛡️ Anti-spam',
        colour: 0xfee75c,
        description: `Removed ${messages.length} message${messages.length === 1 ? '' : 's'} from ${author} in <#${message.channelId}> for ${RULE_TEXT[rule]}.`,
        footer: `User ID: ${author.id} · first offence`,
      })],
    });
    return;
  }

  const actor = botActor(ctx);
  if (step.kind === 'warn-timeout') await warn(ctx, guild, actor, author, reason, { member, source: 'antispam' });
  if (member.moderatable) {
    await timeout(ctx, guild, actor, member, step.timeoutMs, reason, { source: 'antispam' });
  } else {
    ctx.logger.warn('Anti-spam could not time out member', { guildId: guild.id, userId: author.id });
  }
}

/** Entry point from messageCreate. */
export async function handleMessage(ctx, message) {
  if (!message.inGuild() || message.author.bot || message.webhookId || !message.member) return;
  if (!ctx.guildConfig.get(message.guildId, 'antispam.enabled')) return;
  if (isExempt(ctx, message)) return;
  const result = getServices(ctx).detector.check({
    guildId: message.guildId,
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    content: message.content,
    mentionCount: message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0),
    at: message.createdTimestamp,
  }, antispamSettings(ctx, message.guildId));
  if (result) await punish(ctx, message, result);
}
