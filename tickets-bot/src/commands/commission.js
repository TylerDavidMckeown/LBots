import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { commissionEmbed } from '../embeds/commissionEmbeds.js';
import { isTicketHandler, requireCommissionInChannel, requireHandler } from '../services/access.js';
import { notifyStatusChange } from '../services/commissionActions.js';
import { COMMISSION_STATUSES, MANUAL_STATUSES } from '../services/commissionService.js';
import { getServices } from '../services/index.js';

const STATUS_CHOICES = MANUAL_STATUSES.map((value) => ({ name: COMMISSION_STATUSES[value].label, value }));

async function changeStatus(interaction, ctx, commission, to, note) {
  requireHandler(ctx, interaction, 'commissions');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = getServices(ctx).commissions.transition(commission.id, to, { actorId: interaction.user.id, note });
  await notifyStatusChange(ctx, result, interaction.user.id, note);
  const kit = ctx.embeds.for(interaction.guildId);
  return interaction.editReply({ embeds: [kit.success('Commission updated', `Commission #${commission.id} is now **${COMMISSION_STATUSES[to].label}**. The client has been notified.`)] });
}

export default {
  data: new SlashCommandBuilder()
    .setName('commission')
    .setDescription('The commission in this ticket')
    .addSubcommand((s) => s.setName('view').setDescription('Show the commission, its quotes and invoices'))
    .addSubcommand((s) => s.setName('status').setDescription('Move the commission to its next stage')
      .addStringOption((o) => o.setName('status').setDescription('New status').setRequired(true).addChoices(...STATUS_CHOICES))
      .addStringOption((o) => o.setName('note').setDescription('Message for the client').setMaxLength(500)))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel the commission')
      .addStringOption((o) => o.setName('reason').setDescription('Reason for cancelling').setRequired(true).setMaxLength(500))),
  category: 'Commissions',
  tier: 'member',
  async execute(interaction, ctx) {
    const { commissions } = getServices(ctx);
    const commission = requireCommissionInChannel(ctx, interaction);
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      if (commission.client_id !== interaction.user.id && !isTicketHandler(ctx, interaction, 'commissions')) {
        throw new UserError('Only the client and the commission team can view this.', { title: 'Missing permission' });
      }
      return interaction.reply({
        embeds: [commissionEmbed(ctx, commission, { quotes: commissions.quotesFor(commission.id), invoices: commissions.invoicesFor(commission.id) })],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (sub === 'status') return changeStatus(interaction, ctx, commission, interaction.options.getString('status', true), interaction.options.getString('note'));
    return changeStatus(interaction, ctx, commission, 'cancelled', interaction.options.getString('reason', true));
  },
};
