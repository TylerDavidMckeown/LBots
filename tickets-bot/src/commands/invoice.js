import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { invoiceEmbed } from '../embeds/commissionEmbeds.js';
import { isTicketHandler, requireHandler } from '../services/access.js';
import { dm, postInCommission } from '../services/commissionActions.js';
import { formatInvoiceNumber } from '../services/commissionService.js';
import { getServices } from '../services/index.js';

const numberOption = (o) => o.setName('number').setDescription('Invoice number (INV-0001 is 1)').setRequired(true).setMinValue(1);

function requireInvoice(ctx, interaction) {
  const invoice = getServices(ctx).commissions.getInvoiceByNumber(interaction.guildId, interaction.options.getInteger('number', true));
  if (!invoice) throw new UserError('That invoice does not exist.', { title: 'Invoice not found' });
  return invoice;
}

export default {
  data: new SlashCommandBuilder()
    .setName('invoice')
    .setDescription('Commission invoices')
    .addSubcommand((s) => s.setName('create').setDescription('Create an invoice for an accepted quote')
      .addIntegerOption((o) => o.setName('quote').setDescription('Quote number (Q-0001 is 1)').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('paid').setDescription('Mark an invoice as paid').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('unpaid').setDescription('Mark an invoice as unpaid').addIntegerOption(numberOption))
    .addSubcommand((s) => s.setName('view').setDescription('View an invoice').addIntegerOption(numberOption)),
  category: 'Commissions',
  tier: 'member',
  async execute(interaction, ctx) {
    const { commissions } = getServices(ctx);
    const sub = interaction.options.getSubcommand();
    const kit = ctx.embeds.for(interaction.guildId);

    if (sub === 'view') {
      const invoice = requireInvoice(ctx, interaction);
      const commission = commissions.get(invoice.commission_id);
      if (commission.client_id !== interaction.user.id && !isTicketHandler(ctx, interaction, 'commissions')) {
        throw new UserError('Only the client and the commission team can view this invoice.', { title: 'Missing permission' });
      }
      return interaction.reply({ embeds: [invoiceEmbed(ctx, invoice, commission)], flags: MessageFlags.Ephemeral });
    }

    // Creating invoices and changing payment status is restricted to the commission team.
    requireHandler(ctx, interaction, 'commissions');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (sub === 'create') {
      const invoice = commissions.createInvoice({
        guildId: interaction.guildId,
        quoteNumber: interaction.options.getInteger('quote', true),
        createdBy: interaction.user.id,
      });
      const commission = commissions.get(invoice.commission_id);
      const embed = invoiceEmbed(ctx, invoice, commission);
      await postInCommission(ctx, commission, { content: `<@${commission.client_id}>, your invoice is ready.`, embeds: [embed], allowedMentions: { users: [commission.client_id] } });
      await dm(ctx, commission.client_id, { content: `You have a new invoice from **${interaction.guild.name}**.`, embeds: [embed] });
      ctx.logger.info('Invoice created', { guildId: interaction.guildId, invoiceId: invoice.id, by: interaction.user.id });
      return interaction.editReply({ embeds: [kit.success('Invoice created', `${formatInvoiceNumber(invoice.number)} was sent to <@${commission.client_id}>.`)] });
    }

    const invoice = requireInvoice(ctx, interaction);
    const paid = sub === 'paid';
    if (!commissions.setInvoicePaid(invoice.id, paid, interaction.user.id)) {
      throw new UserError(`${formatInvoiceNumber(invoice.number)} is already marked ${paid ? 'paid' : 'unpaid'}.`, { title: 'No change' });
    }
    const updated = commissions.getInvoiceByNumber(interaction.guildId, invoice.number);
    const commission = commissions.get(updated.commission_id);
    ctx.logger.info('Invoice status changed', { guildId: interaction.guildId, invoiceId: invoice.id, paid, by: interaction.user.id });
    await postInCommission(ctx, commission, { embeds: [invoiceEmbed(ctx, updated, commission)] });
    return interaction.editReply({ embeds: [kit.success('Invoice updated', `${formatInvoiceNumber(updated.number)} is now marked **${paid ? 'paid' : 'unpaid'}**.`)] });
  },
};
