import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { formatNumber, plural, progressBar, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import {
  CURRENCY, currentStreak, formatCoins, levelForXp, parseAmountInput, REWARD_KINDS, xpForLevel,
} from '../services/economyRules.js';
import { LEADERBOARD_CHOICES } from '../services/economyService.js';
import { getServices, settingsFor } from '../services/index.js';
import { cid, EPHEMERAL } from './common.js';

const PER_PAGE = 10;

export const TRANSACTION_LABELS = Object.freeze({
  starting_balance: 'Starting balance',
  daily_reward: 'Daily reward',
  weekly_reward: 'Weekly reward',
  monthly_reward: 'Monthly reward',
  transfer_in: 'Payment received',
  transfer_out: 'Payment sent',
  deposit: 'Deposit',
  withdraw: 'Withdrawal',
  crime_reward: 'Crime payout',
  crime_fine: 'Crime fine',
  rob_success: 'Robbery',
  robbed: 'Robbed',
  rob_fine: 'Robbery fine',
  rob_compensation: 'Robbery compensation',
  boost_reward: 'Booster reward',
  work_reward: 'Work',
  game_stake: 'Game stake',
  game_payout: 'Game payout',
  game_reward: 'Game reward',
  game_refund: 'Game refund',
  daily_spin: 'Daily spin',
  level_reward: 'Level reward',
  collection_reward: 'Collection reward',
  pet_adoption: 'Pet adoption',
  pet_evolution: 'Pet evolution',
  pet_explore: 'Pet exploring',
  expedition_reward: 'Expedition',
  admin_add: 'Admin: added',
  admin_remove: 'Admin: removed',
  admin_set: 'Admin: set',
  admin_reset: 'Admin: reset',
});

export function balanceEmbed(ctx, guildId, user, account, rank) {
  const kit = ctx.embeds.for(guildId);
  const level = levelForXp(account.xp);
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const embed = kit.base({ title: `${CURRENCY.emoji} ${user.username}'s balance` })
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Wallet', value: formatCoins(account.wallet), inline: true },
      { name: 'Bank', value: formatCoins(account.bank), inline: true },
      { name: 'Net worth', value: formatCoins(account.wallet + account.bank), inline: true },
      { name: 'Rank', value: rank ? `#${formatNumber(rank)}` : 'Unranked', inline: true },
      { name: 'Economy level', value: `Level ${level} · ${formatNumber(account.xp)} / ${formatNumber(next)} XP\n${progressBar(account.xp - floor, next - floor, 10)}`, inline: true },
      { name: 'Lifetime', value: `Earned ${formatCoins(account.lifetime_earned)}\nSpent ${formatCoins(account.lifetime_spent)}`, inline: true },
    );
  if (account.frozen) embed.addFields({ name: '🧊 Account frozen', value: account.frozen_reason ?? 'Contact a server admin.' });
  return embed;
}

export function rewardComponents(kind) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('reward', 'claim', kind)).setLabel(`Claim ${kind} reward`).setEmoji(REWARD_KINDS[kind].emoji).setStyle(ButtonStyle.Success),
  )];
}

function rewardEmbed(ctx, guildId, kind, status) {
  const kit = ctx.embeds.for(guildId);
  const { label, emoji } = REWARD_KINDS[kind];
  if (!status.available) {
    return kit.base({ title: `${emoji} ${label} reward`, description: `You already claimed this one. Your next ${kind} reward is ready ${discordTimestamp(status.nextAt, 'R')}.` })
      .addFields(kind === 'daily' ? [{ name: 'Current streak', value: plural(status.streak, 'day'), inline: true }] : []);
  }
  const embed = kit.base({ title: `${emoji} ${label} reward`, description: `Your ${kind} reward is ready to claim!` })
    .addFields({ name: 'Reward', value: formatCoins(status.total), inline: true });
  if (kind === 'daily') {
    embed.addFields(
      { name: 'Streak after claiming', value: plural(status.streak, 'day'), inline: true },
      { name: 'Streak bonus', value: status.bonus ? formatCoins(status.bonus) : 'None yet', inline: true },
    );
  }
  return embed;
}

async function showReward(interaction, ctx, kind) {
  const settings = settingsFor(ctx, interaction.guildId);
  const status = getServices(ctx).economy.rewardStatus({ guildId: interaction.guildId, userId: interaction.user.id, kind, settings });
  return interaction.reply({
    embeds: [rewardEmbed(ctx, interaction.guildId, kind, status)],
    components: status.available ? rewardComponents(kind) : [],
    flags: EPHEMERAL,
  });
}

export function leaderboardPage(ctx, guildId, metric, requestedPage, viewerId) {
  const { economy } = getServices(ctx);
  const total = economy.leaderboardCount(guildId, metric);
  const { page, totalPages } = paginate(Array.from({ length: total }), requestedPage, PER_PAGE);
  const rows = economy.leaderboard(guildId, metric, PER_PAGE, (page - 1) * PER_PAGE);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((row, i) => {
    const position = (page - 1) * PER_PAGE + i + 1;
    return `${medals[position - 1] ?? `**${position}.**`} <@${row.user_id}> · ${formatCoins(row.metric)}`;
  });
  const kit = ctx.embeds.for(guildId);
  const label = LEADERBOARD_CHOICES.find((c) => c.value === metric).name;
  const rank = viewerId ? economy.rank(guildId, viewerId) : null;
  const embed = kit.base({ title: `🏆 Leaderboard · ${label}`, description: lines.join('\n') || 'Nobody has any Lyss Coins yet. Claim your `/daily`!' });
  if (metric === 'networth' && rank) embed.setFooter({ text: `Your rank: #${rank}` });
  const components = totalPages > 1 ? [pageRow((p) => cid('lb', 'page', metric, p), page, totalPages)] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export function transactionsPage(ctx, guildId, userId, requestedPage) {
  const { economy } = getServices(ctx);
  const total = economy.transactionCount(guildId, userId);
  const { page, totalPages } = paginate(Array.from({ length: total }), requestedPage, PER_PAGE);
  const rows = economy.transactions(guildId, userId, PER_PAGE, (page - 1) * PER_PAGE);
  const lines = rows.map((t) => {
    const sign = t.amount > 0 ? '+' : '−';
    const other = t.counterparty_id ? ` · <@${t.counterparty_id}>` : '';
    return `\`${sign}${formatNumber(Math.abs(t.amount))}\` ${TRANSACTION_LABELS[t.type] ?? t.type} · ${t.account}${other} · ${discordTimestamp(t.created_at, 'R')}${t.note ? `\n> ${truncate(t.note, 80)}` : ''}`;
  });
  const kit = ctx.embeds.for(guildId);
  const embed = kit.base({ title: '🧾 Transactions', description: truncate(`<@${userId}> · ${plural(total, 'transaction')}\n\n${lines.join('\n') || 'No transactions yet.'}`, 4096) });
  const components = totalPages > 1 ? [pageRow((p) => cid('tx', 'page', userId, p), page, totalPages)] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function readAmount(interaction, available) {
  const amount = parseAmountInput(interaction.options.getString('amount', true), available);
  if (!amount) throw new UserError(available === 0 ? 'You have no Lyss Coins to move.' : 'Enter a positive amount, such as `500`, `2.5k`, `half` or `all`.', { title: 'Invalid amount' });
  return amount;
}

const userOption = (description, required = false) => (o) => o.setName('user').setDescription(description).setRequired(required);
const economyCommand = (data, execute, extra = {}) => ({ data, execute, category: 'Economy', tier: 'member', ...extra });

const commands = [
  economyCommand(
    new SlashCommandBuilder().setName('balance').setDescription('View wallet, bank and net worth').addUserOption(userOption('Member (defaults to you)')),
    async (interaction, ctx) => {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const { economy } = getServices(ctx);
      return interaction.reply({ embeds: [balanceEmbed(ctx, interaction.guildId, user, economy.account(interaction.guildId, user.id), economy.rank(interaction.guildId, user.id))] });
    },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('networth').setDescription('View total wallet and bank value').addUserOption(userOption('Member (defaults to you)')),
    async (interaction, ctx) => {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const { economy } = getServices(ctx);
      const account = economy.account(interaction.guildId, user.id);
      const rank = economy.rank(interaction.guildId, user.id);
      const kit = ctx.embeds.for(interaction.guildId);
      return interaction.reply({ embeds: [kit.base({ title: `💰 ${user.username}'s net worth`, description: `${formatCoins(account.wallet + account.bank)}${rank ? ` · rank #${rank}` : ''}` })] });
    },
  ),
  ...Object.keys(REWARD_KINDS).map((kind) => economyCommand(
    new SlashCommandBuilder().setName(kind).setDescription(`Claim your ${kind} Lyss Coins`),
    (interaction, ctx) => showReward(interaction, ctx, kind),
  )),
  economyCommand(
    new SlashCommandBuilder().setName('streak').setDescription('View your daily reward streak'),
    async (interaction, ctx) => {
      const { economy } = getServices(ctx);
      const status = economy.rewardStatus({ guildId: interaction.guildId, userId: interaction.user.id, kind: 'daily', settings: settingsFor(ctx, interaction.guildId) });
      const streak = currentStreak(status.last, Date.now());
      const kit = ctx.embeds.for(interaction.guildId);
      const text = status.available
        ? (streak ? `Claim your \`/daily\` before ${discordTimestamp(status.last.period_end_at + 86_400_000, 'f')} to keep your streak.` : 'Claim `/daily` to start a streak.')
        : `Next claim ${discordTimestamp(status.nextAt, 'R')}.`;
      return interaction.reply({ embeds: [kit.base({ title: `🔥 ${plural(streak, 'day')} streak`, description: text })], flags: EPHEMERAL });
    },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('pay').setDescription('Send Lyss Coins to a member')
      .addUserOption(userOption('Who to pay', true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many Lyss Coins').setRequired(true).setMinValue(1))
      .addStringOption((o) => o.setName('note').setDescription('Optional note').setMaxLength(200)),
    async (interaction, ctx) => {
      const recipient = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const settings = settingsFor(ctx, interaction.guildId);
      const { economy } = getServices(ctx);
      if (recipient.bot) throw new UserError('Bots cannot receive Lyss Coins.', { title: 'Invalid recipient' });
      if (recipient.id === interaction.user.id) throw new UserError('You cannot pay yourself.', { title: 'Invalid recipient' });
      if (amount > settings.payMax) throw new UserError(`The largest single payment is ${formatCoins(settings.payMax)}.`, { title: 'Payment too large' });
      const wallet = economy.account(interaction.guildId, interaction.user.id).wallet;
      if (wallet < amount) throw new UserError(`You only have ${formatCoins(wallet)} in your wallet.`, { title: 'Insufficient funds' });

      const id = crypto.randomUUID();
      economy.createPending({ id, guildId: interaction.guildId, userId: interaction.user.id, kind: 'pay', payload: { toId: recipient.id, amount, note: interaction.options.getString('note') } });
      const kit = ctx.embeds.for(interaction.guildId);
      return interaction.reply({
        embeds: [kit.warning('Confirm payment', `Send **${formatCoins(amount)}** to ${recipient}?`)
          .addFields({ name: 'Your wallet afterwards', value: formatCoins(wallet - amount), inline: true })
          .setFooter({ text: 'This confirmation expires in 2 minutes.' })],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(cid('pay', 'confirm', id)).setLabel('Send').setEmoji('💸').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(cid('pay', 'cancel', id)).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        )],
        flags: EPHEMERAL,
      });
    },
    { cooldown: 3 },
  ),
  ...['deposit', 'withdraw'].map((action) => economyCommand(
    new SlashCommandBuilder().setName(action).setDescription(action === 'deposit' ? 'Move coins from your wallet to your bank' : 'Move coins from your bank to your wallet')
      .addStringOption((o) => o.setName('amount').setDescription('An amount, "half" or "all"').setRequired(true).setMaxLength(20)),
    async (interaction, ctx) => {
      const { economy } = getServices(ctx);
      const settings = settingsFor(ctx, interaction.guildId);
      const account = economy.account(interaction.guildId, interaction.user.id);
      const amount = readAmount(interaction, action === 'deposit' ? account.wallet : account.bank);
      const after = economy[action]({ guildId: interaction.guildId, userId: interaction.user.id, amount, settings });
      const kit = ctx.embeds.for(interaction.guildId);
      return interaction.reply({
        embeds: [kit.success(action === 'deposit' ? 'Deposited' : 'Withdrawn', `Moved ${formatCoins(amount)} ${action === 'deposit' ? 'into your bank' : 'into your wallet'}.`)
          .addFields({ name: 'Wallet', value: formatCoins(after.wallet), inline: true }, { name: 'Bank', value: formatCoins(after.bank), inline: true })],
        flags: EPHEMERAL,
      });
    },
  )),
  economyCommand(
    new SlashCommandBuilder().setName('transactions').setDescription('View transaction history').addUserOption(userOption('Member (admins only)')),
    async (interaction, ctx) => {
      const user = interaction.options.getUser('user') ?? interaction.user;
      if (user.id !== interaction.user.id && ctx.permissions.tierOf(interaction) < Tier.ADMIN) {
        throw new UserError('Only admins can view another member\'s transactions.', { title: 'Missing permission' });
      }
      return interaction.reply({ ...transactionsPage(ctx, interaction.guildId, user.id, 1), flags: EPHEMERAL });
    },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('leaderboard').setDescription('The richest members')
      .addStringOption((o) => o.setName('sort').setDescription('What to rank by').addChoices(...LEADERBOARD_CHOICES)),
    (interaction, ctx) => interaction.reply(leaderboardPage(ctx, interaction.guildId, interaction.options.getString('sort') ?? 'networth', 1, interaction.user.id)),
    { cooldown: 5 },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('richest').setDescription('The wealth leaderboard'),
    (interaction, ctx) => interaction.reply(leaderboardPage(ctx, interaction.guildId, 'networth', 1, interaction.user.id)),
    { cooldown: 5 },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('crime').setDescription('Attempt a risky (and entirely fictional) crime'),
    async (interaction, ctx) => {
      const result = getServices(ctx).economy.crime({ guildId: interaction.guildId, userId: interaction.user.id, settings: settingsFor(ctx, interaction.guildId) });
      const kit = ctx.embeds.for(interaction.guildId);
      const embed = result.success
        ? kit.success('Crime paid off', `${result.text}.\nYou earned **${formatCoins(result.amount)}**.`)
        : kit.error('Caught!', `${result.text}.\n${result.amount ? `You paid a **${formatCoins(result.amount)}** fine.` : 'Luckily you had nothing to fine.'}`);
      return interaction.reply({ embeds: [embed.addFields({ name: 'Wallet', value: formatCoins(result.account.wallet), inline: true }, { name: 'Try again', value: discordTimestamp(result.nextAt, 'R'), inline: true })] });
    },
  ),
  economyCommand(
    new SlashCommandBuilder().setName('rob').setDescription('Attempt to rob a member\'s wallet').addUserOption(userOption('Who to rob', true)),
    async (interaction, ctx) => {
      const victim = interaction.options.getUser('user', true);
      if (victim.bot) throw new UserError('Bots have nothing worth stealing.', { title: 'Invalid target' });
      if (!await interaction.guild.members.fetch(victim.id).catch(() => null)) throw new UserError('That member is not in this server.', { title: 'Invalid target' });
      const result = getServices(ctx).economy.rob({ guildId: interaction.guildId, robberId: interaction.user.id, victimId: victim.id, settings: settingsFor(ctx, interaction.guildId) });
      const kit = ctx.embeds.for(interaction.guildId);
      const embed = result.success
        ? kit.success('Robbery successful', `You took **${formatCoins(result.amount)}** from ${victim}'s wallet.`)
        : kit.error('Robbery failed', `${victim} caught you!${result.amount ? ` You paid them **${formatCoins(result.amount)}** in compensation.` : ''}`);
      return interaction.reply({ embeds: [embed.addFields({ name: 'Your wallet', value: formatCoins(result.robber.wallet), inline: true }, { name: 'Try again', value: discordTimestamp(result.nextAt, 'R'), inline: true })], allowedMentions: { parse: [] } });
    },
  ),
];

export default {
  commands,
  components: [
    {
      id: 'reward:claim',
      async execute(interaction, ctx, [kind]) {
        if (!REWARD_KINDS[kind]) throw new UserError('This button is out of date.', { title: 'This has expired' });
        const result = getServices(ctx).economy.claimReward({
          guildId: interaction.guildId, userId: interaction.user.id, kind,
          zone: ctx.guildConfig.get(interaction.guildId, 'timezone'), settings: settingsFor(ctx, interaction.guildId),
        });
        const kit = ctx.embeds.for(interaction.guildId);
        const embed = kit.success(`${REWARD_KINDS[kind].label} reward claimed`, `You received **${formatCoins(result.amount)}**!${result.bonus ? ` That includes a ${formatCoins(result.bonus)} streak bonus.` : ''}`)
          .addFields(
            ...(kind === 'daily' ? [{ name: 'Streak', value: `🔥 ${plural(result.streak, 'day')}`, inline: true }] : []),
            { name: 'Wallet', value: formatCoins(result.account.wallet), inline: true },
            { name: 'Next claim', value: discordTimestamp(result.nextAt, 'R'), inline: true },
          );
        // Ephemeral messages belong to the clicker; on shared messages, reply privately instead.
        if (interaction.message.flags.has(EPHEMERAL)) return interaction.update({ embeds: [embed], components: [] });
        return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
      },
    },
    {
      id: 'pay:confirm',
      async execute(interaction, ctx, [pendingId]) {
        const result = getServices(ctx).economy.confirmPayment({ pendingId, userId: interaction.user.id, settings: settingsFor(ctx, interaction.guildId) });
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.update({
          embeds: [kit.success('Payment sent', `You sent **${formatCoins(result.amount)}** to <@${result.to.user_id}>.`)
            .addFields({ name: 'Your wallet', value: formatCoins(result.from.wallet), inline: true }, { name: 'Their wallet', value: formatCoins(result.to.wallet), inline: true })],
          components: [],
        });
        await interaction.followUp({ content: `💸 ${interaction.user} sent **${formatCoins(result.amount)}** to <@${result.to.user_id}>!`, allowedMentions: { users: [result.to.user_id] } });
      },
    },
    {
      id: 'pay:cancel',
      async execute(interaction, ctx, [pendingId]) {
        getServices(ctx).economy.cancelPending(pendingId, interaction.user.id);
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.update({ embeds: [kit.info('Payment cancelled', 'No coins were sent.')], components: [] });
      },
    },
    {
      id: 'lb:page',
      tier: 'restricted',
      async execute(interaction, ctx, [metric, page]) {
        if (!LEADERBOARD_CHOICES.some((c) => c.value === metric)) throw new UserError('This leaderboard is out of date.', { title: 'This has expired' });
        await interaction.update(leaderboardPage(ctx, interaction.guildId, metric, Number(page), interaction.user.id));
      },
    },
    {
      id: 'tx:page',
      async execute(interaction, ctx, [userId, page]) {
        if (userId !== interaction.user.id && ctx.permissions.tierOf(interaction) < Tier.ADMIN) {
          throw new UserError('Only admins can view another member\'s transactions.', { title: 'Missing permission' });
        }
        await interaction.update(transactionsPage(ctx, interaction.guildId, userId, Number(page)));
      },
    },
  ],
};
