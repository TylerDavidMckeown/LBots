import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { formatDuration } from '@lyss/shared/utils/time.js';
import { formatNumber } from '@lyss/shared/utils/text.js';
import { stars } from '../embeds/ticketEmbeds.js';
import { getServices } from '../services/index.js';
import { TICKET_TYPES } from '../services/ticketTypes.js';

export default {
  data: new SlashCommandBuilder().setName('ticketstats').setDescription('Ticket statistics for this server'),
  category: 'Tickets',
  tier: 'staff',
  cooldown: 5,
  async execute(interaction, ctx) {
    const s = getServices(ctx).tickets.stats(interaction.guildId);
    const kit = ctx.embeds.for(interaction.guildId);
    const byType = Object.values(TICKET_TYPES).map((type) => {
      const c = s.counts[type.key] ?? { open: 0, closed: 0, deleted: 0 };
      return `${type.emoji} **${type.label}**: ${c.open} open · ${c.closed} closed · ${formatNumber(c.open + c.closed + c.deleted)} total`;
    });
    const rating = s.ratings.n ? `${s.ratings.avg.toFixed(2)} / 5 ${stars(Math.round(s.ratings.avg))} (${s.ratings.n})` : 'No ratings yet';
    const resolution = s.resolution30d.n ? formatDuration(s.resolution30d.avg) : 'n/a';
    const claimers = s.claimers.length ? s.claimers.map((c, i) => `${i + 1}. <@${c.claimed_by}> · ${c.n}`).join('\n') : 'No claims yet';

    const embed = kit.base({ title: '📊 Ticket statistics', description: byType.join('\n') })
      .addFields(
        { name: 'Opened (7 days)', value: formatNumber(s.opened7d), inline: true },
        { name: 'Opened (30 days)', value: formatNumber(s.opened30d), inline: true },
        { name: 'Avg. time to close (30 days)', value: resolution, inline: true },
        { name: 'Satisfaction', value: rating, inline: true },
        { name: 'Blacklisted members', value: formatNumber(s.blacklisted), inline: true },
        { name: 'Top claimers', value: claimers },
      );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
