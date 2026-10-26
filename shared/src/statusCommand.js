import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { healthCheck } from './db.js';
import { discordTimestamp } from './utils/time.js';
import { formatBytes, formatNumber } from './utils/text.js';

export function createStatusCommand(config) {
  return {
    data: new SlashCommandBuilder().setName('status').setDescription(`Show ${config.name}'s health and uptime`),
    category: 'General',
    tier: 'restricted',
    cooldown: 5,
    async execute(interaction, ctx) {
      const kit = ctx.embeds.for(interaction.guildId);
      const health = healthCheck(ctx.db);
      const ping = ctx.client.ws.ping;
      const embed = kit.base({ title: `${config.name} status`, description: `${kit.emojis.success} Online and responding.` })
        .addFields(
          { name: 'Online since', value: discordTimestamp(ctx.startedAt, 'R'), inline: true },
          { name: 'Gateway ping', value: ping >= 0 ? `${ping} ms` : 'measuring…', inline: true },
          { name: 'Memory', value: formatBytes(process.memoryUsage().rss), inline: true },
          { name: 'Database', value: health.ok ? `${kit.emojis.success} Healthy` : `${kit.emojis.error} Needs attention`, inline: true },
          { name: 'Scheduled jobs', value: formatNumber(ctx.scheduler.pendingCount()), inline: true },
          { name: 'Servers', value: formatNumber(ctx.client.guilds.cache.size), inline: true },
          { name: 'Version', value: `v${ctx.version}`, inline: true },
          { name: 'Node.js', value: process.version, inline: true },
          { name: 'Commands', value: formatNumber(ctx.commands.size), inline: true },
        );
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  };
}
