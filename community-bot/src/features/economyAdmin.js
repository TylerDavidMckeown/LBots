import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatSettingValue, parseSettingValue } from '@lyss/shared/setupKit.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { formatNumber, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import {
  ECONOMY_SETTINGS, economySettings, formatCoins, settingsProblem,
} from '../services/economyRules.js';
import { getServices, settingsFor } from '../services/index.js';
import { cid, EPHEMERAL } from './common.js';
import { balanceEmbed, rewardComponents } from './economy.js';

const SETTING_CHOICES = ECONOMY_SETTINGS.map((s) => ({ name: truncate(s.label, 100), value: s.key }));
const ACCOUNT_CHOICES = [{ name: 'Wallet', value: 'wallet' }, { name: 'Bank', value: 'bank' }];
const AUDIT_PER_PAGE = 10;

function dashboard(ctx, interaction) {
  const { economy } = getServices(ctx);
  const settings = settingsFor(ctx, interaction.guildId);
  const account = economy.account(interaction.guildId, interaction.user.id);
  const daily = economy.rewardStatus({ guildId: interaction.guildId, userId: interaction.user.id, kind: 'daily', settings });
  const embed = balanceEmbed(ctx, interaction.guildId, interaction.user, account, economy.rank(interaction.guildId, interaction.user.id))
    .addFields({ name: '📅 Daily reward', value: daily.available ? `Ready: ${formatCoins(daily.total)}` : `Next ${discordTimestamp(daily.nextAt, 'R')}` });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('eco', 'depositall')).setLabel('Deposit all').setEmoji('🏦').setStyle(ButtonStyle.Secondary).setDisabled(!account.wallet),
    new ButtonBuilder().setCustomId(cid('eco', 'withdrawall')).setLabel('Withdraw all').setEmoji('👛').setStyle(ButtonStyle.Secondary).setDisabled(!account.bank),
    new ButtonBuilder().setCustomId(cid('eco', 'refresh')).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: daily.available ? [...rewardComponents('daily'), buttons] : [buttons] };
}

function helpEmbed(ctx, guildId) {
  const kit = ctx.embeds.for(guildId);
  return kit.base({ title: '🪙 Lyss Coins (LC)', description: 'Earn, save and spend Lyss Coins across the server.' }).addFields(
    { name: 'Earning', value: '`/daily`, `/weekly` and `/monthly` rewards. Daily claims build a streak bonus.\n`/crime` is a risky shortcut with a cooldown.' },
    { name: 'Wallet and bank', value: 'Your **wallet** is used for payments and games. Your **bank** is safe from robberies.\nMove coins with `/deposit` and `/withdraw` (amounts, `half` or `all`).' },
    { name: 'Sharing', value: '`/pay` sends coins after you confirm. `/rob` tries to take from someone\'s wallet, and failing costs you a fine paid to them.' },
    { name: 'Tracking', value: '`/balance`, `/networth`, `/transactions`, `/streak`, `/leaderboard` and `/richest`.' },
  );
}

function auditPage(ctx, guildId, requestedPage) {
  const { economy } = getServices(ctx);
  const total = economy.auditCount(guildId);
  const { page, totalPages } = paginate(Array.from({ length: total }), requestedPage, AUDIT_PER_PAGE);
  const lines = economy.auditLog(guildId, AUDIT_PER_PAGE, (page - 1) * AUDIT_PER_PAGE).map((row) => {
    const amount = row.amount !== null ? ` ${row.amount > 0 ? '+' : ''}${formatNumber(row.amount)} LC` : '';
    const target = row.target_id ? ` → <@${row.target_id}>` : '';
    return `${discordTimestamp(row.created_at, 'd')} · <@${row.actor_id}> **${row.action}**${amount}${target}${row.reason ? `\n> ${truncate(row.reason, 120)}` : ''}`;
  });
  const kit = ctx.embeds.for(guildId);
  const components = totalPages > 1 ? [pageRow((p) => cid('ecoaudit', 'page', p), page, totalPages)] : [];
  return { embeds: [kit.base({ title: '📒 Economy audit log', description: truncate(lines.join('\n') || 'No administrative actions yet.', 4096) })], components, allowedMentions: { parse: [] } };
}

const userOption = (o) => o.setName('user').setDescription('Member').setRequired(true);
const reasonOption = (o) => o.setName('reason').setDescription('Why (recorded in the audit log)').setRequired(true).setMaxLength(300);
const amountSub = (name, description) => (s) => s.setName(name).setDescription(description)
  .addUserOption(userOption)
  .addIntegerOption((o) => o.setName('amount').setDescription('Lyss Coins').setRequired(true).setMinValue(name === 'set' ? 0 : 1))
  .addStringOption(reasonOption)
  .addStringOption((o) => o.setName('account').setDescription('Wallet (default) or bank').addChoices(...ACCOUNT_CHOICES));

const command = {
  data: new SlashCommandBuilder().setName('economy').setDescription('The Lyss Coins economy')
    .addSubcommand((s) => s.setName('dashboard').setDescription('Your economy dashboard'))
    .addSubcommand((s) => s.setName('help').setDescription('How the economy works'))
    .addSubcommandGroup((g) => g.setName('admin').setDescription('Economy administration')
      .addSubcommand((s) => s.setName('balance').setDescription('Inspect a member\'s account').addUserOption(userOption))
      .addSubcommand(amountSub('add', 'Add coins to a member'))
      .addSubcommand(amountSub('remove', 'Remove coins from a member'))
      .addSubcommand(amountSub('set', 'Set a member\'s balance'))
      .addSubcommand((s) => s.setName('reset').setDescription('Empty a member\'s wallet and bank').addUserOption(userOption).addStringOption(reasonOption))
      .addSubcommand((s) => s.setName('freeze').setDescription('Block a member from all economy activity').addUserOption(userOption).addStringOption(reasonOption))
      .addSubcommand((s) => s.setName('unfreeze').setDescription('Unfreeze a member').addUserOption(userOption)
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(300)))
      .addSubcommand((s) => s.setName('config').setDescription('View or change economy settings')
        .addStringOption((o) => o.setName('setting').setDescription('Setting to change').setAutocomplete(true))
        .addStringOption((o) => o.setName('value').setDescription('New value').setMaxLength(50)))
      .addSubcommand((s) => s.setName('audit').setDescription('Administrative actions'))),
  category: 'Economy',
  tier: 'member',
  subcommandTiers: Object.fromEntries([
    ...['balance', 'add', 'remove', 'set', 'reset', 'freeze', 'unfreeze', 'audit'].map((sub) => [`admin ${sub}`, 'admin']),
    ['admin config', 'owner'],
  ]),
  // There are more settings than Discord allows as fixed choices, so they are searchable instead.
  autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const matches = SETTING_CHOICES.filter((c) => c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query));
    return interaction.respond(matches.slice(0, 25));
  },
  async execute(interaction, ctx) {
    const { economy } = getServices(ctx);
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    if (!group) {
      if (sub === 'help') return interaction.reply({ embeds: [helpEmbed(ctx, guildId)], flags: EPHEMERAL });
      return interaction.reply({ ...dashboard(ctx, interaction), flags: EPHEMERAL });
    }

    const settings = settingsFor(ctx, guildId);
    const actorId = interaction.user.id;
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: EPHEMERAL });

    if (sub === 'audit') return interaction.reply({ ...auditPage(ctx, guildId, 1), flags: EPHEMERAL });

    if (sub === 'config') {
      const key = interaction.options.getString('setting');
      const raw = interaction.options.getString('value');
      if (!key) {
        const lines = ECONOMY_SETTINGS.map((s) => `${s.label}: **${formatSettingValue(s, ctx.guildConfig.get(guildId, s.key))}**`);
        return reply(kit.base({ title: '⚙️ Economy settings', description: lines.join('\n') }).setFooter({ text: 'Change one with /economy admin config setting value' }));
      }
      const setting = ECONOMY_SETTINGS.find((s) => s.key === key);
      if (!setting) throw new UserError('Pick a setting from the list.', { title: 'Unknown setting' });
      if (raw === null) throw new UserError('Provide a value for the setting.', { title: 'Value required' });
      const { value, error } = parseSettingValue(setting, raw);
      if (error) throw new UserError(error, { title: 'Invalid value' });
      const problem = settingsProblem({ ...economySettings(ctx.guildConfig, guildId), [key.slice('economy.'.length)]: value });
      if (problem) throw new UserError(problem, { title: 'Invalid value' });
      const before = ctx.guildConfig.get(guildId, key);
      ctx.guildConfig.set(guildId, key, value, actorId);
      economy.logConfigChange({ guildId, actorId, key, before, after: value });
      ctx.logger.info('Economy setting changed', { guildId, key, by: actorId });
      return reply(kit.success('Setting saved', `**${setting.label}** is now ${formatSettingValue(setting, value)}.`));
    }

    const user = interaction.options.getUser('user', true);
    if (user.bot) throw new UserError('Bots do not have economy accounts.', { title: 'Invalid member' });
    const reason = interaction.options.getString('reason');

    if (sub === 'balance') {
      const account = economy.account(guildId, user.id);
      return reply(balanceEmbed(ctx, guildId, user, account, economy.rank(guildId, user.id))
        .addFields({ name: 'Transactions', value: formatNumber(economy.transactionCount(guildId, user.id)), inline: true }));
    }
    if (sub === 'reset') {
      const { before } = economy.adminReset({ guildId, actorId, targetId: user.id, reason, settings });
      ctx.logger.info('Economy reset', { guildId, target: user.id, by: actorId });
      return reply(kit.success('Account reset', `${user}'s wallet and bank were emptied (was ${formatCoins(before.wallet + before.bank)}). History is kept.`));
    }
    if (sub === 'freeze' || sub === 'unfreeze') {
      economy.setFrozen({ guildId, actorId, targetId: user.id, frozen: sub === 'freeze', reason, settings });
      ctx.logger.info(`Economy ${sub}`, { guildId, target: user.id, by: actorId });
      return reply(kit.success(sub === 'freeze' ? 'Account frozen' : 'Account unfrozen', `${user} ${sub === 'freeze' ? 'can no longer use the economy' : 'can use the economy again'}.`));
    }

    const account = interaction.options.getString('account') ?? 'wallet';
    const { after, delta } = economy.adminAdjust({
      guildId, actorId, targetId: user.id, action: sub, amount: interaction.options.getInteger('amount', true), account, reason, settings,
    });
    ctx.logger.info('Economy adjustment', { guildId, target: user.id, by: actorId, action: sub, delta });
    return reply(kit.success('Balance updated', `${user}'s ${account} changed by ${delta > 0 ? '+' : '−'}${formatCoins(Math.abs(delta))} and is now ${formatCoins(after[account])}.`));
  },
};

async function moveAll(interaction, ctx, action) {
  const { economy } = getServices(ctx);
  const account = economy.account(interaction.guildId, interaction.user.id);
  const amount = action === 'deposit' ? account.wallet : account.bank;
  if (!amount) throw new UserError(`You have nothing to ${action}.`, { title: 'Nothing to move' });
  economy[action]({ guildId: interaction.guildId, userId: interaction.user.id, amount, settings: settingsFor(ctx, interaction.guildId) });
  return interaction.update(dashboard(ctx, interaction));
}

export default {
  commands: [command],
  components: [
    { id: 'eco:depositall', execute: (interaction, ctx) => moveAll(interaction, ctx, 'deposit') },
    { id: 'eco:withdrawall', execute: (interaction, ctx) => moveAll(interaction, ctx, 'withdraw') },
    { id: 'eco:refresh', execute: (interaction, ctx) => interaction.update(dashboard(ctx, interaction)) },
    {
      id: 'ecoaudit:page',
      tier: 'admin',
      execute: (interaction, ctx, [page]) => interaction.update(auditPage(ctx, interaction.guildId, Number(page))),
    },
  ],
};
