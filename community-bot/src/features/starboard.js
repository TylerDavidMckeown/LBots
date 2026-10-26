import { ChannelType, Events, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { getServices } from '../services/index.js';
import { EPHEMERAL, fetchChannel } from './common.js';

const STAR_COLOUR = 0xffac33;

/** Whether a reaction emoji matches the configured star (unicode or <:custom:id>). */
export function matchesEmoji(emoji, setting) {
  const custom = /^<a?:\w+:(\d+)>$/.exec(String(setting).trim());
  if (custom) return emoji.id === custom[1];
  const strip = (text) => String(text ?? '').replace(/️/g, '');
  return !emoji.id && strip(emoji.name) === strip(setting);
}

function firstImage(message) {
  const attachment = [...message.attachments.values()].find((a) => a.contentType?.startsWith('image/'));
  return attachment?.url ?? message.embeds.find((e) => e.image)?.image?.url ?? null;
}

export function starboardPayload(ctx, message, stars, emoji) {
  const kit = ctx.embeds.for(message.guildId);
  const embed = kit.base({ description: message.content ? truncate(message.content, 3900) : undefined, colour: STAR_COLOUR })
    .setAuthor({ name: message.member?.displayName ?? message.author.username, iconURL: message.author.displayAvatarURL() })
    .addFields({ name: 'Source', value: `[Jump to message](${message.url}) in <#${message.channelId}>` })
    .setTimestamp(message.createdAt)
    .setFooter({ text: `Message ID: ${message.id}` });
  const image = firstImage(message);
  if (image) embed.setImage(image);
  return { content: `${emoji} **${stars}** · <#${message.channelId}>`, embeds: [embed], allowedMentions: { parse: [] } };
}

// Reactions on one message are processed one at a time so a post is never created twice.
const queues = new Map();
function serialise(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task).finally(() => { if (queues.get(key) === next) queues.delete(key); });
  queues.set(key, next);
  return next;
}

async function sync(ctx, message, stars) {
  const { starboard } = getServices(ctx);
  const board = await fetchChannel(ctx, ctx.guildConfig.get(message.guildId, 'channel.starboard'));
  if (!board) return;
  const entry = starboard.get(message.id);
  const threshold = ctx.guildConfig.get(message.guildId, 'starboard.threshold');
  const emoji = ctx.guildConfig.get(message.guildId, 'starboard.emoji');
  const existing = entry?.starboard_message_id ? await board.messages.fetch(entry.starboard_message_id).catch(() => null) : null;

  if (stars >= threshold) {
    const payload = starboardPayload(ctx, message, stars, emoji);
    const posted = existing ? await existing.edit(payload) : await board.send(payload);
    starboard.upsert({ messageId: message.id, guildId: message.guildId, channelId: message.channelId, authorId: message.author.id, starboardMessageId: posted.id, stars });
  } else if (entry) {
    await existing?.delete().catch(() => {});
    starboard.remove(message.id);
  }
}

/** Counts stars from real members, excluding bots and the author's own star. */
async function handleReaction(ctx, reaction) {
  if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
  if (!reaction) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guildId || !message.author) return;
  const boardId = ctx.guildConfig.get(message.guildId, 'channel.starboard');
  if (!boardId || message.channelId === boardId) return;
  const excluded = ctx.guildConfig.get(message.guildId, 'starboard.excludedChannels') ?? [];
  if ([message.channelId, message.channel?.parentId].some((id) => id && excluded.includes(id))) return;
  if (!matchesEmoji(reaction.emoji, ctx.guildConfig.get(message.guildId, 'starboard.emoji'))) return;

  await serialise(message.id, async () => {
    const users = await reaction.users.fetch().catch(() => null);
    const stars = users ? users.filter((u) => !u.bot && u.id !== message.author.id).size : 0;
    await sync(ctx, message, stars);
  });
}

async function handleCleared(ctx, message) {
  if (!message.guildId || !getServices(ctx).starboard.get(message.id)) return;
  const full = message.partial ? await message.fetch().catch(() => null) : message;
  if (full) await serialise(message.id, () => sync(ctx, full, 0));
}

const command = {
  data: new SlashCommandBuilder().setName('starboard').setDescription('Starboard settings')
    .addSubcommand((s) => s.setName('status').setDescription('Show starboard settings'))
    .addSubcommand((s) => s.setName('exclude').setDescription('Ignore stars in a channel')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory)))
    .addSubcommand((s) => s.setName('include').setDescription('Count stars in a channel again')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true))),
  category: 'Community',
  tier: 'admin',
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const excluded = ctx.guildConfig.get(guildId, 'starboard.excludedChannels') ?? [];
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const boardId = ctx.guildConfig.get(guildId, 'channel.starboard');
      return interaction.reply({
        embeds: [kit.base({ title: '⭐ Starboard' }).addFields(
          { name: 'Channel', value: boardId ? `<#${boardId}>` : 'Not set. Use `/setup channel` › Starboard channel.', inline: true },
          { name: 'Threshold', value: `${ctx.guildConfig.get(guildId, 'starboard.threshold')} ${ctx.guildConfig.get(guildId, 'starboard.emoji')}`, inline: true },
          { name: 'Ignored channels', value: excluded.map((id) => `<#${id}>`).join(' ') || 'None' },
        ).setFooter({ text: 'Change the threshold and emoji with /setup value.' })],
        flags: EPHEMERAL,
      });
    }

    const channel = interaction.options.getChannel('channel', true);
    const has = excluded.includes(channel.id);
    if ((sub === 'exclude') === has) throw new UserError(`<#${channel.id}> is already ${has ? 'ignored' : 'counted'}.`, { title: 'No change' });
    const next = sub === 'exclude' ? [...excluded, channel.id] : excluded.filter((id) => id !== channel.id);
    ctx.guildConfig.set(guildId, 'starboard.excludedChannels', next, interaction.user.id);
    return interaction.reply({ embeds: [kit.success('Starboard updated', `Stars in <#${channel.id}> are now ${sub === 'exclude' ? 'ignored' : 'counted'}.`)], flags: EPHEMERAL });
  },
};

export default {
  commands: [command],
  events: [
    // Reaction events may carry an extra "details" argument; the bot context is always last.
    { name: Events.MessageReactionAdd, execute: (reaction, ...rest) => handleReaction(rest.at(-1), reaction) },
    { name: Events.MessageReactionRemove, execute: (reaction, ...rest) => handleReaction(rest.at(-1), reaction) },
    { name: Events.MessageReactionRemoveAll, execute: (message, reactions, ctx) => handleCleared(ctx, message) },
    {
      name: Events.MessageReactionRemoveEmoji,
      execute: (reaction, ctx) => (reaction.message.guildId && matchesEmoji(reaction.emoji, ctx.guildConfig.get(reaction.message.guildId, 'starboard.emoji'))
        ? handleCleared(ctx, reaction.message) : undefined),
    },
  ],
};
