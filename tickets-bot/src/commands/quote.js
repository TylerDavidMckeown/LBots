import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { quoteComponents, quoteEmbed } from '../embeds/commissionEmbeds.js';
import { isTicketHandler, requireCommissionInChannel, requireHandler } from '../services/access.js';
import { formatQuoteNumber, parseAmount } from '../services/commissionService.js';
import { getServices } from '../services/index.js';

export default {
  data: new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Commission quotes')
    .addSubcommand((s) => s.setName('create').setDescription('Send a quote for the commission in this ticket')
      .addStringOption((o) => o.setName('amount').setDescription('Price, e.g. 150 or 99.50').setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName('description').setDescription('What the quote includes').setRequired(true).setMaxLength(2000))
      .addIntegerOption((o) => o.setName('revisions').setDescription('Number of included revisions').setMinValue(0).setMaxValue(100))
      .addStringOption((o) => o.setName('delivery').setDescription('Expected delivery, e.g. 2 weeks').setMaxLength(200)))
    .addSubcommand((s) => s.setName('view').setDescription('View a quote')
      .addIntegerOption((o) => o.setName('number').setDescription('Quote number (Q-0001 is 1)').setRequired(true).setMinValue(1))),
  category: 'Commissions',
  tier: 'member',
  async execute(interaction, ctx) {
    const { commissions } = getServices(ctx);
    const kit = ctx.embeds.for(interaction.guildId);

    if (interaction.options.getSubcommand() === 'view') {
      const quote = commissions.getQuoteByNumber(interaction.guildId, interaction.options.getInteger('number', true));
      if (!quote) throw new UserError('That quote does not exist.', { title: 'Quote not found' });
      const commission = commissions.get(quote.commission_id);
      const isClient = commission.client_id === interaction.user.id;
      if (!isClient && !isTicketHandler(ctx, interaction, 'commissions')) {
        throw new UserError('Only the client and the commission team can view this quote.', { title: 'Missing permission' });
      }
      return interaction.reply({ embeds: [quoteEmbed(ctx, quote)], components: isClient ? quoteComponents(quote) : [], flags: MessageFlags.Ephemeral });
    }

    const commission = requireCommissionInChannel(ctx, interaction);
    requireHandler(ctx, interaction, 'commissions');
    const amountCents = parseAmount(interaction.options.getString('amount', true));
    if (!amountCents) throw new UserError('Enter a positive amount such as `150` or `99.50`.', { title: 'Invalid amount' });

    const quote = commissions.createQuote({
      commissionId: commission.id,
      amountCents,
      currency: String(ctx.guildConfig.get(interaction.guildId, 'commissions.currency')).toUpperCase(),
      description: interaction.options.getString('description', true),
      revisions: interaction.options.getInteger('revisions'),
      delivery: interaction.options.getString('delivery'),
      createdBy: interaction.user.id,
    });
    const message = await interaction.channel.send({
      content: `<@${commission.client_id}>, here is your quote. You can accept it, ask for changes or decline it below.`,
      embeds: [quoteEmbed(ctx, quote)],
      components: quoteComponents(quote),
      allowedMentions: { users: [commission.client_id] },
    });
    commissions.setQuoteMessage(quote.id, message.channelId, message.id);
    ctx.logger.info('Quote sent', { guildId: interaction.guildId, quoteId: quote.id, commissionId: commission.id });
    return interaction.reply({ embeds: [kit.success('Quote sent', `${formatQuoteNumber(quote.number)} was sent to <@${commission.client_id}>.`)], flags: MessageFlags.Ephemeral });
  },
};
