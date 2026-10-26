import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { getServices, settingsFor } from '../services/index.js';
import { duelView } from './gameViews.js';
import {
  amountOption, present, readStake, remember, showResult,
} from './games.js';

/** Member-against-member games. Stakes are held by gameService until the duel settles. */

const MODE_CHOICES = [{ name: 'Single round', value: 'single' }, { name: 'Best of three', value: 'bo3' }];
const modeOption = (o) => o.setName('mode').setDescription('Single round or best of three').addChoices(...MODE_CHOICES);

/** Creates a challenge and posts it, mentioning the opponent. `send` posts the message. */
async function openChallenge(interaction, ctx, { game, opponentId, stake, options = {}, send }) {
  const member = await interaction.guild.members.fetch(opponentId).catch(() => null);
  if (!member) throw new UserError('That member is not in this server.', { title: 'Invalid opponent' });
  if (member.user.bot) throw new UserError('Bots cannot be challenged.', { title: 'Invalid opponent' });
  const session = getServices(ctx).games.challenge({
    guildId: interaction.guildId, hostId: interaction.user.id, opponentId, game, stake, options,
    settings: settingsFor(ctx, interaction.guildId), channelId: interaction.channelId,
  });
  const message = await send({
    content: `<@${opponentId}>, you have been challenged!`,
    ...duelView(ctx, session),
    allowedMentions: { users: [opponentId] },
  });
  remember(ctx, session, message);
}

export function challenge(interaction, ctx, game, opponent, stake, options = {}) {
  return openChallenge(interaction, ctx, {
    game, opponentId: opponent.id, stake, options,
    send: async (payload) => (await interaction.reply({ ...payload, withResponse: true }))?.resource?.message,
  });
}

const GAME_CHOICES = [
  { name: 'Dice (first to two rounds)', value: 'duel-dice' },
  { name: 'Coinflip', value: 'duel-coinflip' },
  { name: 'Rock, paper, scissors', value: 'duel-rps' },
];

const duel = {
  data: new SlashCommandBuilder().setName('duel').setDescription('Challenge a member to a duel')
    .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true))
    .addStringOption(amountOption(false))
    .addStringOption((o) => o.setName('game').setDescription('Which game (dice if empty)').addChoices(...GAME_CHOICES))
    .addStringOption(modeOption),
  category: 'Games',
  tier: 'member',
  execute: (interaction, ctx) => challenge(
    interaction, ctx, interaction.options.getString('game') ?? 'duel-dice', interaction.options.getUser('opponent', true),
    readStake(interaction, ctx, false), { mode: interaction.options.getString('mode') ?? 'single' },
  ),
};

const rps = {
  data: new SlashCommandBuilder().setName('rps').setDescription('Rock, paper, scissors against the bot or a member')
    .addUserOption((o) => o.setName('opponent').setDescription('Challenge a member instead of the bot'))
    .addStringOption(amountOption(false))
    .addStringOption(modeOption),
  category: 'Games',
  tier: 'member',
  execute(interaction, ctx) {
    const opponent = interaction.options.getUser('opponent');
    const stake = readStake(interaction, ctx, false);
    const options = { mode: interaction.options.getString('mode') ?? 'single' };
    return opponent ? challenge(interaction, ctx, 'duel-rps', opponent, stake, options) : present(interaction, ctx, 'rps', stake, options);
  },
};

const settings = (ctx, interaction) => settingsFor(ctx, interaction.guildId);

export default {
  commands: [duel, rps],
  components: [
    {
      id: 'duel:accept',
      async execute(interaction, ctx, [sessionId]) {
        const { games } = getServices(ctx);
        const session = games.get(sessionId);
        // A challenger who has left the server cannot be played; return the stake instead.
        if (session?.status === 'open' && session.opponent_id === interaction.user.id) {
          const host = await interaction.guild.members.fetch(session.host_id).catch(() => null);
          if (!host) {
            games.cancelForMember({ guildId: interaction.guildId, userId: session.host_id, settings: settings(ctx, interaction) });
            return interaction.update({ content: null, ...duelView(ctx, games.get(sessionId)) });
          }
        }
        const result = games.accept({ sessionId, userId: interaction.user.id, settings: settings(ctx, interaction) });
        return showResult(interaction, ctx, result);
      },
    },
    {
      id: 'duel:decline',
      async execute(interaction, ctx, [sessionId]) {
        const session = getServices(ctx).games.cancel({ sessionId, userId: interaction.user.id, settings: settings(ctx, interaction) });
        await interaction.update(duelView(ctx, session));
      },
    },
    {
      id: 'duel:cancel',
      async execute(interaction, ctx, [sessionId]) {
        const { games } = getServices(ctx);
        if (games.get(sessionId)?.host_id !== interaction.user.id) throw new UserError('Only the challenger can withdraw.', { title: 'Not your challenge' });
        const session = games.cancel({ sessionId, userId: interaction.user.id, settings: settings(ctx, interaction) });
        await interaction.update(duelView(ctx, session));
      },
    },
    {
      id: 'duel:pick',
      async execute(interaction, ctx, [sessionId, choice]) {
        const result = getServices(ctx).games.act({ sessionId, userId: interaction.user.id, action: `pick:${choice}`, settings: settings(ctx, interaction) });
        // The shared message only ever shows who has picked, never what.
        await showResult(interaction, ctx, { ...result, feedback: result.settlement ? result.feedback : null });
      },
    },
    {
      id: 'duel:rematch',
      async execute(interaction, ctx, [sessionId]) {
        const previous = getServices(ctx).games.get(sessionId);
        if (!previous || ![previous.host_id, previous.opponent_id].includes(interaction.user.id)) {
          throw new UserError('Only the two players can start a rematch.', { title: 'Not your duel' });
        }
        const opponentId = interaction.user.id === previous.host_id ? previous.opponent_id : previous.host_id;
        // The challenge is validated first; only then is the old Rematch button removed.
        await openChallenge(interaction, ctx, {
          game: previous.game, opponentId, stake: previous.stake, options: previous.options,
          send: async (payload) => {
            await interaction.update({ components: [] });
            return interaction.followUp(payload);
          },
        });
      },
    },
  ],
};
