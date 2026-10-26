import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatDuration, parseDuration } from '@lyss/shared/utils/time.js';
import { caseReply, deferEphemeral, readReason, reasonOption } from '../services/commandHelpers.js';
import {
  actorOf, purge, setLocked, slowmode,
} from '../services/moderation.js';

const MAX_SLOWMODE_SECONDS = 21_600;

const channelOption = (description, types) => (o) => o.setName('channel').setDescription(description).addChannelTypes(...types);
const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice];

function targetChannel(interaction) {
  const option = interaction.options.getChannel('channel');
  return option ? interaction.guild.channels.cache.get(option.id) ?? option : interaction.channel;
}

/** "off", "0" or a duration up to 6 hours, in whole seconds. Returns null when invalid. */
export function parseSlowmode(input) {
  const text = String(input ?? '').trim();
  if (/^(off|0|none)$/i.test(text)) return 0;
  const ms = parseDuration(/^\d+$/.test(text) ? `${text}s` : text);
  if (!ms || ms % 1000 !== 0 || ms / 1000 > MAX_SLOWMODE_SECONDS) return null;
  return ms / 1000;
}

const channelCommand = (data, execute) => ({ data, execute, category: 'Channels', tier: 'moderator' });

export default [
  channelCommand(
    new SlashCommandBuilder().setName('purge').setDescription('Bulk delete recent messages in this channel')
      .addIntegerOption((o) => o.setName('amount').setDescription('How many messages (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this member'))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const created = await purge(ctx, interaction.guild, actorOf(interaction.user), interaction.channel, interaction.options.getInteger('amount', true), {
        user: interaction.options.getUser('user'), reason: readReason(ctx, interaction),
      });
      return caseReply(ctx, interaction, created, `\nDeleted **${created.metadata.count}** message${created.metadata.count === 1 ? '' : 's'}.`);
    },
  ),

  channelCommand(
    new SlashCommandBuilder().setName('slowmode').setDescription('Set a channel\'s slowmode')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10s, 5m, 1h, or "off"').setRequired(true).setMaxLength(20))
      .addChannelOption(channelOption('Channel (defaults to this one)', [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.PublicThread, ChannelType.PrivateThread]))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const seconds = parseSlowmode(interaction.options.getString('duration', true));
      if (seconds === null) throw new UserError('Use "off" or a whole number of seconds up to 6h, such as 10s, 5m or 1h.', { title: 'Invalid slowmode' });
      const channel = targetChannel(interaction);
      const created = await slowmode(ctx, interaction.guild, actorOf(interaction.user), channel, seconds, readReason(ctx, interaction));
      return caseReply(ctx, interaction, created, `\n${channel} slowmode is now ${seconds ? formatDuration(seconds * 1000) : 'off'}.`);
    },
  ),

  channelCommand(
    new SlashCommandBuilder().setName('lock').setDescription('Stop @everyone from sending messages in a channel')
      .addChannelOption(channelOption('Channel (defaults to this one)', LOCKABLE))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const channel = targetChannel(interaction);
      return caseReply(ctx, interaction, await setLocked(ctx, interaction.guild, actorOf(interaction.user), channel, true, readReason(ctx, interaction)),
        `\n${channel} is locked. Roles with an explicit Send Messages permission can still talk.`);
    },
  ),

  channelCommand(
    new SlashCommandBuilder().setName('unlock').setDescription('Let @everyone send messages in a channel again')
      .addChannelOption(channelOption('Channel (defaults to this one)', LOCKABLE))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const channel = targetChannel(interaction);
      return caseReply(ctx, interaction, await setLocked(ctx, interaction.guild, actorOf(interaction.user), channel, false, readReason(ctx, interaction)), `\n${channel} is unlocked.`);
    },
  ),
];
