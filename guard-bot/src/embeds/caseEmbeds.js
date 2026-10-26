import { makeCustomId } from '@lyss/shared/router.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { plural, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { CASE_ACTIONS } from '../services/caseService.js';

const SOURCE_LABELS = { antispam: 'Anti-spam', escalation: 'Automatic escalation', automatic: 'Automatic' };

export function caseEmbed(ctx, c) {
  const info = CASE_ACTIONS[c.action];
  const kit = ctx.embeds.for(c.guild_id);
  const embed = kit.base({ title: `${info.emoji} Case #${c.number} · ${info.label}`, colour: info.colour });
  const fields = [];
  if (c.target_id) fields.push({ name: 'Member', value: `<@${c.target_id}> (\`${c.target_id}\`)`, inline: true });
  if (c.channel_id) fields.push({ name: 'Channel', value: `<#${c.channel_id}>`, inline: true });
  fields.push({ name: 'Moderator', value: `<@${c.moderator_id}>`, inline: true });
  if (c.duration_ms) fields.push({ name: c.action === 'slowmode' ? 'Slowmode' : 'Duration', value: formatDuration(c.duration_ms), inline: true });
  if (c.expires_at) fields.push({ name: 'Expires', value: discordTimestamp(c.expires_at, 'R'), inline: true });
  if (c.metadata?.count !== undefined) fields.push({ name: 'Messages deleted', value: String(c.metadata.count), inline: true });
  if (c.source !== 'manual') fields.push({ name: 'Source', value: SOURCE_LABELS[c.source], inline: true });
  if (c.metadata?.relatedNumber) fields.push({ name: 'Related case', value: `#${c.metadata.relatedNumber}`, inline: true });
  fields.push({ name: 'Reason', value: truncate(c.reason || 'No reason provided', 1024) });
  if (c.revoked_at) fields.push({ name: 'Removed', value: `${discordTimestamp(c.revoked_at, 'R')} by <@${c.revoked_by}>${c.revoke_reason ? `: ${truncate(c.revoke_reason, 200)}` : ''}` });
  return embed.addFields(fields);
}

const DM_VERBS = {
  warn: 'You received a warning',
  timeout: 'You were timed out',
  kick: 'You were kicked',
  ban: 'You were banned',
  tempban: 'You were temporarily banned',
};

export function dmEmbed(ctx, guild, action, reason, durationMs) {
  const kit = ctx.embeds.for(guild.id);
  const embed = kit.base({ title: `${CASE_ACTIONS[action].emoji} ${DM_VERBS[action]} in ${guild.name}`, colour: CASE_ACTIONS[action].colour })
    .addFields({ name: 'Reason', value: truncate(reason || 'No reason provided', 1024) });
  if (durationMs) embed.addFields({ name: 'Duration', value: formatDuration(durationMs), inline: true });
  return embed;
}

export function caseLine(c, now = Date.now()) {
  const info = CASE_ACTIONS[c.action];
  const removed = c.revoked_at ? ' ~~removed~~' : '';
  const expired = c.action === 'warn' && !c.revoked_at && c.expires_at && c.expires_at <= now ? ' *(expired)*' : '';
  return `**#${c.number}** ${info.emoji} ${info.label}${removed}${expired} · ${discordTimestamp(c.created_at, 'd')} · <@${c.moderator_id}>${c.reason ? `\n> ${truncate(c.reason, 120)}` : ''}`;
}

const PER_PAGE = 8;

export function historyPage(ctx, guildId, userId, requestedPage, services) {
  const total = services.cases.countForTarget(guildId, userId);
  const { page, totalPages } = paginate(Array.from({ length: total }), requestedPage, PER_PAGE);
  const cases = services.cases.forTarget(guildId, userId, PER_PAGE, (page - 1) * PER_PAGE);
  const active = services.cases.activeWarnings(guildId, userId).length;
  const notes = services.cases.notes(guildId, userId).length;
  const kit = ctx.embeds.for(guildId);
  const summary = `<@${userId}> · ${plural(total, 'case')} · ${plural(active, 'active warning')} · ${plural(notes, 'note')}`;
  const embed = kit.base({
    title: '📋 Moderation history',
    description: truncate(`${summary}\n\n${cases.map((c) => caseLine(c)).join('\n') || 'No moderation cases.'}`, 4096),
  });
  const components = totalPages > 1 ? [pageRow((p) => makeCustomId('guard', 'history', 'page', userId, p), page, totalPages)] : [];
  return { embeds: [embed], components };
}

/** Generic log embed used by the event loggers. Empty fields are dropped. */
export function logEmbed(ctx, guildId, { title, colour, description, fields = [], thumbnail, footer }) {
  const kit = ctx.embeds.for(guildId);
  const embed = kit.base({ title, description, colour });
  const clean = fields.filter((f) => f && f.value !== undefined && f.value !== null && f.value !== '')
    .map((f) => ({ name: truncate(f.name, 256), value: truncate(String(f.value), 1024), inline: Boolean(f.inline) }));
  if (clean.length) embed.addFields(clean.slice(0, 25));
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}
