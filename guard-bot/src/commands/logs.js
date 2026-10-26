import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { LOG_CATEGORIES, logChannelId } from '../services/logService.js';

const CATEGORY_CHOICES = Object.entries(LOG_CATEGORIES).map(([value, description]) => ({ name: `${value} — ${description}`.slice(0, 100), value }));

const channelOption = (o) => o.setName('channel').setDescription('Channel or category').setRequired(true)
  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildVoice);

export default {
  data: new SlashCommandBuilder().setName('logs').setDescription('Configure server logging')
    .addSubcommand((s) => s.setName('status').setDescription('Show where each log category is sent'))
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn a log category on or off')
      .addStringOption((o) => o.setName('category').setDescription('Log category').setRequired(true).addChoices(...CATEGORY_CHOICES))
      .addBooleanOption((o) => o.setName('enabled').setDescription('Enable this category').setRequired(true)))
    .addSubcommand((s) => s.setName('ignore').setDescription('Stop logging messages from a channel').addChannelOption(channelOption))
    .addSubcommand((s) => s.setName('unignore').setDescription('Log messages from a channel again').addChannelOption(channelOption)),
  category: 'Logging',
  tier: 'admin',
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const sub = interaction.options.getSubcommand();
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    const ignored = ctx.guildConfig.get(guildId, 'logs.ignoredChannels') ?? [];

    if (sub === 'toggle') {
      const category = interaction.options.getString('category', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.guildConfig.set(guildId, `logs.${category}`, enabled, interaction.user.id);
      const where = logChannelId(ctx, guildId, category);
      const note = enabled && !where ? '\n\n⚠️ No channel is set for it yet. Use `/setup channel` to set its log channel or the shared log channel.' : '';
      return reply(kit.success('Logging updated', `**${category}** logs are now ${enabled ? 'on' : 'off'}.${note}`));
    }

    if (sub === 'ignore' || sub === 'unignore') {
      const channel = interaction.options.getChannel('channel', true);
      const has = ignored.includes(channel.id);
      if (sub === 'ignore' && has) throw new UserError(`<#${channel.id}> is already ignored.`, { title: 'No change' });
      if (sub === 'unignore' && !has) throw new UserError(`<#${channel.id}> is not ignored.`, { title: 'No change' });
      const next = sub === 'ignore' ? [...ignored, channel.id] : ignored.filter((id) => id !== channel.id);
      ctx.guildConfig.set(guildId, 'logs.ignoredChannels', next, interaction.user.id);
      return reply(kit.success('Logging updated', `Messages in <#${channel.id}> will ${sub === 'ignore' ? 'no longer' : 'now'} be logged.`));
    }

    const lines = Object.entries(LOG_CATEGORIES).map(([category, description]) => {
      const on = ctx.guildConfig.get(guildId, `logs.${category}`);
      const where = logChannelId(ctx, guildId, category);
      const status = !on ? '🔴 off' : where ? `🟢 <#${where}>` : '⚠️ on, but no channel set';
      return `**${category}** · ${status}\n${description}`;
    });
    return reply(kit.base({ title: '📜 Logging', description: lines.join('\n\n') })
      .addFields({ name: 'Ignored channels', value: ignored.map((id) => `<#${id}>`).join(' ') || 'None' }));
  },
};
