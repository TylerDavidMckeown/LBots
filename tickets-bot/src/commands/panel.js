import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { editPanel, postPanel } from '../services/panelService.js';
import { TYPE_CHOICES, ticketType } from '../services/ticketTypes.js';

const textOptions = (sub) => sub
  .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(256))
  .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(2000))
  .addStringOption((o) => o.setName('button').setDescription('Button label').setMaxLength(80));

const postSubcommand = (key, description) => (sub) => textOptions(sub.setName(key).setDescription(description)
  .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (defaults to this channel)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

export default {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post or edit ticket panels')
    .addSubcommand(postSubcommand('support', 'Post the support ticket panel'))
    .addSubcommand(postSubcommand('contact', 'Post the Contact Lyss panel'))
    .addSubcommand(postSubcommand('commissions', 'Post the commissions panel'))
    .addSubcommand((sub) => textOptions(sub.setName('edit').setDescription('Edit a posted panel')
      .addStringOption((o) => o.setName('type').setDescription('Which panel').setRequired(true).addChoices(...TYPE_CHOICES)))),
  category: 'Panels',
  tier: 'admin',
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const kit = ctx.embeds.for(interaction.guildId);
    const text = {
      title: interaction.options.getString('title'),
      description: interaction.options.getString('description'),
      buttonLabel: interaction.options.getString('button'),
    };

    if (sub === 'edit') {
      const typeKey = interaction.options.getString('type', true);
      if (!text.title && !text.description && !text.buttonLabel) {
        throw new UserError('Provide a new title, description or button label.', { title: 'Nothing to change' });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const updated = await editPanel(ctx, interaction.guildId, typeKey, text, interaction.user.id);
      const label = ticketType(typeKey).label;
      return interaction.editReply({
        embeds: [updated
          ? kit.success('Panel updated', `The ${label} panel has been updated.`)
          : kit.warning('Saved, but not updated', `The new ${label} panel text was saved, but the posted message could not be found. Post it again with \`/panel ${typeKey}\`.`)],
      });
    }

    const option = interaction.options.getChannel('channel');
    const channel = option ? interaction.guild.channels.cache.get(option.id) : interaction.channel;
    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const permissions = channel?.permissionsFor(me);
    const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks'].filter((name) => !permissions?.has(PermissionFlagsBits[name]));
    if (missing.length) throw new UserError(`I need ${missing.join(', ')} in ${channel ?? 'that channel'} to post the panel.`, { title: 'Missing permissions' });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await postPanel(ctx, channel, sub, text, interaction.user.id);
    return interaction.editReply({
      embeds: [kit.success('Panel posted', `The ${ticketType(sub).label} panel is live in ${channel}. [Jump to it](${message.url})`)],
    });
  },
};
