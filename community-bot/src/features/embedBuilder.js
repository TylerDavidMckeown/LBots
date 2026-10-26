import crypto from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { buildEmbed } from '@lyss/shared/embedBuilder/builder.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { getServices } from '../services/index.js';
import { assertCanPost, cid, EPHEMERAL } from './common.js';

const MESSAGE_LINK = /discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const STARTER = { title: 'New embed', description: 'Click **Edit text** to write your embed.' };

/** "Name | Value | inline" lines to embed fields. */
export function parseFields(text) {
  return String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, value, inline] = line.split('|').map((part) => part.trim());
    return { name, value, inline: /^(inline|yes|true)$/i.test(inline ?? '') };
  });
}
export const formatFields = (fields = []) => fields.map((f) => `${f.name} | ${f.value}${f.inline ? ' | inline' : ''}`).join('\n');

/** Plain spec from a posted embed, so existing messages can be edited. */
export function specFromEmbed(embed) {
  const data = embed.toJSON?.() ?? embed.data ?? embed;
  return {
    title: data.title,
    description: data.description,
    url: data.url,
    color: data.color !== undefined ? `#${data.color.toString(16).padStart(6, '0')}` : undefined,
    author: data.author ? { name: data.author.name, iconURL: data.author.icon_url } : undefined,
    footer: data.footer ? { text: data.footer.text } : undefined,
    thumbnail: data.thumbnail?.url,
    image: data.image?.url,
    fields: data.fields ?? [],
  };
}

function previewPayload(draft, note = '') {
  const { embed, errors } = buildEmbed(draft.data);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('embed', 'text', draft.id)).setLabel('Edit text').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid('embed', 'extras', draft.id)).setLabel('Edit extras').setEmoji('🧩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(cid('embed', 'post', draft.id)).setLabel(draft.edit_message_id ? 'Save changes' : 'Post').setEmoji('📨').setStyle(ButtonStyle.Success).setDisabled(Boolean(errors.length)),
    new ButtonBuilder().setCustomId(cid('embed', 'savetemplate', draft.id)).setLabel('Save template').setEmoji('💾').setStyle(ButtonStyle.Primary).setDisabled(Boolean(errors.length)),
    new ButtonBuilder().setCustomId(cid('embed', 'discard', draft.id)).setLabel('Discard').setStyle(ButtonStyle.Danger),
  );
  const status = errors.length ? `⚠️ Fix these before posting:\n• ${errors.join('\n• ')}` : `Preview below.${draft.edit_message_id ? ' Saving edits the original message.' : ''}`;
  return { content: truncate(`${note ? `${note}\n` : ''}${status}`, 2000), embeds: embed ? [embed] : [], components: [row] };
}

function requireDraft(ctx, interaction, id) {
  const draft = getServices(ctx).embeds.draft(id, interaction.user.id);
  if (!draft) throw new UserError('This embed draft expired or belongs to someone else. Start again with /embed create.', { title: 'This has expired' });
  return draft;
}

function saveDraft(ctx, interaction, draft) {
  getServices(ctx).embeds.saveDraft({
    id: draft.id, guildId: interaction.guildId, userId: interaction.user.id, data: draft.data,
    channelId: draft.channel_id, editChannelId: draft.edit_channel_id, editMessageId: draft.edit_message_id,
  });
  return getServices(ctx).embeds.draft(draft.id, interaction.user.id);
}

function newDraft(ctx, interaction, data, { channelId = null, editChannelId = null, editMessageId = null } = {}) {
  return saveDraft(ctx, interaction, { id: crypto.randomUUID(), data, channel_id: channelId, edit_channel_id: editChannelId, edit_message_id: editMessageId });
}

const input = (id, label, style, value, max) => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(false).setMaxLength(max);
  if (value) field.setValue(truncate(String(value), max));
  return new ActionRowBuilder().addComponents(field);
};

/** Loads a message this bot posted, so only our own messages can be edited. */
async function fetchOwnMessage(ctx, interaction, link) {
  const match = MESSAGE_LINK.exec(link ?? '');
  if (!match || match[1] !== interaction.guildId) throw new UserError('Paste a message link from this server.', { title: 'Invalid link' });
  const channel = await ctx.client.channels.fetch(match[2]).catch(() => null);
  const message = await channel?.messages.fetch(match[3]).catch(() => null);
  if (!message) throw new UserError('That message could not be found.', { title: 'Not found' });
  if (message.author.id !== ctx.client.user.id) throw new UserError('I can only edit messages that I posted.', { title: 'Not my message' });
  if (!message.embeds.length) throw new UserError('That message has no embed.', { title: 'No embed' });
  return message;
}

const command = {
  data: new SlashCommandBuilder().setName('embed').setDescription('Build and post embeds')
    .addSubcommand((s) => s.setName('create').setDescription('Build a new embed')
      .addChannelOption((o) => o.setName('channel').setDescription('Where it will be posted (defaults to here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit an embed I posted')
      .addStringOption((o) => o.setName('message_link').setDescription('Link to the message').setRequired(true)))
    .addSubcommandGroup((g) => g.setName('template').setDescription('Saved embed templates')
      .addSubcommand((s) => s.setName('save').setDescription('Save a posted embed as a template')
        .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(50))
        .addStringOption((o) => o.setName('message_link').setDescription('Link to a message I posted').setRequired(true)))
      .addSubcommand((s) => s.setName('load').setDescription('Start a new embed from a template')
        .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(50))
        .addChannelOption((o) => o.setName('channel').setDescription('Where it will be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
      .addSubcommand((s) => s.setName('list').setDescription('List templates'))
      .addSubcommand((s) => s.setName('delete').setDescription('Delete a template')
        .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(50)))),
  category: 'Community',
  tier: 'admin',
  async execute(interaction, ctx) {
    const { embeds } = getServices(ctx);
    const kit = ctx.embeds.for(interaction.guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const name = interaction.options.getString('name')?.trim().toLowerCase();

    if (group === 'template') {
      if (sub === 'list') {
        const list = embeds.templates(interaction.guildId).map((t) => `• \`${t.name}\``);
        return interaction.reply({ embeds: [kit.base({ title: '💾 Embed templates', description: list.join('\n') || 'No templates saved yet.' })], flags: EPHEMERAL });
      }
      if (sub === 'delete') {
        if (!embeds.deleteTemplate(interaction.guildId, name)) throw new UserError(`No template is called \`${name}\`.`, { title: 'Not found' });
        return interaction.reply({ embeds: [kit.success('Template deleted', `\`${name}\` was deleted.`)], flags: EPHEMERAL });
      }
      if (sub === 'save') {
        const message = await fetchOwnMessage(ctx, interaction, interaction.options.getString('message_link', true));
        embeds.saveTemplate(interaction.guildId, name, specFromEmbed(message.embeds[0]), interaction.user.id);
        return interaction.reply({ embeds: [kit.success('Template saved', `Saved as \`${name}\`.`)], flags: EPHEMERAL });
      }
      const template = embeds.template(interaction.guildId, name);
      if (!template) throw new UserError(`No template is called \`${name}\`.`, { title: 'Not found' });
      const draft = newDraft(ctx, interaction, template.data, { channelId: interaction.options.getChannel('channel')?.id ?? interaction.channelId });
      return interaction.reply({ ...previewPayload(draft, `Loaded template \`${name}\`.`), flags: EPHEMERAL });
    }

    if (sub === 'edit') {
      const message = await fetchOwnMessage(ctx, interaction, interaction.options.getString('message_link', true));
      const draft = newDraft(ctx, interaction, specFromEmbed(message.embeds[0]), { editChannelId: message.channelId, editMessageId: message.id });
      return interaction.reply({ ...previewPayload(draft, `Editing [this message](${message.url}).`), flags: EPHEMERAL });
    }

    const draft = newDraft(ctx, interaction, STARTER, { channelId: interaction.options.getChannel('channel')?.id ?? interaction.channelId });
    return interaction.reply({ ...previewPayload(draft), flags: EPHEMERAL });
  },
};

export default {
  commands: [command],
  components: [
    {
      id: 'embed:text',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const { data } = requireDraft(ctx, interaction, id);
        await interaction.showModal(new ModalBuilder().setCustomId(cid('embed', 'textsubmit', id)).setTitle('Embed text').addComponents(
          input('title', 'Title', TextInputStyle.Short, data.title, 256),
          input('description', 'Description', TextInputStyle.Paragraph, data.description, 4000),
          input('color', 'Colour (hex, e.g. #C084FC)', TextInputStyle.Short, data.color, 7),
          input('image', 'Image link', TextInputStyle.Short, data.image, 500),
          input('footer', 'Footer', TextInputStyle.Short, data.footer?.text, 2048),
        ));
      },
    },
    {
      id: 'embed:textsubmit',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const draft = requireDraft(ctx, interaction, id);
        const value = (field) => interaction.fields.getTextInputValue(field).trim() || undefined;
        draft.data = {
          ...draft.data,
          title: value('title'),
          description: value('description'),
          image: value('image'),
          color: value('color'),
          footer: value('footer') ? { text: value('footer') } : undefined,
        };
        await interaction.update(previewPayload(saveDraft(ctx, interaction, draft)));
      },
    },
    {
      id: 'embed:extras',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const { data } = requireDraft(ctx, interaction, id);
        await interaction.showModal(new ModalBuilder().setCustomId(cid('embed', 'extrassubmit', id)).setTitle('Embed extras').addComponents(
          input('author', 'Author name', TextInputStyle.Short, data.author?.name, 256),
          input('authorIcon', 'Author icon link', TextInputStyle.Short, data.author?.iconURL, 500),
          input('thumbnail', 'Thumbnail link', TextInputStyle.Short, data.thumbnail, 500),
          input('url', 'Title link', TextInputStyle.Short, data.url, 500),
          input('fields', 'Fields: Name | Value | inline (one per line)', TextInputStyle.Paragraph, formatFields(data.fields), 4000),
        ));
      },
    },
    {
      id: 'embed:extrassubmit',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const draft = requireDraft(ctx, interaction, id);
        const value = (field) => interaction.fields.getTextInputValue(field).trim() || undefined;
        draft.data = {
          ...draft.data,
          author: value('author') ? { name: value('author'), iconURL: value('authorIcon') } : undefined,
          thumbnail: value('thumbnail'),
          url: value('url'),
          fields: parseFields(value('fields')),
        };
        await interaction.update(previewPayload(saveDraft(ctx, interaction, draft)));
      },
    },
    {
      id: 'embed:post',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const draft = requireDraft(ctx, interaction, id);
        const { embed, errors } = buildEmbed(draft.data);
        if (errors.length) throw new UserError(errors.join('\n'), { title: 'Embed has problems' });
        const kit = ctx.embeds.for(interaction.guildId);
        let message;
        if (draft.edit_message_id) {
          const channel = await ctx.client.channels.fetch(draft.edit_channel_id).catch(() => null);
          const original = await channel?.messages.fetch(draft.edit_message_id).catch(() => null);
          if (!original) throw new UserError('The original message no longer exists.', { title: 'Not found' });
          message = await original.edit({ embeds: [embed] });
        } else {
          const channel = await assertCanPost(await ctx.client.channels.fetch(draft.channel_id ?? interaction.channelId).catch(() => null));
          message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        }
        getServices(ctx).embeds.deleteDraft(id);
        await interaction.update({ content: '', embeds: [kit.success(draft.edit_message_id ? 'Embed updated' : 'Embed posted', `[Jump to it](${message.url})`)], components: [] });
      },
    },
    {
      id: 'embed:savetemplate',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        requireDraft(ctx, interaction, id);
        await interaction.showModal(new ModalBuilder().setCustomId(cid('embed', 'templatesubmit', id)).setTitle('Save as template').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Template name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50)),
        ));
      },
    },
    {
      id: 'embed:templatesubmit',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        const draft = requireDraft(ctx, interaction, id);
        const name = interaction.fields.getTextInputValue('name').trim().toLowerCase();
        getServices(ctx).embeds.saveTemplate(interaction.guildId, name, draft.data, interaction.user.id);
        await interaction.update(previewPayload(draft, `💾 Saved as template \`${name}\`.`));
      },
    },
    {
      id: 'embed:discard',
      tier: 'admin',
      async execute(interaction, ctx, [id]) {
        getServices(ctx).embeds.deleteDraft(id);
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.update({ content: '', embeds: [kit.info('Draft discarded', 'Nothing was posted.')], components: [] });
      },
    },
  ],
};
