import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatSettingValue, parseSettingValue } from '@lyss/shared/setupKit.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { getServices } from '../services/index.js';
import { ANTISPAM_SETTINGS, RULE_TEXT } from '../services/spamDetector.js';

const SETTING_CHOICES = ANTISPAM_SETTINGS.map((s) => ({ name: truncate(s.label, 100), value: s.key }));

const targetOptions = (s) => s
  .addRoleOption((o) => o.setName('role').setDescription('Role to exempt'))
  .addChannelOption((o) => o.setName('channel').setDescription('Channel or category to exempt')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory));

function whitelistTarget(interaction) {
  const role = interaction.options.getRole('role');
  const channel = interaction.options.getChannel('channel');
  if (Boolean(role) === Boolean(channel)) throw new UserError('Choose exactly one role or one channel.', { title: 'Choose one' });
  return role ? { kind: 'role', id: role.id, label: `<@&${role.id}>` } : { kind: 'channel', id: channel.id, label: `<#${channel.id}>` };
}

function displayValue(setting, value) {
  if (setting.key === 'antispam.allowedInvites') return value ? `\`${truncate(value, 100)}\`` : 'none';
  return formatSettingValue(setting, value);
}

export default {
  data: new SlashCommandBuilder().setName('antispam').setDescription('Configure anti-spam')
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn anti-spam on or off')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Enable anti-spam').setRequired(true)))
    .addSubcommand((s) => s.setName('config').setDescription('Change an anti-spam setting')
      .addStringOption((o) => o.setName('setting').setDescription('Setting').setRequired(true).addChoices(...SETTING_CHOICES))
      .addStringOption((o) => o.setName('value').setDescription('New value (numbers, on/off, or invite codes)').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('status').setDescription('Show anti-spam settings and recent activity'))
    .addSubcommandGroup((g) => g.setName('whitelist').setDescription('Roles and channels anti-spam ignores')
      .addSubcommand((s) => targetOptions(s.setName('add').setDescription('Exempt a role or channel')))
      .addSubcommand((s) => targetOptions(s.setName('remove').setDescription('Stop exempting a role or channel')))
      .addSubcommand((s) => s.setName('list').setDescription('List exemptions'))),
  category: 'Anti-spam',
  tier: 'admin',
  subcommandTiers: { status: 'moderator', 'whitelist list': 'moderator' },
  async execute(interaction, ctx) {
    const { antispam } = getServices(ctx);
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    if (group === 'whitelist') {
      if (sub === 'list') {
        const rows = antispam.listWhitelist(guildId);
        const lines = rows.map((r) => `${r.kind === 'role' ? `<@&${r.target_id}>` : `<#${r.target_id}>`} · ${r.kind}`);
        return reply(kit.base({ title: '🛡️ Anti-spam exemptions', description: lines.join('\n') || 'No exemptions. Staff are always exempt.' }));
      }
      const target = whitelistTarget(interaction);
      if (sub === 'add') {
        if (!antispam.whitelist(guildId, target.kind, target.id, interaction.user.id)) throw new UserError(`${target.label} is already exempt.`, { title: 'Already exempt' });
        return reply(kit.success('Exemption added', `Anti-spam will ignore ${target.label}.`));
      }
      if (!antispam.unwhitelist(guildId, target.kind, target.id)) throw new UserError(`${target.label} is not exempt.`, { title: 'Not exempt' });
      return reply(kit.success('Exemption removed', `Anti-spam applies to ${target.label} again.`));
    }

    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.guildConfig.set(guildId, 'antispam.enabled', enabled, interaction.user.id);
      ctx.logger.info('Anti-spam toggled', { guildId, enabled, by: interaction.user.id });
      return reply(kit.success(`Anti-spam ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'Messages are now checked for spam. Staff and exempt roles or channels are ignored.' : 'Messages are no longer checked for spam.'));
    }

    if (sub === 'config') {
      const setting = ANTISPAM_SETTINGS.find((s) => s.key === interaction.options.getString('setting', true));
      const raw = interaction.options.getString('value', true).trim();
      // Invite codes may be cleared with "none"; everything else uses the shared validators.
      const { value, error } = setting.key === 'antispam.allowedInvites'
        ? { value: /^none$/i.test(raw) ? '' : raw }
        : parseSettingValue(setting, raw);
      if (error) throw new UserError(error, { title: 'Invalid value' });
      ctx.guildConfig.set(guildId, setting.key, value, interaction.user.id);
      ctx.logger.info('Anti-spam setting changed', { guildId, key: setting.key, by: interaction.user.id });
      return reply(kit.success('Setting saved', `**${setting.label}** is now ${displayValue(setting, value)}.`));
    }

    const enabled = ctx.guildConfig.get(guildId, 'antispam.enabled');
    const settings = ANTISPAM_SETTINGS.map((s) => `${s.label}: **${displayValue(s, ctx.guildConfig.get(guildId, s.key))}**`);
    const recent = antispam.offenceSummary(guildId, Date.now() - 86_400_000);
    const activity = recent.map((r) => `${RULE_TEXT[r.rule] ?? r.rule}: ${r.n}`).join('\n') || 'No offences in the last 24 hours.';
    return reply(kit.base({ title: '🛡️ Anti-spam status', description: enabled ? '🟢 Enabled' : '🔴 Disabled' })
      .addFields(
        { name: 'Settings', value: truncate(settings.join('\n'), 1024) },
        { name: 'Exemptions', value: `${antispam.listWhitelist(guildId).length} role(s) or channel(s), plus all staff`, inline: true },
        { name: 'Last 24 hours', value: truncate(activity, 1024), inline: true },
      ));
  },
};
