import { SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { GAMES } from '../services/games/catalogue.js';
import { ROULETTE_BETS, SPIN_SEGMENTS } from '../services/games/tables.js';
import { getServices, settingsFor } from '../services/index.js';
import { itemList } from '../services/items.js';
import { JOBS } from '../services/jobTasks.js';
import { petLabel } from '../services/pets/rules.js';
import { challenge } from './duels.js';
import { amountOption, present, readStake } from './games.js';

/** Casino-style games and the daily spin. Payout tables live in services/games/tables.js. */

const game = (data, execute) => ({ data, execute, category: 'Games', tier: 'member' });

const coinflip = game(
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin for Lyss Coins (even money)')
    .addStringOption(amountOption())
    .addStringOption((o) => o.setName('choice').setDescription('Heads or tails (you can also pick on the card)')
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),
  (interaction, ctx) => present(interaction, ctx, 'coinflip', readStake(interaction, ctx), { choice: interaction.options.getString('choice') }),
);

const dice = game(
  new SlashCommandBuilder().setName('dice').setDescription('Dice games')
    .addSubcommand((s) => s.setName('roll').setDescription('Roll two dice against the bot').addStringOption(amountOption()))
    .addSubcommand((s) => s.setName('duel').setDescription('Challenge a member to a dice duel (first to two rounds)')
      .addUserOption((o) => o.setName('opponent').setDescription('Who to challenge').setRequired(true))
      .addStringOption(amountOption(false))),
  (interaction, ctx) => (interaction.options.getSubcommand() === 'duel'
    ? challenge(interaction, ctx, 'duel-dice', interaction.options.getUser('opponent', true), readStake(interaction, ctx, false))
    : present(interaction, ctx, 'dice', readStake(interaction, ctx))),
);

const slots = game(
  new SlashCommandBuilder().setName('slots').setDescription('Spin the slot machine').addStringOption(amountOption()),
  (interaction, ctx) => present(interaction, ctx, 'slots', readStake(interaction, ctx)),
);

const roulette = game(
  new SlashCommandBuilder().setName('roulette').setDescription('Bet on a European roulette wheel')
    .addStringOption(amountOption())
    .addStringOption((o) => o.setName('bet').setDescription('What to bet on').setRequired(true)
      .addChoices(...Object.entries(ROULETTE_BETS).map(([value, bet]) => ({ name: `${bet.label} (×${bet.multiplier})`, value }))))
    .addIntegerOption((o) => o.setName('number').setDescription('Your number, for a single-number bet').setMinValue(0).setMaxValue(36)),
  (interaction, ctx) => {
    const bet = interaction.options.getString('bet', true);
    const number = interaction.options.getInteger('number');
    if (bet === 'number' && number === null) throw new UserError('Choose a `number` from 0 to 36 for a single-number bet.', { title: 'Number needed' });
    if (bet !== 'number' && number !== null) throw new UserError('`number` is only used with the single-number bet.', { title: 'Invalid bet' });
    return present(interaction, ctx, 'roulette', readStake(interaction, ctx), { bet, number });
  },
);

const blackjack = game(
  new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack against the dealer').addStringOption(amountOption()),
  (interaction, ctx) => present(interaction, ctx, 'blackjack', readStake(interaction, ctx)),
);

const higherlower = game(
  new SlashCommandBuilder().setName('higherlower').setDescription('Guess higher or lower and build a streak')
    .addStringOption(amountOption(false)),
  (interaction, ctx) => present(interaction, ctx, 'higherlower', readStake(interaction, ctx, false)),
);

const scratchcard = game(
  new SlashCommandBuilder().setName('scratchcard').setDescription(`Buy a scratch card (${GAMES.scratchcard.price} LC)`),
  (interaction, ctx) => present(interaction, ctx, 'scratchcard', GAMES.scratchcard.price),
);

const dailyspin = game(
  new SlashCommandBuilder().setName('dailyspin').setDescription('Spin the reward wheel once a day'),
  async (interaction, ctx) => {
    const guildId = interaction.guildId;
    const result = getServices(ctx).games.dailySpin({
      guildId, userId: interaction.user.id, zone: ctx.guildConfig.get(guildId, 'timezone'), settings: settingsFor(ctx, guildId),
    });
    const kit = ctx.embeds.for(guildId);
    await interaction.reply({ embeds: [kit.base({ title: '🎡 Daily Spin', description: '🎡 The wheel is spinning…' })] });
    const wheel = SPIN_SEGMENTS.map((s) => `${s.key === result.segment.key ? '▶️' : '▫️'} ${s.emoji} ${s.label}`).join('\n');
    const prize = result.pet ? `${result.pet.levels.xp} pet XP for ${petLabel(result.pet.pet)}`
      : result.coins ? formatCoins(result.coins)
        : result.items.length ? itemList(result.items)
          : result.jobXp ? `${result.jobXp} ${JOBS[result.job].name} XP` : `${result.xp} economy XP`;
    const embed = kit.success('Daily Spin', `${wheel}\n\nYou won **${prize}**!\nNext spin ${discordTimestamp(result.nextAt, 'R')}.`);
    const timer = setTimeout(() => interaction.editReply({ embeds: [embed] }).catch(() => {}), 1_200);
    timer.unref?.();
  },
);

export default {
  commands: [coinflip, dice, slots, roulette, blackjack, higherlower, scratchcard, dailyspin],
};
