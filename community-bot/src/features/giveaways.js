import crypto from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SlashCommandBuilder,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatNumber, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { getServices } from '../services/index.js';
import {
  assertCanPost, cid, EPHEMERAL, fetchChannel, readDuration,
} from './common.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const GOLD = 0xf1c40f;

/** Unbiased shuffle using a cryptographic random source. */
export function shuffle(items, randomInt = crypto.randomInt) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function giveawayPayload(ctx, giveaway, entryCount) {
  const kit = ctx.embeds.for(giveaway.guild_id);
  const active = giveaway.status === 'active';
  const winners = giveaway.winners.map((id) => `<@${id}>`).join(', ');
  const description = active
    ? `Click **Enter** to join!\nEnds ${discordTimestamp(giveaway.ends_at, 'R')} (${discordTimestamp(giveaway.ends_at, 'f')})`
    : giveaway.status === 'cancelled' ? 'This giveaway was cancelled.'
      : winners ? `🏆 Winner${giveaway.winners.length === 1 ? '' : 's'}: ${winners}` : 'No valid entries, so there is no winner.';
  const embed = kit.base({ title: `🎉 ${truncate(giveaway.prize, 240)}`, description, colour: active ? GOLD : 0x99aab5 })
    .addFields(
      { name: 'Hosted by', value: `<@${giveaway.host_id}>`, inline: true },
      { name: 'Winners', value: String(giveaway.winner_count), inline: true },
      { name: 'Entries', value: formatNumber(entryCount), inline: true },
    )
    .setFooter({ text: `Giveaway #${giveaway.id}${active ? '' : ' · ended'}` });
  if (giveaway.required_role_id) embed.addFields({ name: 'Requirement', value: `<@&${giveaway.required_role_id}>`, inline: true });
  const components = active ? [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('giveaway', 'enter', giveaway.id)).setEmoji('🎉').setLabel(`Enter (${formatNumber(entryCount)})`).setStyle(ButtonStyle.Primary),
  )] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Picks winners, re-checking that each is still a member and still meets the role requirement. */
async function pickWinners(guild, giveaway, candidates, count) {
  const winners = [];
  for (const userId of shuffle(candidates)) {
    if (winners.length >= count) break;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) continue;
    if (giveaway.required_role_id && !member.roles.cache.has(giveaway.required_role_id)) continue;
    winners.push(userId);
  }
  return winners;
}

async function updateMessage(ctx, giveaway) {
  const channel = await fetchChannel(ctx, giveaway.channel_id);
  const message = await channel?.messages.fetch(giveaway.message_id).catch(() => null);
  await message?.edit(giveawayPayload(ctx, giveaway, getServices(ctx).giveaways.count(giveaway.id))).catch(() => {});
  return { channel, message };
}

async function announce(ctx, giveaway, { reroll = false } = {}) {
  const { channel, message } = await updateMessage(ctx, giveaway);
  if (channel) {
    const mentions = giveaway.winners.map((id) => `<@${id}>`).join(', ');
    const content = giveaway.winners.length
      ? `🎉 ${reroll ? 'New winner' : 'Congratulations'}${giveaway.winners.length === 1 ? '' : 's'} ${mentions}! You won **${giveaway.prize}**!`
      : `No valid entries for **${giveaway.prize}**, so there is no winner.`;
    await channel.send({
      content,
      allowedMentions: { users: giveaway.winners },
      reply: message ? { messageReference: message.id, failIfNotExists: false } : undefined,
    }).catch((error) => ctx.logger.warn('Could not announce giveaway', { error: error.message }));
  }
  getServices(ctx).giveaways.markAnnounced(giveaway.id);
}

/**
 * Ends a giveaway exactly once. Safe to call repeatedly (scheduler retries, /giveaway end):
 * winners are stored before announcing, and announcing is skipped once recorded.
 */
export async function endGiveaway(ctx, giveawayId) {
  const { giveaways } = getServices(ctx);
  let giveaway = giveaways.get(giveawayId);
  if (!giveaway) return null;
  if (giveaway.status === 'active') {
    const guild = await ctx.client.guilds.fetch(giveaway.guild_id);
    const winners = await pickWinners(guild, giveaway, giveaways.entries(giveaway.id), giveaway.winner_count);
    giveaways.finish(giveaway.id, winners);
    giveaway = giveaways.get(giveawayId);
  }
  if (giveaway.status === 'ended' && !giveaway.announced_at) await announce(ctx, giveaway);
  return giveaway;
}

function requireGiveaway(ctx, interaction) {
  const giveaway = getServices(ctx).giveaways.get(interaction.options.getInteger('id', true));
  if (!giveaway || giveaway.guild_id !== interaction.guildId) throw new UserError('That giveaway does not exist.', { title: 'Not found' });
  return giveaway;
}

const idOption = (o) => o.setName('id').setDescription('Giveaway number (shown in its footer)').setRequired(true).setMinValue(1);

const command = {
  data: new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways')
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 1h, 2d (max 30d)').setRequired(true).setMaxLength(20))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can win'))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post (defaults to here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winners').addIntegerOption(idOption)
      .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners').setMinValue(1).setMaxValue(20)))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway without winners').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('list').setDescription('List running giveaways')),
  category: 'Community',
  tier: 'moderator',
  subcommandTiers: { list: 'member' },
  async execute(interaction, ctx) {
    const { giveaways } = getServices(ctx);
    const kit = ctx.embeds.for(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const active = giveaways.listActive(interaction.guildId);
      const lines = active.map((g) => `**#${g.id}** ${truncate(g.prize, 80)} · ends ${discordTimestamp(g.ends_at, 'R')} · <#${g.channel_id}>`);
      return interaction.reply({ embeds: [kit.base({ title: '🎉 Running giveaways', description: lines.join('\n') || 'No giveaways are running.' })], flags: EPHEMERAL });
    }

    if (sub === 'start') {
      const option = interaction.options.getChannel('channel');
      const channel = await assertCanPost(option ? interaction.guild.channels.cache.get(option.id) : interaction.channel);
      const durationMs = readDuration(interaction.options.getString('duration', true), { min: MINUTE, max: 30 * DAY, label: 'A giveaway' });
      await interaction.deferReply({ flags: EPHEMERAL });
      const giveaway = giveaways.create({
        guildId: interaction.guildId,
        channelId: channel.id,
        hostId: interaction.user.id,
        prize: interaction.options.getString('prize', true),
        winnerCount: interaction.options.getInteger('winners') ?? 1,
        requiredRoleId: interaction.options.getRole('required_role')?.id ?? null,
        endsAt: Date.now() + durationMs,
      });
      const message = await channel.send(giveawayPayload(ctx, giveaway, 0));
      giveaways.setMessage(giveaway.id, message.id);
      ctx.scheduler.schedule('giveaway:end', giveaway.ends_at, { giveawayId: giveaway.id }, { dedupeKey: `giveaway:${giveaway.id}` });
      return interaction.editReply({ embeds: [kit.success('Giveaway started', `Giveaway #${giveaway.id} ends ${discordTimestamp(giveaway.ends_at, 'R')}. [Jump to it](${message.url})`)] });
    }

    const giveaway = requireGiveaway(ctx, interaction);
    await interaction.deferReply({ flags: EPHEMERAL });

    if (sub === 'end') {
      if (giveaway.status !== 'active') throw new UserError('That giveaway has already finished.', { title: 'Already ended' });
      ctx.scheduler.cancel(`giveaway:${giveaway.id}`);
      const ended = await endGiveaway(ctx, giveaway.id);
      return interaction.editReply({ embeds: [kit.success('Giveaway ended', ended.winners.length ? `Winners: ${ended.winners.map((id) => `<@${id}>`).join(', ')}` : 'There were no valid entries.')] });
    }

    if (sub === 'cancel') {
      if (!giveaways.cancel(giveaway.id)) throw new UserError('Only running giveaways can be cancelled.', { title: 'Cannot cancel' });
      ctx.scheduler.cancel(`giveaway:${giveaway.id}`);
      await updateMessage(ctx, giveaways.get(giveaway.id));
      return interaction.editReply({ embeds: [kit.success('Giveaway cancelled', `Giveaway #${giveaway.id} was cancelled.`)] });
    }

    // Reroll: new winners from the remaining entries, excluding previous winners.
    if (giveaway.status !== 'ended') throw new UserError('Only finished giveaways can be rerolled.', { title: 'Cannot reroll' });
    const pool = giveaways.entries(giveaway.id).filter((id) => !giveaway.winners.includes(id));
    const winners = await pickWinners(interaction.guild, giveaway, pool, interaction.options.getInteger('winners') ?? giveaway.winner_count);
    if (!winners.length) throw new UserError('There are no other eligible entries to pick from.', { title: 'No eligible entries' });
    giveaways.setWinners(giveaway.id, winners);
    await announce(ctx, giveaways.get(giveaway.id), { reroll: true });
    return interaction.editReply({ embeds: [kit.success('Giveaway rerolled', `New winners: ${winners.map((id) => `<@${id}>`).join(', ')}`)] });
  },
};

export default {
  commands: [command],
  components: [
    {
      id: 'giveaway:enter',
      async execute(interaction, ctx, [rawId]) {
        const { giveaways } = getServices(ctx);
        const giveaway = giveaways.get(Number(rawId));
        if (!giveaway) throw new UserError('This giveaway no longer exists.', { title: 'This has expired' });
        if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
          throw new UserError(`You need the <@&${giveaway.required_role_id}> role to enter.`, { title: 'Requirement not met' });
        }
        const { entered, count } = giveaways.toggleEntry(giveaway.id, interaction.user.id);
        await interaction.update(giveawayPayload(ctx, giveaway, count));
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.followUp({
          embeds: [entered ? kit.success('You are entered!', 'Good luck! Click the button again to leave.') : kit.info('You left the giveaway', 'Click the button again to re-enter.')],
          flags: EPHEMERAL,
        });
      },
    },
  ],
  jobs: [
    {
      type: 'giveaway:end',
      async execute({ giveawayId }, task, ctx) {
        await endGiveaway(ctx, giveawayId);
      },
    },
  ],
};
