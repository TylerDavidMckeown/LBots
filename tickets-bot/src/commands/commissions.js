import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { requireHandler } from '../services/access.js';
import { statusLabel } from '../services/commissionService.js';
import { getServices } from '../services/index.js';
import { commissionAvailability } from '../services/panelService.js';
import { refreshCommissionPanel } from '../services/ticketActions.js';

function availabilityText(a) {
  return `${a.open ? '🟢 Open' : '🔴 Closed'} · ${a.active} of ${a.slots} slot${a.slots === 1 ? '' : 's'} in use`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('commissions')
    .setDescription('Manage commission availability')
    .addSubcommand((s) => s.setName('open').setDescription('Start accepting commission requests'))
    .addSubcommand((s) => s.setName('closed').setDescription('Stop accepting commission requests'))
    .addSubcommand((s) => s.setName('slots').setDescription('Set how many commissions can be active at once')
      .addIntegerOption((o) => o.setName('count').setDescription('Number of slots').setRequired(true).setMinValue(0).setMaxValue(50)))
    .addSubcommand((s) => s.setName('list').setDescription('List commissions that are not finished')),
  category: 'Commissions',
  tier: 'member',
  async execute(interaction, ctx) {
    requireHandler(ctx, interaction, 'commissions');
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);

    if (sub === 'list') {
      const open = getServices(ctx).commissions.listOpen(guildId);
      const lines = open.map((c) => `**#${c.id}** ${statusLabel(c.status)} · <@${c.client_id}> · ${c.ticket_status === 'deleted' ? 'ticket deleted' : `<#${c.channel_id}>`}\n${truncate(c.project_type, 80)}`);
      return interaction.reply({
        embeds: [kit.base({ title: '🎨 Active commissions', description: lines.length ? truncate(lines.join('\n'), 4000) : 'No commissions in progress.' })
          .addFields({ name: 'Availability', value: availabilityText(commissionAvailability(ctx, guildId)) })],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'slots') ctx.guildConfig.set(guildId, 'commissions.slots', interaction.options.getInteger('count', true), interaction.user.id);
    else ctx.guildConfig.set(guildId, 'commissions.open', sub === 'open', interaction.user.id);
    ctx.logger.info('Commission availability changed', { guildId, by: interaction.user.id, change: sub });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await refreshCommissionPanel(ctx, guildId);
    const title = { open: 'Commissions open', closed: 'Commissions closed', slots: 'Slots updated' }[sub];
    return interaction.editReply({ embeds: [kit.success(title, availabilityText(commissionAvailability(ctx, guildId)))] });
  },
};
