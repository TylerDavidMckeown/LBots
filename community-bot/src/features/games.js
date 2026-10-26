import {
  ActionRowBuilder, ButtonStyle, Events, SlashCommandBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatNumber, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { formatCoins, parseAmountInput } from '../services/economyRules.js';
import { DASHBOARD, GAME_CATEGORIES, GAMES } from '../services/games/catalogue.js';
import { getServices, settingsFor } from '../services/index.js';
import { cid, EPHEMERAL, fetchChannel } from './common.js';
import { ANIMATED, answerModal, button, duelView, gameView, spinFrame } from './gameViews.js';

const DAY = 86_400_000;

// ── Shared helpers for the game commands ───────────────────────────────────

export const amountOption = (required = true) => (o) => o.setName('amount').setDescription('Stake, e.g. 500, 2.5k, half or all')
  .setRequired(required).setMaxLength(20);

/** Reads the stake option. "all" and "half" are capped at the server's largest stake. */
export function readStake(interaction, ctx, required = true) {
  const raw = interaction.options.getString('amount', required);
  if (raw === null) return 0;
  const settings = settingsFor(ctx, interaction.guildId);
  const { wallet } = getServices(ctx).economy.account(interaction.guildId, interaction.user.id);
  const amount = parseAmountInput(raw, Math.min(wallet, settings.gameMaxBet));
  if (!amount) {
    const empty = wallet === 0 && /^(all|max|half)$/i.test(raw.trim());
    throw new UserError(empty ? 'Your wallet is empty.' : 'Enter a positive amount, such as `500`, `2.5k`, `half` or `all`.', { title: 'Invalid amount' });
  }
  return amount;
}

/** Stores where a game's message lives, so expiry can update it later. */
export function remember(ctx, session, message) {
  if (message?.id) getServices(ctx).games.setMessage(session.id, message.channelId ?? session.channel_id, message.id);
}

/** Fishing and reaction games change their message at a server-chosen moment. */
export function scheduleTimedEdit(ctx, session, edit) {
  const keyOf = (s) => (s.game === 'fish' ? s.state?.biteAt : s.game === 'reaction' ? s.state?.goAt : null);
  const at = session.status === 'active' ? keyOf(session) : null;
  if (!at) return;
  const timer = setTimeout(async () => {
    const current = getServices(ctx).games.get(session.id);
    if (current?.status === 'active' && keyOf(current) === at) await edit(gameView(ctx, current)).catch(() => {});
  }, Math.max(0, at - Date.now()) + 50);
  timer.unref?.();
}

/** Starts a game from a slash command: a confirmation card for stakes, the game itself otherwise. */
export async function present(interaction, ctx, game, stake = 0, options = {}) {
  const { games } = getServices(ctx);
  const settings = settingsFor(ctx, interaction.guildId);
  const base = { guildId: interaction.guildId, userId: interaction.user.id, game, stake, options, settings, channelId: interaction.channelId };
  const session = stake > 0 ? games.open(base) : games.start(base).session;
  const response = await interaction.reply({ ...gameView(ctx, session), withResponse: true });
  remember(ctx, session, response?.resource?.message);
  scheduleTimedEdit(ctx, session, (payload) => interaction.editReply(payload));
}

/** Updates the clicked message with a game step, with a short reveal for games of chance. */
export async function showResult(interaction, ctx, result) {
  const { session, feedback, settlement } = result;
  const view = session.opponent_id ? duelView(ctx, session, { feedback }) : gameView(ctx, session, { feedback, settlement });
  if (settlement && ANIMATED.has(session.game) && !result.expired) {
    await interaction.update(spinFrame(ctx, session));
    const timer = setTimeout(() => interaction.editReply(view).catch(() => {}), 1_200);
    timer.unref?.();
    return;
  }
  await interaction.update(view);
  scheduleTimedEdit(ctx, session, (payload) => interaction.editReply(payload));
}

/** Re-renders a game's stored message (after expiry, a quit from /games, or a player leaving). */
export async function refreshMessage(ctx, { session, feedback = null, settlement = null }) {
  if (!session?.channel_id || !session.message_id) return;
  const channel = await fetchChannel(ctx, session.channel_id);
  const message = await channel?.messages?.fetch(session.message_id).catch(() => null);
  if (!message) return;
  const view = session.opponent_id ? duelView(ctx, session, { feedback }) : gameView(ctx, session, { feedback, settlement });
  await message.edit(view).catch((error) => ctx.logger.warn('Could not update a game message', { id: session.id, error: error.message }));
}

// ── /games dashboard ───────────────────────────────────────────────────────

const signed = (amount) => `${amount < 0 ? '−' : '+'}${formatCoins(Math.abs(amount))}`;
const gameName = (key) => (GAMES[key] ? `${GAMES[key].emoji} ${GAMES[key].name}` : key === 'dailyspin' ? '🎡 Daily Spin' : key);

function stakeText(entry, settings) {
  if (entry.stake === 'fixed') return `Costs ${formatCoins(entry.price)}`;
  if (entry.stake === 'required') return `Stake ${formatNumber(settings.gameMinBet)}–${formatNumber(settings.gameMaxBet)} LC`;
  if (entry.stake === 'optional') return 'Free or staked';
  return 'Free';
}

function cooldownText(entry, settings) {
  if (entry.cooldownText) return entry.cooldownText;
  if (!entry.cooldownMs) return null;
  return `Cooldown ${formatDuration(Math.round((entry.cooldownMs * settings.gameCooldownPercent) / 100))}`;
}

export function dashboardView(ctx, guildId, userId, category = 'casino') {
  const settings = settingsFor(ctx, guildId);
  const kit = ctx.embeds.for(guildId);
  const group = GAME_CATEGORIES[category];
  const embed = kit.base({
    title: `🎮 Games · ${group.emoji} ${group.label}`,
    description: `${group.description}\nOutcomes are decided at random by the bot, and every payout table is listed here.`,
  });
  for (const entry of DASHBOARD.filter((g) => g.category === category)) {
    const facts = [stakeText(entry, settings), cooldownText(entry, settings)].filter(Boolean).join(' · ');
    const lines = [entry.comingSoon ? '*Coming soon.*' : null, entry.rules, `**${facts}**`, ...(entry.payouts ?? []).map((p) => `• ${p}`)];
    if (entry.modes?.length) lines.push(`Modes: ${entry.modes.join(' · ')}`);
    embed.addFields({ name: truncate(`${entry.emoji} ${entry.name} · ${entry.command}`, 256), value: truncate(lines.filter(Boolean).join('\n'), 700) });
  }
  const active = getServices(ctx).games.activeFor(guildId, userId);
  if (active) embed.addFields({ name: 'Your game in progress', value: `${gameName(active.game)}, ends ${discordTimestamp(active.expires_at, 'R')}` });
  const select = new StringSelectMenuBuilder().setCustomId(cid('games', 'category')).setPlaceholder('Choose a category')
    .addOptions(Object.entries(GAME_CATEGORIES).map(([value, c]) => ({ label: c.label, value, emoji: c.emoji, default: value === category })));
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        button(cid('games', 'stats'), { label: 'My stats', emoji: '📊' }),
        button(cid('games', 'history'), { label: 'History', emoji: '📜' }),
        button(cid('games', 'quit'), { label: 'Quit my current game', emoji: '🛑', style: ButtonStyle.Danger, disabled: !active }),
      ),
    ],
  };
}

function statsView(ctx, guildId, user, now = Date.now()) {
  const { games } = getServices(ctx);
  const settings = settingsFor(ctx, guildId);
  const kit = ctx.embeds.for(guildId);
  const lines = games.stats(guildId, user.id).map((r) => {
    const record = `${r.wins}W ${r.losses}L${r.pushes ? ` ${r.pushes}P` : ''}`;
    const money = r.wagered ? `net ${signed(r.returned - r.wagered)}` : `earned ${formatCoins(r.returned)}`;
    return `${gameName(r.game)} · ${r.played} played · ${record} · ${money} · best streak ${r.best_streak}`;
  });
  const period = (since) => {
    const s = games.summary(guildId, user.id, since);
    return `${s.played} games · ${s.wins} wins · net ${signed(s.returned - s.wagered)}`;
  };
  const spinAt = games.spinReadyAt(guildId, user.id);
  return kit.base({ title: `📊 ${user.username}'s games`, description: truncate(lines.join('\n') || 'No games played yet. Try `/games`!', 4000) })
    .addFields(
      { name: 'Last 24 hours', value: period(now - DAY), inline: true },
      { name: 'Last 7 days', value: period(now - 7 * DAY), inline: true },
      { name: 'Free-game coins today', value: `${formatCoins(games.freeEarnedSince(guildId, user.id, now - DAY))} of ${formatCoins(settings.freeGameDailyCap)}`, inline: true },
      { name: 'Fishing level', value: String(games.fishingLevel(guildId, user.id)), inline: true },
      { name: 'Daily spin', value: spinAt > now ? discordTimestamp(spinAt, 'R') : 'Ready now', inline: true },
    );
}

function historyView(ctx, guildId, user) {
  const kit = ctx.embeds.for(guildId);
  const icon = { win: '🟢', loss: '🔴', push: '⚪' };
  const lines = getServices(ctx).games.history(guildId, user.id, 15).map((r) => {
    const money = r.stake ? signed(r.payout - r.stake) : r.payout ? `+${formatCoins(r.payout)}` : '±0';
    return `${discordTimestamp(r.created_at, 'R')} ${gameName(r.game)} · ${icon[r.result]} ${r.result} · ${money}${r.opponent_id ? ` vs <@${r.opponent_id}>` : ''}`;
  });
  return kit.base({ title: `📜 ${user.username}'s recent games`, description: lines.join('\n') || 'No games played yet.' });
}

// ── Module ─────────────────────────────────────────────────────────────────

const games = {
  data: new SlashCommandBuilder().setName('games').setDescription('Browse every mini-game, its rules and payouts')
    .addStringOption((o) => o.setName('category').setDescription('Category to open')
      .addChoices(...Object.entries(GAME_CATEGORIES).map(([value, c]) => ({ name: c.label, value })))),
  category: 'Games',
  tier: 'member',
  execute: (interaction, ctx) => interaction.reply({
    ...dashboardView(ctx, interaction.guildId, interaction.user.id, interaction.options.getString('category') ?? 'casino'),
    flags: EPHEMERAL,
  }),
};

const action = (args) => args.join(':') || null;

export default {
  commands: [games],
  components: [
    {
      id: 'game:go',
      async execute(interaction, ctx, [sessionId, ...rest]) {
        const result = getServices(ctx).games.begin({ sessionId, userId: interaction.user.id, action: action(rest), settings: settingsFor(ctx, interaction.guildId) });
        await showResult(interaction, ctx, result);
      },
    },
    {
      id: 'game:act',
      async execute(interaction, ctx, [sessionId, ...rest]) {
        const result = getServices(ctx).games.act({ sessionId, userId: interaction.user.id, action: action(rest), settings: settingsFor(ctx, interaction.guildId) });
        await showResult(interaction, ctx, result);
      },
    },
    {
      id: 'game:ask',
      async execute(interaction, ctx, [sessionId]) {
        const session = getServices(ctx).games.get(sessionId);
        if (!session || session.host_id !== interaction.user.id) throw new UserError('This is not your game.', { title: 'Not your game' });
        if (session.status !== 'active') throw new UserError('This game is already finished.', { title: 'Game finished' });
        await interaction.showModal(answerModal(session));
      },
    },
    {
      id: 'game:answer',
      async execute(interaction, ctx, [sessionId]) {
        const result = getServices(ctx).games.act({
          sessionId, userId: interaction.user.id, action: 'answer', input: interaction.fields.getTextInputValue('answer'), settings: settingsFor(ctx, interaction.guildId),
        });
        await showResult(interaction, ctx, result);
      },
    },
    {
      id: 'game:cancel',
      async execute(interaction, ctx, [sessionId]) {
        const session = getServices(ctx).games.cancel({ sessionId, userId: interaction.user.id, settings: settingsFor(ctx, interaction.guildId) });
        await interaction.update(gameView(ctx, session));
      },
    },
    {
      id: 'game:quit',
      async execute(interaction, ctx, [sessionId]) {
        const result = getServices(ctx).games.quit({ sessionId, userId: interaction.user.id, settings: settingsFor(ctx, interaction.guildId) });
        await showResult(interaction, ctx, result);
      },
    },
    {
      id: 'game:again',
      async execute(interaction, ctx, [sessionId]) {
        const { games: service } = getServices(ctx);
        const previous = service.get(sessionId);
        if (!previous || previous.host_id !== interaction.user.id) throw new UserError('Only the player can start another round from here.', { title: 'Not your game' });
        // Server-chosen inputs (the trivia question, fishing level) are picked afresh.
        const { questionId, level, ...options } = previous.options;
        const settings = settingsFor(ctx, interaction.guildId);
        const base = { guildId: previous.guild_id, userId: previous.host_id, game: previous.game, stake: previous.stake, options, settings, channelId: interaction.channelId };
        const session = previous.stake > 0 ? service.open(base) : service.start(base).session;
        await interaction.update({ components: [] });
        const message = await interaction.followUp(gameView(ctx, session));
        remember(ctx, session, message);
        scheduleTimedEdit(ctx, session, (payload) => interaction.editReply({ ...payload, message: message.id }));
      },
    },
    {
      id: 'games:category',
      execute: (interaction, ctx) => interaction.update(dashboardView(ctx, interaction.guildId, interaction.user.id, interaction.values[0])),
    },
    {
      id: 'games:stats',
      execute: (interaction, ctx) => interaction.reply({ embeds: [statsView(ctx, interaction.guildId, interaction.user)], flags: EPHEMERAL }),
    },
    {
      id: 'games:history',
      execute: (interaction, ctx) => interaction.reply({ embeds: [historyView(ctx, interaction.guildId, interaction.user)], flags: EPHEMERAL, allowedMentions: { parse: [] } }),
    },
    {
      id: 'games:quit',
      async execute(interaction, ctx) {
        const result = getServices(ctx).games.quit({ guildId: interaction.guildId, userId: interaction.user.id, settings: settingsFor(ctx, interaction.guildId) });
        await interaction.update(dashboardView(ctx, interaction.guildId, interaction.user.id, GAMES[result.session.game].category));
        await refreshMessage(ctx, result);
      },
    },
  ],
  events: [
    {
      // Duels with a member who leaves are cancelled and every stake is returned.
      name: Events.GuildMemberRemove,
      async execute(member, ctx) {
        const closed = getServices(ctx).games.cancelForMember({ guildId: member.guild.id, userId: member.id, settings: settingsFor(ctx, member.guild.id) });
        for (const session of closed) await refreshMessage(ctx, { session });
      },
    },
  ],
  jobs: [
    {
      // Applies each game's expiry rule (refund, cash out, auto-stand, forfeit) and updates its message.
      type: 'community:games-expire',
      every: 60_000,
      async execute(payload, task, ctx) {
        const results = getServices(ctx).games.expireDue(Date.now(), (guildId) => settingsFor(ctx, guildId));
        for (const result of results) {
          if (result.error) ctx.logger.error('Game expiry failed', { id: result.id, error: result.error.message });
          else await refreshMessage(ctx, result);
        }
      },
    },
  ],
};
