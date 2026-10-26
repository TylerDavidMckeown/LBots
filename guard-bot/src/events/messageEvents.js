import { AttachmentBuilder, AuditLogEvent, Events } from 'discord.js';
import { codeBlock, truncate } from '@lyss/shared/utils/text.js';
import { logEmbed } from '../embeds/caseEmbeds.js';
import { handleMessage } from '../services/antispam.js';
import { getServices } from '../services/index.js';
import {
  findExecutor, isDeleteSuppressed, isIgnoredChannel, sendLog,
} from '../services/logService.js';

const YELLOW = 0xfee75c;
const RED = 0xed4245;

const attachmentsOf = (message) => [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url }));
const ignored = (ctx, message) => isIgnoredChannel(ctx, message.guildId, message.channelId, message.channel?.parentId);
const quote = (text) => (text ? codeBlock(truncate(text, 1000)) : '*No text content*');

export default [
  {
    name: Events.MessageCreate,
    async execute(message, ctx) {
      if (!message.inGuild() || message.author.bot) return;
      if (!ignored(ctx, message)) {
        getServices(ctx).messages.add({
          messageId: message.id,
          guildId: message.guildId,
          channelId: message.channelId,
          authorId: message.author.id,
          content: message.content,
          attachments: attachmentsOf(message),
          createdAt: message.createdTimestamp,
        });
      }
      await handleMessage(ctx, message);
    },
  },
  {
    name: Events.MessageUpdate,
    async execute(before, after, ctx) {
      if (!after.guildId) return;
      const message = after.partial ? await after.fetch().catch(() => null) : after;
      if (!message || message.author?.bot || ignored(ctx, message)) return;
      const { messages } = getServices(ctx);
      const previous = before.partial ? messages.get(message.id)?.content ?? undefined : before.content;
      // Unknown previous text (old, uncached message) or embed-only updates are not logged.
      if (previous === undefined || previous === message.content) return;
      messages.edit(message.id, message.content);
      await sendLog(ctx, message.guild, 'message', {
        embeds: [logEmbed(ctx, message.guildId, {
          title: '✏️ Message edited',
          colour: YELLOW,
          description: `${message.author} in ${message.channel} · [Jump to message](${message.url})`,
          fields: [
            { name: 'Before', value: quote(previous) },
            { name: 'After', value: quote(message.content) },
          ],
          footer: `User ID: ${message.author.id} · Message ID: ${message.id}`,
        })],
      });
    },
  },
  {
    name: Events.MessageDelete,
    async execute(message, ctx) {
      if (!message.guildId) return;
      const { messages } = getServices(ctx);
      const cached = messages.get(message.id);
      messages.remove(message.id);
      if (isDeleteSuppressed(message.id) || message.author?.bot || ignored(ctx, message)) return;
      const authorId = message.author?.id ?? cached?.author_id;
      if (!authorId) return; // Nothing is known about this message.
      const guild = ctx.client.guilds.cache.get(message.guildId);
      if (!guild) return;

      // Audit logs only record deletions of other people's messages.
      const entry = await findExecutor(guild, AuditLogEvent.MessageDelete, {
        targetId: authorId, withinMs: 5_000, match: (e) => e.extra?.channel?.id === message.channelId,
      });
      const content = message.partial ? cached?.content : message.content;
      const attachments = message.partial ? cached?.attachments ?? [] : attachmentsOf(message);
      await sendLog(ctx, guild, 'message', {
        embeds: [logEmbed(ctx, guild.id, {
          title: '🗑️ Message deleted',
          colour: RED,
          description: `<@${authorId}> in <#${message.channelId}>`,
          fields: [
            { name: 'Content', value: message.partial && !cached ? '*Not cached*' : quote(content) },
            attachments.length ? { name: 'Attachments', value: attachments.map((a) => a.name).join(', ') } : null,
            { name: 'Deleted by', value: entry ? `<@${entry.executorId}>` : 'The author, or unknown' },
          ],
          footer: `User ID: ${authorId} · Message ID: ${message.id}`,
        })],
      });
    },
  },
  {
    name: Events.MessageBulkDelete,
    async execute(deleted, channel, ctx) {
      if (!channel.guild) return;
      const { messages } = getServices(ctx);
      const ids = [...deleted.keys()];
      const rows = messages.getMany(ids);
      messages.removeMany(ids);
      if (isIgnoredChannel(ctx, channel.guild.id, channel.id, channel.parentId)) return;
      const lines = rows.map((r) => `[${new Date(r.created_at).toISOString()}] ${r.author_id}: ${r.content ?? ''}${r.attachments.length ? ` [${r.attachments.map((a) => a.name).join(', ')}]` : ''}`);
      await sendLog(ctx, channel.guild, 'message', {
        embeds: [logEmbed(ctx, channel.guild.id, {
          title: '🧹 Messages bulk deleted',
          colour: RED,
          description: `${ids.length} messages deleted in ${channel}.`,
          fields: [{ name: 'Content saved', value: rows.length ? `${rows.length} cached message(s) attached` : 'None of these messages were cached' }],
        })],
        files: rows.length ? [new AttachmentBuilder(Buffer.from(lines.join('\n')), { name: `bulk-delete-${channel.id}.txt` })] : [],
      });
    },
  },
];
