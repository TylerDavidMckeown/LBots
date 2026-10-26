import { Events, SlashCommandBuilder } from 'discord.js';
import { runOnce } from '@lyss/shared/db.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { getServices, settingsFor } from '../services/index.js';
import { assignableProblem } from '../services/roles.js';
import { EPHEMERAL, fetchChannel } from './common.js';

const PINK = 0xf47fff;

export function boostEmbed(ctx, member) {
  const { guild } = member;
  const kit = ctx.embeds.for(guild.id);
  return kit.base({ title: '💜 Thank you for boosting!', description: `${member} just boosted **${guild.name}**!`, colour: PINK })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Total boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
      { name: 'Server level', value: guild.premiumTier ? `Level ${guild.premiumTier}` : 'No level yet', inline: true },
      { name: 'Perks', value: truncate(ctx.guildConfig.get(guild.id, 'boost.perks'), 1024) },
    );
}

async function boosterRole(ctx, guild) {
  const roleId = ctx.guildConfig.get(guild.id, 'role.booster');
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  if (!role) return null;
  const problem = await assignableProblem(ctx, guild, role);
  if (problem) {
    ctx.logger.warn('Booster role cannot be assigned', { guildId: guild.id, problem });
    return null;
  }
  return role;
}

async function onBoostStart(ctx, member) {
  const { guild } = member;
  const { boosts, economy } = getServices(ctx);
  boosts.record(guild.id, member.id, 'start');

  const role = await boosterRole(ctx, guild);
  if (role) await member.roles.add(role, 'Server booster reward').catch((error) => ctx.logger.warn('Could not add booster role', { error: error.message }));

  // Granted once per boost: the key includes when the boost started.
  const reward = ctx.guildConfig.get(guild.id, 'boost.reward');
  if (reward > 0) {
    try {
      runOnce(ctx.db, `boost-reward:${guild.id}:${member.id}:${member.premiumSinceTimestamp}`, () => economy.credit({
        guildId: guild.id, userId: member.id, amount: reward, type: 'boost_reward', settings: settingsFor(ctx, guild.id),
      }).wallet);
    } catch (error) {
      ctx.logger.warn('Boost reward not granted', { guildId: guild.id, userId: member.id, error: error.message });
    }
  }

  if (!ctx.guildConfig.get(guild.id, 'boost.enabled')) return;
  const channel = await fetchChannel(ctx, ctx.guildConfig.get(guild.id, 'channel.boost'));
  await safeSend(channel, { content: `${member}`, embeds: [boostEmbed(ctx, member)], allowedMentions: { users: [member.id] } }, { logger: ctx.logger });
}

async function onBoostStop(ctx, member) {
  const { guild } = member;
  getServices(ctx).boosts.record(guild.id, member.id, 'stop');
  const role = await boosterRole(ctx, guild);
  if (role && member.roles.cache.has(role.id)) await member.roles.remove(role, 'No longer boosting').catch(() => {});
  // Stopping is private by default.
  if (!ctx.guildConfig.get(guild.id, 'boost.announceStop')) return;
  const channel = await fetchChannel(ctx, ctx.guildConfig.get(guild.id, 'channel.boost'));
  const kit = ctx.embeds.for(guild.id);
  await safeSend(channel, { embeds: [kit.info('Boost ended', `${member.user.tag} is no longer boosting. Thank you for your support!`)] }, { logger: ctx.logger });
}

const command = {
  data: new SlashCommandBuilder().setName('boost').setDescription('Server boost announcements and rewards')
    .addSubcommand((s) => s.setName('test').setDescription('Preview the boost announcement'))
    .addSubcommand((s) => s.setName('toggle').setDescription('Turn boost announcements on or off')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Announce new boosts').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Server boost level and boosters'))
    .addSubcommand((s) => s.setName('rewards').setDescription('What boosters receive')),
  category: 'Community',
  tier: 'member',
  subcommandTiers: { test: 'admin', toggle: 'admin' },
  async execute(interaction, ctx) {
    const { guild } = interaction;
    const kit = ctx.embeds.for(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'test') return interaction.reply({ embeds: [boostEmbed(ctx, interaction.member)], flags: EPHEMERAL });
    if (sub === 'toggle') {
      const enabled = interaction.options.getBoolean('enabled', true);
      ctx.guildConfig.set(guild.id, 'boost.enabled', enabled, interaction.user.id);
      return interaction.reply({ embeds: [kit.success('Boost announcements updated', `Announcements are now ${enabled ? 'on' : 'off'}.`)], flags: EPHEMERAL });
    }
    if (sub === 'rewards') {
      const roleId = ctx.guildConfig.get(guild.id, 'role.booster');
      const reward = ctx.guildConfig.get(guild.id, 'boost.reward');
      return interaction.reply({
        embeds: [kit.base({ title: '💜 Booster rewards', colour: PINK, description: ctx.guildConfig.get(guild.id, 'boost.perks') })
          .addFields(
            { name: 'Role', value: roleId ? `<@&${roleId}>` : 'None', inline: true },
            { name: 'One-time reward', value: reward > 0 ? formatCoins(reward) : 'None', inline: true },
          )],
        flags: EPHEMERAL,
      });
    }

    const boosters = guild.roles.premiumSubscriberRole?.members ?? new Map();
    const lines = [...boosters.values()].slice(0, 20).map((m) => `${m} · since ${discordTimestamp(m.premiumSinceTimestamp, 'R')}`);
    return interaction.reply({
      embeds: [kit.base({ title: `💜 ${guild.name} boosts`, colour: PINK })
        .addFields(
          { name: 'Boosts', value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
          { name: 'Level', value: guild.premiumTier ? `Level ${guild.premiumTier}` : 'No level yet', inline: true },
          { name: 'Boosters', value: truncate(lines.join('\n') || 'Nobody is boosting yet.', 1024) },
        )],
      allowedMentions: { parse: [] },
    });
  },
};

export default {
  commands: [command],
  events: [
    {
      name: Events.GuildMemberUpdate,
      async execute(before, after, ctx) {
        if (before.partial) return;
        const was = before.premiumSinceTimestamp;
        const is = after.premiumSinceTimestamp;
        if (!was && is) await onBoostStart(ctx, after);
        else if (was && !is) await onBoostStop(ctx, after);
      },
    },
  ],
};
