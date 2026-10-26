import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { portfolioPage } from '../embeds/commissionEmbeds.js';
import { requireHandler } from '../services/access.js';
import { normaliseTags } from '../services/commissionService.js';
import { getServices } from '../services/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('portfolio')
    .setDescription('Lyss\'s commission portfolio')
    .addSubcommand((s) => s.setName('view').setDescription('Browse the portfolio')
      .addStringOption((o) => o.setName('tag').setDescription('Only show entries with this tag').setMaxLength(30)))
    .addSubcommand((s) => s.setName('add').setDescription('Add a portfolio entry')
      .addStringOption((o) => o.setName('title').setDescription('Title').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('description').setDescription('Description').setMaxLength(1000))
      .addStringOption((o) => o.setName('image_url').setDescription('Direct https link to an image').setMaxLength(500))
      .addStringOption((o) => o.setName('tags').setDescription('Comma-separated tags, e.g. logo, branding').setMaxLength(200)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a portfolio entry')
      .addIntegerOption((o) => o.setName('id').setDescription('Entry number').setRequired(true).setMinValue(1))),
  category: 'Commissions',
  tier: 'restricted',
  subcommandTiers: { add: 'member', remove: 'member' },
  async execute(interaction, ctx) {
    const services = getServices(ctx);
    const sub = interaction.options.getSubcommand();
    const kit = ctx.embeds.for(interaction.guildId);

    if (sub === 'view') {
      const [tag = null] = normaliseTags(interaction.options.getString('tag'));
      return interaction.reply(portfolioPage(ctx, interaction.guildId, 1, tag, services));
    }

    requireHandler(ctx, interaction, 'commissions');
    if (sub === 'remove') {
      const id = interaction.options.getInteger('id', true);
      if (!services.commissions.removePortfolio(interaction.guildId, id)) throw new UserError(`Portfolio entry #${id} does not exist.`, { title: 'Not found' });
      return interaction.reply({ embeds: [kit.success('Entry removed', `Portfolio entry #${id} was removed.`)], flags: MessageFlags.Ephemeral });
    }

    const imageUrl = interaction.options.getString('image_url');
    if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) throw new UserError('The image must be a direct https link.', { title: 'Invalid image' });
    const entry = services.commissions.addPortfolio({
      guildId: interaction.guildId,
      title: interaction.options.getString('title', true),
      description: interaction.options.getString('description'),
      imageUrl,
      tags: normaliseTags(interaction.options.getString('tags')),
      createdBy: interaction.user.id,
    });
    return interaction.reply({ embeds: [kit.success('Entry added', `Portfolio entry #${entry.id} **${entry.title}** was added.`)], flags: MessageFlags.Ephemeral });
  },
};
