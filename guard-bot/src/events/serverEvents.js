import { AuditLogEvent, ChannelType, Events } from 'discord.js';
import { logEmbed } from '../embeds/caseEmbeds.js';
import { diffChannel, diffRole } from '../services/diff.js';
import { findExecutor, sendLog } from '../services/logService.js';

const GREEN = 0x57f287;
const RED = 0xed4245;
const BLUE = 0x5865f2;

const by = (entry) => (entry ? `<@${entry.executorId}>` : 'Unknown');
const CHANNEL_TYPES = Object.fromEntries(Object.entries(ChannelType).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k.replace(/^Guild/, '')]));

/** Ban changes made by Lyss Guard itself are already recorded as moderation cases. */
function banEvent(name, auditType, title, colour) {
  return {
    name,
    async execute(ban, ctx) {
      const entry = await findExecutor(ban.guild, auditType, { targetId: ban.user.id });
      if (entry?.executorId === ctx.client.user.id) return;
      await sendLog(ctx, ban.guild, 'moderation', {
        embeds: [logEmbed(ctx, ban.guild.id, {
          title,
          colour,
          description: `<@${ban.user.id}> · ${ban.user.tag}`,
          fields: [{ name: 'By', value: by(entry), inline: true }, { name: 'Reason', value: entry?.reason ?? ban.reason ?? null }],
          footer: `User ID: ${ban.user.id}`,
        })],
      });
    },
  };
}

function channelEvent(name, auditType, title, colour) {
  return {
    name,
    async execute(channel, ctx) {
      if (!channel.guild) return;
      const entry = await findExecutor(channel.guild, auditType, { targetId: channel.id });
      await sendLog(ctx, channel.guild, 'server', {
        embeds: [logEmbed(ctx, channel.guild.id, {
          title,
          colour,
          description: `**#${channel.name}** (${CHANNEL_TYPES[channel.type] ?? 'Channel'})`,
          fields: [
            { name: 'Category', value: channel.parent?.name ?? null, inline: true },
            { name: 'By', value: by(entry), inline: true },
          ],
          footer: `Channel ID: ${channel.id}`,
        })],
      });
    },
  };
}

function roleEvent(name, auditType, title, colour) {
  return {
    name,
    async execute(role, ctx) {
      const entry = await findExecutor(role.guild, auditType, { targetId: role.id });
      await sendLog(ctx, role.guild, 'server', {
        embeds: [logEmbed(ctx, role.guild.id, {
          title,
          colour,
          description: `**@${role.name}**`,
          fields: [{ name: 'By', value: by(entry), inline: true }],
          footer: `Role ID: ${role.id}`,
        })],
      });
    },
  };
}

export default [
  banEvent(Events.GuildBanAdd, AuditLogEvent.MemberBanAdd, '🔨 Member banned (outside Lyss Guard)', RED),
  banEvent(Events.GuildBanRemove, AuditLogEvent.MemberBanRemove, '🕊️ Member unbanned (outside Lyss Guard)', GREEN),
  channelEvent(Events.ChannelCreate, AuditLogEvent.ChannelCreate, '📁 Channel created', GREEN),
  channelEvent(Events.ChannelDelete, AuditLogEvent.ChannelDelete, '🗑️ Channel deleted', RED),
  {
    name: Events.ChannelUpdate,
    async execute(before, after, ctx) {
      if (!after.guild) return;
      const changes = diffChannel(before, after);
      if (!changes.length) return;
      const entry = await findExecutor(after.guild, AuditLogEvent.ChannelUpdate, { targetId: after.id })
        ?? await findExecutor(after.guild, AuditLogEvent.ChannelOverwriteUpdate, { targetId: after.id });
      await sendLog(ctx, after.guild, 'server', {
        embeds: [logEmbed(ctx, after.guild.id, {
          title: '🛠️ Channel updated',
          colour: BLUE,
          description: `${after}`,
          fields: [{ name: 'Changes', value: changes.join('\n') }, { name: 'By', value: by(entry), inline: true }],
          footer: `Channel ID: ${after.id}`,
        })],
      });
    },
  },
  roleEvent(Events.GuildRoleCreate, AuditLogEvent.RoleCreate, '🎭 Role created', GREEN),
  roleEvent(Events.GuildRoleDelete, AuditLogEvent.RoleDelete, '🗑️ Role deleted', RED),
  {
    name: Events.GuildRoleUpdate,
    async execute(before, after, ctx) {
      const changes = diffRole(before, after);
      if (!changes.length) return; // Position-only changes are ignored.
      const entry = await findExecutor(after.guild, AuditLogEvent.RoleUpdate, { targetId: after.id });
      await sendLog(ctx, after.guild, 'server', {
        embeds: [logEmbed(ctx, after.guild.id, {
          title: '🛠️ Role updated',
          colour: BLUE,
          description: `${after}`,
          fields: [{ name: 'Changes', value: changes.join('\n') }, { name: 'By', value: by(entry), inline: true }],
          footer: `Role ID: ${after.id}`,
        })],
      });
    },
  },
];
