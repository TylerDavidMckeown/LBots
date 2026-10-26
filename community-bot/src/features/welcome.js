import { Events, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { isHttpUrl } from '@lyss/shared/embedBuilder/validators.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { formatNumber, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { EPHEMERAL, fetchChannel, linkLines } from './common.js';

/** Replaces {user}, {username}, {server} and {count} in a welcome template. */
export function renderWelcome(template, vars) {
  return String(template).replace(/\{(user|username|server|count)\}/g, (_, key) => vars[key]);
}

export function welcomePayload(ctx, member, { mention = true } = {}) {
  const { guild } = member;
  const kit = ctx.embeds.for(guild.id);
  const text = renderWelcome(ctx.guildConfig.get(guild.id, 'welcome.message'), {
    user: `${member}`, username: member.user.username, server: guild.name, count: formatNumber(guild.memberCount),
  });
  const embed = kit.base({ title: `👋 Welcome to ${guild.name}!`, description: truncate(text, 4000) })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Member', value: `#${formatNumber(guild.memberCount)}`, inline: true },
      { name: 'Account created', value: discordTimestamp(member.user.createdTimestamp, 'R'), inline: true },
    );
  const links = linkLines(ctx, guild.id);
  if (links.length) embed.addFields({ name: 'Get started', value: links.join('\n') });
  const banner = ctx.guildConfig.get(guild.id, 'welcome.banner');
  if (banner) embed.setImage(banner);
  // The mention sits outside the embed so the new member is actually notified.
  return mention
    ? { content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } }
    : { embeds: [embed] };
}

const command = {
  data: new SlashCommandBuilder().setName('welcome').setDescription('Welcome messages')
    .addSubcommand((s) => s.setName('test').setDescription('Preview the welcome message'))
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn welcome messages on or off')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Send welcome messages').setRequired(true)))
    .addSubcommand((s) => s.setName('configure').setDescription('Change the welcome text or banner')
      .addStringOption((o) => o.setName('message').setDescription('Text with {user}, {username}, {server} and {count}').setMaxLength(1000))
      .addStringOption((o) => o.setName('banner').setDescription('Banner image link, or "none"').setMaxLength(500))),
  category: 'Community',
  tier: 'admin',
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'test') {
      const channelId = ctx.guildConfig.get(guildId, 'channel.welcome');
      const note = !channelId ? '⚠️ No welcome channel is set. Use `/setup channel` › Welcome channel.'
        : !ctx.guildConfig.get(guildId, 'welcome.enabled') ? '⚠️ Welcome messages are turned off.' : `Messages are posted in <#${channelId}>.`;
      return interaction.reply({ content: note, ...welcomePayload(ctx, interaction.member, { mention: false }), flags: EPHEMERAL });
    }
    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.guildConfig.set(guildId, 'welcome.enabled', enabled, interaction.user.id);
      return interaction.reply({ embeds: [kit.success('Welcome messages updated', `Welcome messages are now ${enabled ? 'on' : 'off'}.`)], flags: EPHEMERAL });
    }

    const message = interaction.options.getString('message');
    const banner = interaction.options.getString('banner')?.trim();
    if (!message && !banner) throw new UserError('Provide a new message or banner.', { title: 'Nothing to change' });
    if (banner && !/^none$/i.test(banner) && !isHttpUrl(banner)) throw new UserError('The banner must be a full image link.', { title: 'Invalid banner' });
    if (message) ctx.guildConfig.set(guildId, 'welcome.message', message, interaction.user.id);
    if (banner && /^none$/i.test(banner)) ctx.guildConfig.unset(guildId, 'welcome.banner');
    else if (banner) ctx.guildConfig.set(guildId, 'welcome.banner', banner, interaction.user.id);
    return interaction.reply({ embeds: [kit.success('Welcome message saved', 'Use `/welcome test` to preview it.')], flags: EPHEMERAL });
  },
};

export default {
  commands: [command],
  events: [
    {
      name: Events.GuildMemberAdd,
      async execute(member, ctx) {
        if (member.user.bot || !ctx.guildConfig.get(member.guild.id, 'welcome.enabled')) return;
        const channel = await fetchChannel(ctx, ctx.guildConfig.get(member.guild.id, 'channel.welcome'));
        await safeSend(channel, welcomePayload(ctx, member), { logger: ctx.logger });
      },
    },
  ],
};
