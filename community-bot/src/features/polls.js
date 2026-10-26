import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { plural, progressBar, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { MAX_POLL_OPTIONS } from '../services/communityStores.js';
import { getServices } from '../services/index.js';
import {
  assertCanPost, cid, EPHEMERAL, fetchChannel, readDuration, rowsOf,
} from './common.js';

const LETTERS = 'ABCDEFGHIJ';
const MINUTE = 60_000;
const DAY = 86_400_000;

export function pollPayload(ctx, poll, results) {
  const kit = ctx.embeds.for(poll.guild_id);
  const open = poll.status === 'open';
  const best = Math.max(...results.counts);
  const lines = poll.options.map((option, i) => {
    const n = results.counts[i];
    const percent = results.totalVotes ? Math.round((n / results.totalVotes) * 100) : 0;
    const crown = !open && best > 0 && n === best ? ' 🏆' : '';
    return `**${LETTERS[i]}.** ${option}${crown}\n${progressBar(n, results.totalVotes || 1, 12)} ${percent}% (${n})`;
  });
  const embed = kit.base({ title: `📊 ${truncate(poll.question, 240)}`, description: truncate(lines.join('\n'), 4096), colour: open ? undefined : 0x99aab5 })
    .addFields(
      { name: 'Mode', value: poll.multiple ? 'Multiple choice' : 'Single choice', inline: true },
      { name: 'Voters', value: String(results.voters), inline: true },
      { name: open ? 'Closes' : 'Closed', value: open ? (poll.ends_at ? discordTimestamp(poll.ends_at, 'R') : 'When ended by staff') : discordTimestamp(poll.closed_at ?? Date.now(), 'R'), inline: true },
    )
    .setFooter({ text: `Poll #${poll.id}${poll.anonymous ? ' · Anonymous' : ''}` });

  const components = [];
  if (open) {
    const buttons = poll.options.map((option, i) => new ButtonBuilder()
      .setCustomId(cid('poll', 'vote', poll.id, i))
      .setLabel(truncate(`${LETTERS[i]}. ${option}`, 80))
      .setStyle(ButtonStyle.Secondary));
    components.push(...rowsOf(buttons).map((row) => new ActionRowBuilder().addComponents(row)));
    if (!poll.anonymous) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('poll', 'voters', poll.id)).setLabel('See voters').setEmoji('👥').setStyle(ButtonStyle.Primary),
      ));
    }
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Closes a poll once and shows the final results. Safe to repeat. */
export async function closePoll(ctx, pollId) {
  const { polls } = getServices(ctx);
  const closedNow = polls.close(pollId);
  const poll = polls.get(pollId);
  if (!poll) return null;
  if (closedNow) {
    const channel = await fetchChannel(ctx, poll.channel_id);
    const message = await channel?.messages.fetch(poll.message_id).catch(() => null);
    await message?.edit(pollPayload(ctx, poll, polls.results(poll.id))).catch(() => {});
  }
  return poll;
}

function buildCommandData() {
  const builder = new SlashCommandBuilder().setName('poll').setDescription('Polls');
  builder.addSubcommand((s) => {
    s.setName('create').setDescription('Create a poll')
      .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(240));
    for (let i = 1; i <= MAX_POLL_OPTIONS; i += 1) {
      s.addStringOption((o) => o.setName(`option${i}`).setDescription(`Option ${LETTERS[i - 1]}`).setRequired(i <= 2).setMaxLength(100));
    }
    return s
      .addStringOption((o) => o.setName('duration').setDescription('Close automatically after, e.g. 1h or 2d').setMaxLength(20))
      .addBooleanOption((o) => o.setName('multiple').setDescription('Allow more than one choice'))
      .addBooleanOption((o) => o.setName('anonymous').setDescription('Hide who voted for what'));
  });
  builder.addSubcommand((s) => s.setName('end').setDescription('Close a poll now')
    .addIntegerOption((o) => o.setName('id').setDescription('Poll number (shown in its footer)').setRequired(true).setMinValue(1)));
  return builder;
}

const command = {
  data: buildCommandData(),
  category: 'Community',
  tier: 'staff',
  cooldown: 10,
  async execute(interaction, ctx) {
    const { polls } = getServices(ctx);
    const kit = ctx.embeds.for(interaction.guildId);

    if (interaction.options.getSubcommand() === 'end') {
      const poll = polls.get(interaction.options.getInteger('id', true));
      if (!poll || poll.guild_id !== interaction.guildId) throw new UserError('That poll does not exist.', { title: 'Not found' });
      if (poll.author_id !== interaction.user.id && ctx.permissions.tierOf(interaction) < Tier.MODERATOR) {
        throw new UserError('Only the poll creator or a moderator can end this poll.', { title: 'Missing permission' });
      }
      if (poll.status !== 'open') throw new UserError('That poll is already closed.', { title: 'Already closed' });
      ctx.scheduler.cancel(`poll:${poll.id}`);
      await interaction.deferReply({ flags: EPHEMERAL });
      await closePoll(ctx, poll.id);
      return interaction.editReply({ embeds: [kit.success('Poll closed', `Poll #${poll.id} is closed and its final results are shown.`)] });
    }

    const channel = await assertCanPost(interaction.channel);
    const options = [];
    for (let i = 1; i <= MAX_POLL_OPTIONS; i += 1) {
      const value = interaction.options.getString(`option${i}`)?.trim();
      if (value) options.push(value);
    }
    const duration = interaction.options.getString('duration');
    const endsAt = duration ? Date.now() + readDuration(duration, { min: MINUTE, max: 30 * DAY, label: 'A poll' }) : null;
    const poll = polls.create({
      guildId: interaction.guildId,
      channelId: channel.id,
      authorId: interaction.user.id,
      question: interaction.options.getString('question', true),
      options,
      multiple: interaction.options.getBoolean('multiple') ?? false,
      anonymous: interaction.options.getBoolean('anonymous') ?? false,
      endsAt,
    });
    await interaction.deferReply({ flags: EPHEMERAL });
    const message = await channel.send(pollPayload(ctx, poll, polls.results(poll.id)));
    polls.setMessage(poll.id, message.id);
    if (endsAt) ctx.scheduler.schedule('poll:close', endsAt, { pollId: poll.id }, { dedupeKey: `poll:${poll.id}` });
    return interaction.editReply({ embeds: [kit.success('Poll posted', `Poll #${poll.id} is live. [Jump to it](${message.url})`)] });
  },
};

export default {
  commands: [command],
  components: [
    {
      id: 'poll:vote',
      async execute(interaction, ctx, [rawId, rawIndex]) {
        const { polls } = getServices(ctx);
        const pollId = Number(rawId);
        const selected = polls.vote(pollId, interaction.user.id, Number(rawIndex));
        const poll = polls.get(pollId);
        await interaction.update(pollPayload(ctx, poll, polls.results(pollId)));
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.followUp({
          embeds: [selected.length
            ? kit.success('Vote saved', `You voted for ${selected.map((i) => `**${LETTERS[i]}**`).join(', ')}. Click an option again to remove it.`)
            : kit.info('Vote removed', 'You are no longer voting in this poll.')],
          flags: EPHEMERAL,
        });
      },
    },
    {
      id: 'poll:voters',
      async execute(interaction, ctx, [rawId]) {
        const { polls } = getServices(ctx);
        const poll = polls.get(Number(rawId));
        if (!poll) throw new UserError('This poll no longer exists.', { title: 'This has expired' });
        if (poll.anonymous) throw new UserError('This poll is anonymous.', { title: 'Anonymous poll' });
        const voters = polls.voters(poll.id);
        const kit = ctx.embeds.for(interaction.guildId);
        const embed = kit.base({ title: `👥 Voters · Poll #${poll.id}` }).addFields(poll.options.map((option, i) => {
          const ids = voters.get(i) ?? [];
          return { name: truncate(`${LETTERS[i]}. ${option} (${plural(ids.length, 'vote')})`, 256), value: truncate(ids.map((id) => `<@${id}>`).join(' ') || '—', 1024) };
        }));
        return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      },
    },
  ],
  jobs: [
    {
      type: 'poll:close',
      async execute({ pollId }, task, ctx) {
        await closePoll(ctx, pollId);
      },
    },
  ],
};
