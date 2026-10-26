import { AuditLogEvent, Events } from 'discord.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { logEmbed } from '../embeds/caseEmbeds.js';
import { findExecutor, sendLog } from '../services/logService.js';

const NEW_ACCOUNT_MS = 7 * 86_400_000;
const GREEN = 0x57f287;
const RED = 0xed4245;
const BLUE = 0x5865f2;

const by = (entry, fallback = 'Unknown') => (entry ? `<@${entry.executorId}>` : fallback);
const roleList = (ids) => ids.map((id) => `<@&${id}>`).join(' ');

export default [
  {
    name: Events.GuildMemberAdd,
    async execute(member, ctx) {
      const age = Date.now() - member.user.createdTimestamp;
      await sendLog(ctx, member.guild, 'member', {
        embeds: [logEmbed(ctx, member.guild.id, {
          title: '📥 Member joined',
          colour: GREEN,
          description: `${member} · ${member.user.tag}`,
          thumbnail: member.user.displayAvatarURL(),
          fields: [
            { name: 'Account created', value: `${discordTimestamp(member.user.createdTimestamp, 'D')} (${discordTimestamp(member.user.createdTimestamp, 'R')})`, inline: true },
            { name: 'Member count', value: String(member.guild.memberCount), inline: true },
            age < NEW_ACCOUNT_MS ? { name: '⚠️ New account', value: `Created ${formatDuration(age, 2)} ago` } : null,
          ],
          footer: `User ID: ${member.id}`,
        })],
      });
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(member, ctx) {
      const kick = await findExecutor(member.guild, AuditLogEvent.MemberKick, { targetId: member.id, withinMs: 5_000 });
      // Kicks by Lyss Guard are already logged as moderation cases.
      const kickedBy = kick && kick.executorId !== ctx.client.user.id ? kick : null;
      const roles = member.roles?.cache ? [...member.roles.cache.keys()].filter((id) => id !== member.guild.id) : [];
      await sendLog(ctx, member.guild, 'member', {
        embeds: [logEmbed(ctx, member.guild.id, {
          title: kickedBy ? '👢 Member kicked' : '📤 Member left',
          colour: RED,
          description: `<@${member.id}> · ${member.user?.tag ?? member.id}`,
          thumbnail: member.user?.displayAvatarURL(),
          fields: [
            { name: 'Joined', value: member.joinedTimestamp ? discordTimestamp(member.joinedTimestamp, 'R') : 'Unknown', inline: true },
            { name: 'Member count', value: String(member.guild.memberCount), inline: true },
            kickedBy ? { name: 'Kicked by', value: by(kickedBy) } : null,
            kickedBy?.reason ? { name: 'Reason', value: kickedBy.reason } : null,
            roles.length ? { name: 'Roles', value: roleList(roles) } : null,
          ],
          footer: `User ID: ${member.id}`,
        })],
      });
    },
  },
  {
    name: Events.GuildMemberUpdate,
    async execute(before, after, ctx) {
      if (before.partial) return; // Without the previous state there is nothing to compare.
      const { guild } = after;

      if (before.nickname !== after.nickname) {
        const entry = await findExecutor(guild, AuditLogEvent.MemberUpdate, { targetId: after.id, withinMs: 5_000 });
        await sendLog(ctx, guild, 'member', {
          embeds: [logEmbed(ctx, guild.id, {
            title: '🏷️ Nickname changed',
            colour: BLUE,
            description: `${after} · ${after.user.tag}`,
            fields: [
              { name: 'Before', value: before.nickname ?? '*none*', inline: true },
              { name: 'After', value: after.nickname ?? '*none*', inline: true },
              { name: 'Changed by', value: by(entry, 'The member or unknown') },
            ],
            footer: `User ID: ${after.id}`,
          })],
        });
      }

      const added = [...after.roles.cache.keys()].filter((id) => !before.roles.cache.has(id));
      const removed = [...before.roles.cache.keys()].filter((id) => !after.roles.cache.has(id));
      if (added.length || removed.length) {
        const entry = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, { targetId: after.id, withinMs: 5_000 });
        await sendLog(ctx, guild, 'member', {
          embeds: [logEmbed(ctx, guild.id, {
            title: '🎭 Roles updated',
            colour: BLUE,
            description: `${after} · ${after.user.tag}`,
            fields: [
              added.length ? { name: 'Added', value: roleList(added) } : null,
              removed.length ? { name: 'Removed', value: roleList(removed) } : null,
              { name: 'Changed by', value: by(entry) },
            ],
            footer: `User ID: ${after.id}`,
          })],
        });
      }

      const beforeUntil = before.communicationDisabledUntilTimestamp ?? 0;
      const afterUntil = after.communicationDisabledUntilTimestamp ?? 0;
      if (beforeUntil !== afterUntil) {
        const entry = await findExecutor(guild, AuditLogEvent.MemberUpdate, { targetId: after.id, withinMs: 5_000 });
        // Timeouts applied by Lyss Guard are already logged as cases.
        if (entry?.executorId === ctx.client.user.id) return;
        const active = afterUntil > Date.now();
        await sendLog(ctx, guild, 'moderation', {
          embeds: [logEmbed(ctx, guild.id, {
            title: active ? '⏳ Timed out (outside Lyss Guard)' : '⌛ Timeout removed (outside Lyss Guard)',
            colour: active ? 0xf0b232 : GREEN,
            description: `${after} · ${after.user.tag}`,
            fields: [
              active ? { name: 'Until', value: discordTimestamp(afterUntil, 'f') } : null,
              { name: 'By', value: by(entry) },
              entry?.reason ? { name: 'Reason', value: entry.reason } : null,
            ],
            footer: `User ID: ${after.id}`,
          })],
        });
      }
    },
  },
];
