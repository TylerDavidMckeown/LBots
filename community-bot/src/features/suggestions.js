import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { progressBar, truncate } from '@lyss/shared/utils/text.js';
import { SUGGESTION_STATUSES } from '../services/communityStores.js';
import { getServices } from '../services/index.js';
import {
  assertCanPost, cid, EPHEMERAL, fetchChannel, requireChannelSetting,
} from './common.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The suggestion message. `imageUrl` carries over the image already attached to the
 * message, so edits never lose it.
 */
export function suggestionPayload(ctx, suggestion, counts, { author, imageUrl } = {}) {
  const status = SUGGESTION_STATUSES[suggestion.status];
  const kit = ctx.embeds.for(suggestion.guild_id);
  const total = counts.up + counts.down;
  const embed = kit.base({ title: `💡 Suggestion #${suggestion.number}`, description: truncate(suggestion.content, 4000), colour: status.colour })
    .addFields(
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
      { name: 'Votes', value: `👍 ${counts.up} · 👎 ${counts.down}${total ? `\n${progressBar(counts.up, total, 10)} ${Math.round((counts.up / total) * 100)}% positive` : ''}`, inline: true },
      { name: 'Suggested by', value: `<@${suggestion.author_id}>`, inline: true },
    );
  if (author) embed.setAuthor({ name: author.tag ?? author.username, iconURL: author.displayAvatarURL?.() });
  if (suggestion.staff_id) {
    embed.addFields({ name: 'Staff response', value: truncate(`${suggestion.staff_response || '*No comment*'} — <@${suggestion.staff_id}>`, 1024) });
  }
  if (imageUrl) embed.setImage(imageUrl);

  const components = [];
  if (status.open) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('suggestion', 'vote', suggestion.id, 'up')).setEmoji('👍').setLabel(String(counts.up)).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cid('suggestion', 'vote', suggestion.id, 'down')).setEmoji('👎').setLabel(String(counts.down)).setStyle(ButtonStyle.Danger),
    );
    if (suggestion.status === 'pending') {
      row.addComponents(new ButtonBuilder().setCustomId(cid('suggestion', 'delete', suggestion.id)).setEmoji('🗑️').setLabel('Delete').setStyle(ButtonStyle.Secondary));
    }
    components.push(row);
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

const imageOf = (message) => message?.embeds?.[0]?.image?.url ?? null;

async function respond(interaction, ctx, status) {
  const { suggestions } = getServices(ctx);
  const number = interaction.options.getInteger('number', true);
  const found = suggestions.getByNumber(interaction.guildId, number);
  if (!found || found.status === 'deleted') throw new UserError(`Suggestion #${number} does not exist.`, { title: 'Not found' });
  await interaction.deferReply({ flags: EPHEMERAL });
  const updated = suggestions.respond(found.id, status, interaction.user.id, interaction.options.getString('response'));
  const channel = await fetchChannel(ctx, updated.channel_id);
  const message = await channel?.messages.fetch(updated.message_id).catch(() => null);
  const author = await ctx.client.users.fetch(updated.author_id).catch(() => null);
  await message?.edit(suggestionPayload(ctx, updated, suggestions.counts(updated.id), { author, imageUrl: imageOf(message) }));

  const info = SUGGESTION_STATUSES[status];
  const kit = ctx.embeds.for(interaction.guildId);
  await author?.send({
    embeds: [kit.base({ title: `${info.emoji} Your suggestion was updated: ${info.label}`, description: truncate(updated.content, 1000), colour: info.colour })
      .addFields({ name: 'Server', value: interaction.guild.name, inline: true }, ...(updated.staff_response ? [{ name: 'Response', value: truncate(updated.staff_response, 1024) }] : []))],
  }).catch(() => null);
  return interaction.editReply({ embeds: [kit.success('Suggestion updated', `Suggestion #${number} is now **${info.label}**.${message ? ` [Jump to it](${message.url})` : ''}`)] });
}

const numberOption = (o) => o.setName('number').setDescription('Suggestion number').setRequired(true).setMinValue(1);
const responseOption = (o) => o.setName('response').setDescription('Message to the author').setMaxLength(1000);

export default {
  commands: [
    {
      data: new SlashCommandBuilder().setName('suggest').setDescription('Make a suggestion')
        .addStringOption((o) => o.setName('suggestion').setDescription('Your idea').setRequired(true).setMaxLength(1500))
        .addAttachmentOption((o) => o.setName('image').setDescription('Optional image')),
      category: 'Community',
      tier: 'member',
      cooldown: 30,
      async execute(interaction, ctx) {
        const { suggestions } = getServices(ctx);
        const channel = await assertCanPost(await fetchChannel(ctx, requireChannelSetting(ctx, interaction.guildId, 'channel.suggestions', 'suggestion channel')), ['AttachFiles']);
        const image = interaction.options.getAttachment('image');
        if (image && (!image.contentType?.startsWith('image/') || image.size > MAX_IMAGE_BYTES)) {
          throw new UserError('Attach an image (PNG, JPG, GIF or WebP) under 8 MB.', { title: 'Invalid image' });
        }
        await interaction.deferReply({ flags: EPHEMERAL });
        const suggestion = suggestions.create({ guildId: interaction.guildId, authorId: interaction.user.id, content: interaction.options.getString('suggestion', true) });
        // Re-upload the image so it does not depend on the expiring link of the original attachment.
        const fileName = image ? `suggestion-${suggestion.number}.${image.name.split('.').pop()}` : null;
        const message = await channel.send({
          ...suggestionPayload(ctx, suggestion, { up: 0, down: 0 }, { author: interaction.user, imageUrl: fileName ? `attachment://${fileName}` : null }),
          files: image ? [{ attachment: image.url, name: fileName }] : [],
        });
        let threadId = null;
        if (ctx.guildConfig.get(interaction.guildId, 'suggestions.threads') && channel.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
          const thread = await message.startThread({ name: `Suggestion #${suggestion.number}`, autoArchiveDuration: 1440 }).catch(() => null);
          threadId = thread?.id ?? null;
        }
        suggestions.setMessage(suggestion.id, channel.id, message.id, threadId);
        const kit = ctx.embeds.for(interaction.guildId);
        return interaction.editReply({ embeds: [kit.success('Suggestion posted', `Suggestion #${suggestion.number} is live. [Jump to it](${message.url})`)] });
      },
    },
    {
      data: new SlashCommandBuilder().setName('suggestion').setDescription('Respond to suggestions')
        .addSubcommand((s) => s.setName('approve').setDescription('Approve a suggestion').addIntegerOption(numberOption).addStringOption(responseOption))
        .addSubcommand((s) => s.setName('deny').setDescription('Deny a suggestion').addIntegerOption(numberOption).addStringOption(responseOption))
        .addSubcommand((s) => s.setName('consider').setDescription('Mark a suggestion as under consideration').addIntegerOption(numberOption).addStringOption(responseOption))
        .addSubcommand((s) => s.setName('implemented').setDescription('Mark a suggestion as implemented').addIntegerOption(numberOption).addStringOption(responseOption)),
      category: 'Community',
      tier: 'staff',
      async execute(interaction, ctx) {
        const status = { approve: 'approved', deny: 'denied', consider: 'considered', implemented: 'implemented' }[interaction.options.getSubcommand()];
        return respond(interaction, ctx, status);
      },
    },
  ],
  components: [
    {
      id: 'suggestion:vote',
      async execute(interaction, ctx, [rawId, direction]) {
        const { suggestions } = getServices(ctx);
        const result = suggestions.vote(Number(rawId), interaction.user.id, direction === 'up' ? 1 : -1);
        const suggestion = suggestions.get(Number(rawId));
        const author = await ctx.client.users.fetch(suggestion.author_id).catch(() => null);
        await interaction.update(suggestionPayload(ctx, suggestion, result, { author, imageUrl: imageOf(interaction.message) }));
      },
    },
    {
      id: 'suggestion:delete',
      async execute(interaction, ctx, [rawId]) {
        const { suggestions } = getServices(ctx);
        const suggestion = suggestions.get(Number(rawId));
        if (!suggestion || suggestion.author_id !== interaction.user.id) throw new UserError('Only the author can delete this suggestion.', { title: 'Not your suggestion' });
        if (!suggestions.remove(suggestion.id, interaction.user.id)) throw new UserError('Suggestions can only be deleted while they are pending.', { title: 'Cannot delete' });
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.reply({ embeds: [kit.success('Suggestion deleted', `Suggestion #${suggestion.number} was deleted.`)], flags: EPHEMERAL });
        await interaction.message.delete().catch(() => {});
      },
    },
  ],
};
