import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { formatNumber, plural, progressBar, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { getServices, settingsFor } from '../services/index.js';
import { itemList } from '../services/items.js';
import {
  calculateReward, DIFFICULTIES, hintEmoji, jobItems, JOBS, jobLevelForXp, LEVEL_UNLOCKS, ORE_BY_KEY, TITLE_LEVEL,
  unlockedDifficulties, xpForJobLevel,
} from '../services/jobTasks.js';
import { cid, EPHEMERAL, rowsOf } from './common.js';
import { progressionLines } from './progression.js';

const JOB_CHOICES = Object.entries(JOBS).map(([value, job]) => ({ name: job.name, value }));
const DIFFICULTY_CHOICES = Object.entries(DIFFICULTIES).map(([value, d]) => ({ name: `${d.label} (job level ${d.unlockLevel}+)`, value }));

const button = (customId, { label, emoji, style = ButtonStyle.Secondary, disabled = false } = {}) => {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(truncate(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
};
const toRows = (buttons, size = 5) => rowsOf(buttons, size).map((row) => new ActionRowBuilder().addComponents(row));

function cardPayload(ctx, interaction, job, difficulty) {
  const { jobs, economy } = getServices(ctx);
  const def = JOBS[job];
  const tier = DIFFICULTIES[difficulty];
  const level = jobs.levelOf(interaction.guildId, interaction.user.id, job);
  const settings = settingsFor(ctx, interaction.guildId);
  const reward = (score) => calculateReward({ difficulty, level, score, payoutPercent: settings.workPayoutPercent, job });
  const items = jobItems(job, difficulty);
  const readyAt = economy.cooldown(interaction.guildId, interaction.user.id, 'work');
  const resting = readyAt > Date.now();
  const kit = ctx.embeds.for(interaction.guildId);
  const embed = kit.base({ title: `${def.emoji} ${def.name}`, description: `${def.description}${resting ? `\n\n⏳ You are on a break. Your next shift starts ${discordTimestamp(readyAt, 'R')}.` : ''}` })
    .addFields(
      { name: 'Difficulty', value: tier.label, inline: true },
      { name: 'Reward', value: `${formatCoins(reward(0.01))} – ${formatCoins(reward(1))}${items.length ? `\n+ ${itemList(items)}` : ''}`, inline: true },
      { name: 'XP', value: `Up to ${tier.xp} job XP`, inline: true },
      { name: 'Your level', value: `${def.name} level ${level}`, inline: true },
      { name: 'Time limit', value: formatDuration(tier.timeMs), inline: true },
      { name: 'Break afterwards', value: formatDuration(settings.workCooldown), inline: true },
    );
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      button(cid('work', 'start', job, difficulty), { label: 'Start job', emoji: '▶️', style: ButtonStyle.Success, disabled: resting }),
      button(cid('work', 'reroll', job, difficulty), { label: 'Choose another', emoji: '🔀' }),
    )],
  };
}

function taskDescription(session, now = Date.now()) {
  const { state } = session;
  switch (state.kind) {
    case 'sequence': {
      const steps = state.target.map((item, i) => (i < state.progress ? `~~${item}~~` : i === state.progress ? `**${item}**` : item));
      return `**${state.subject}**\n${steps.join(' → ')}\n\nClick the items in this order.`;
    }
    case 'grid':
      if (state.mode === 'mine') {
        const found = state.revealed.map((i) => ORE_BY_KEY[state.cells[i]].emoji).join(' ') || 'nothing yet';
        return `Mine **${plural(state.picksLeft, 'more block')}**. Found: ${found}\nValues: ⚫ 1 · 🔩 2 · 🟡 4 · 💎 8 · 🏺 15`;
      }
      return `Find the buried treasure in **${plural(state.movesLeft, 'dig')}**.\nEach dig shows how many steps away it is: 🔥 1 · 🌡️ 2 · ❄️ 3+`;
    case 'timing':
      return now >= state.biteAt
        ? '🐟 **Something is biting! Reel it in!**'
        : '🎣 Your line is in the water… wait for a bite, then reel in.\nReeling too early scares the fish away.';
    case 'quiz': {
      const round = state.rounds[state.round];
      return `${state.intro ? `${state.intro}\n\n` : ''}**Round ${state.round + 1} of ${state.rounds.length}**\n${round.prompt}`;
    }
    default:
      return '';
  }
}

function taskComponents(session) {
  const { state } = session;
  const act = (choice) => cid('work', 'act', session.id, choice);
  let buttons;
  let rowSize = 5;
  if (state.kind === 'sequence') {
    buttons = state.options.map((option, i) => button(act(i), { label: option }));
  } else if (state.kind === 'grid' && state.mode === 'mine') {
    rowSize = state.columns;
    buttons = state.cells.map((key, i) => {
      if (!state.revealed.includes(i)) return button(act(i), { label: '?' });
      const ore = ORE_BY_KEY[key];
      return button(act(i), { emoji: ore.emoji, label: String(ore.value), style: ore.value ? ButtonStyle.Success : ButtonStyle.Secondary, disabled: true });
    });
  } else if (state.kind === 'grid') {
    rowSize = state.columns;
    buttons = Array.from({ length: state.size }, (_, i) => {
      const dig = state.digs.find((d) => d.index === i);
      return dig
        ? button(act(i), { emoji: hintEmoji(dig.distance), label: String(dig.distance), disabled: true })
        : button(act(i), { label: '?' });
    });
  } else if (state.kind === 'timing') {
    buttons = [button(act('reel'), { label: 'Reel in', emoji: '🎣', style: ButtonStyle.Primary })];
  } else {
    buttons = state.rounds[state.round].options.map((option, i) => button(act(i), { label: option }));
  }
  return [...toRows(buttons, rowSize), new ActionRowBuilder().addComponents(button(cid('work', 'quit', session.id), { label: 'Quit', style: ButtonStyle.Danger }))];
}

export function taskPayload(ctx, session, feedback = null) {
  const def = JOBS[session.job];
  const tier = DIFFICULTIES[session.difficulty];
  const kit = ctx.embeds.for(session.guild_id);
  const embed = kit.base({
    title: `${def.emoji} ${def.name} · ${tier.label}${session.rare ? ' · ✨ Rare' : ''}`,
    description: truncate(`${feedback ? `${feedback}\n\n` : ''}${taskDescription(session)}`, 4096),
  }).addFields({ name: 'Time left', value: discordTimestamp(session.expires_at, 'R'), inline: true });
  if (session.state.kind === 'sequence' || session.state.kind === 'timing') {
    embed.addFields({ name: 'Mistakes', value: `${session.state.mistakes} / ${tier.maxMistakes}`, inline: true });
  }
  return { embeds: [embed], components: taskComponents(session) };
}

function resultPayload(ctx, session, feedback, settlement) {
  const def = JOBS[session.job];
  const kit = ctx.embeds.for(session.guild_id);
  const readyAt = getServices(ctx).economy.cooldown(session.guild_id, session.user_id, 'work');
  const lines = [feedback];
  if (settlement.success) {
    lines.push('', `Performance: **${Math.round(settlement.score * 100)}%**`, `Earned: **${formatCoins(settlement.reward)}**${session.rare ? ' (✨ rare bonus)' : ''}`);
    if (settlement.items?.length) lines.push(`Also earned: **${itemList(settlement.items)}**`);
  } else {
    lines.push('', 'No coins this time.');
  }
  lines.push(`+${settlement.xp} ${def.name} XP`);
  if (settlement.levelAfter > settlement.levelBefore) {
    lines.push('', `🎉 **${def.name} level ${settlement.levelAfter}!**`, ...settlement.unlocks.map((u) => `🔓 Unlocked: ${u.text}`));
  }
  const levelUp = progressionLines(settlement.progression);
  if (levelUp.length) lines.push('', ...levelUp);
  const embed = (settlement.success ? kit.success : kit.error)(`${def.name} · ${settlement.success ? 'job complete' : 'job failed'}`, lines.join('\n'))
    .addFields({ name: 'Next shift', value: readyAt > Date.now() ? discordTimestamp(readyAt, 'R') : 'Now' });
  return { embeds: [embed], components: [] };
}

// Fishing: the message changes when the fish bites. The bite time is stored in the
// session, so a restart only loses the visual cue, never the result.
function scheduleBite(ctx, interaction, session) {
  if (session.state.kind !== 'timing') return;
  const { biteAt } = session.state;
  const timer = setTimeout(async () => {
    const current = getServices(ctx).jobs.get(session.id);
    if (current?.status === 'active' && current.state.biteAt === biteAt) {
      await interaction.editReply(taskPayload(ctx, current)).catch(() => {});
    }
  }, Math.max(0, biteAt - Date.now()) + 50);
  timer.unref?.();
}

function statsEmbed(ctx, guildId, user) {
  const { jobs } = getServices(ctx);
  const byJob = Object.fromEntries(jobs.allProgress(guildId, user.id).map((r) => [r.job, r]));
  const lines = Object.entries(JOBS).map(([key, def]) => {
    const row = byJob[key];
    if (!row) return `${def.emoji} **${def.name}** · not started`;
    const level = jobLevelForXp(row.xp);
    const span = xpForJobLevel(level + 1) - xpForJobLevel(level);
    const title = level >= TITLE_LEVEL ? ` · 🏅 *${def.title}*` : '';
    return `${def.emoji} **${def.name}** · level ${level} ${progressBar(row.xp - xpForJobLevel(level), span, 8)} · ${row.completed} done · ${formatCoins(row.total_earned)}${title}`;
  });
  const totals = Object.values(byJob).reduce((t, r) => ({ completed: t.completed + r.completed, earned: t.earned + r.total_earned, xp: t.xp + r.xp }), { completed: 0, earned: 0, xp: 0 });
  const kit = ctx.embeds.for(guildId);
  return kit.base({ title: `🧰 ${user.username}'s work`, description: lines.join('\n') })
    .addFields(
      { name: 'Jobs completed', value: formatNumber(totals.completed), inline: true },
      { name: 'Earned from work', value: formatCoins(totals.earned), inline: true },
      { name: 'Total job XP', value: formatNumber(totals.xp), inline: true },
    );
}

function leaderboardPage(ctx, guildId, requestedPage) {
  const { jobs } = getServices(ctx);
  const { page, totalPages } = paginate(Array.from({ length: jobs.leaderboardCount(guildId) }), requestedPage, 10);
  const lines = jobs.leaderboard(guildId, 10, (page - 1) * 10).map((row, i) => `**${(page - 1) * 10 + i + 1}.** <@${row.user_id}> · ${formatNumber(row.xp)} XP · ${plural(row.completed, 'job')} · ${formatCoins(row.earned)}`);
  const kit = ctx.embeds.for(guildId);
  return {
    embeds: [kit.base({ title: '🏆 Hardest workers', description: lines.join('\n') || 'Nobody has worked yet. Try `/work start`!' })],
    components: totalPages > 1 ? [pageRow((p) => cid('worklb', 'page', p), page, totalPages)] : [],
    allowedMentions: { parse: [] },
  };
}

const command = {
  data: new SlashCommandBuilder().setName('work').setDescription('Interactive jobs that pay Lyss Coins')
    .addSubcommand((s) => s.setName('start').setDescription('Start a job')
      .addStringOption((o) => o.setName('job').setDescription('Which job (random if empty)').addChoices(...JOB_CHOICES))
      .addStringOption((o) => o.setName('difficulty').setDescription('Difficulty (your best unlocked if empty)').addChoices(...DIFFICULTY_CHOICES)))
    .addSubcommand((s) => s.setName('jobs').setDescription('Browse all jobs'))
    .addSubcommand((s) => s.setName('stats').setDescription('Job levels and statistics')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('The hardest workers')),
  category: 'Work',
  tier: 'member',
  async execute(interaction, ctx) {
    const { jobs } = getServices(ctx);
    const sub = interaction.options.getSubcommand();
    const kit = ctx.embeds.for(interaction.guildId);

    if (sub === 'stats') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      return interaction.reply({ embeds: [statsEmbed(ctx, interaction.guildId, user)], flags: EPHEMERAL });
    }
    if (sub === 'leaderboard') return interaction.reply(leaderboardPage(ctx, interaction.guildId, 1));
    if (sub === 'jobs') {
      const lines = Object.entries(JOBS).map(([key, def]) => {
        const level = jobs.levelOf(interaction.guildId, interaction.user.id, key);
        const tiers = unlockedDifficulties(level).map((d) => DIFFICULTIES[d].label).join(', ');
        return `${def.emoji} **${def.name}** (level ${level}: ${tiers})\n${def.description}`;
      });
      const unlocks = LEVEL_UNLOCKS.map((u) => `Level ${u.level}: ${u.text}`).join('\n');
      return interaction.reply({ embeds: [kit.base({ title: '🧰 Jobs', description: truncate(lines.join('\n\n'), 4000) }).addFields({ name: 'Job level unlocks', value: unlocks })], flags: EPHEMERAL });
    }

    const keys = Object.keys(JOBS);
    const job = interaction.options.getString('job') ?? keys[Math.floor(Math.random() * keys.length)];
    const level = jobs.levelOf(interaction.guildId, interaction.user.id, job);
    const difficulty = interaction.options.getString('difficulty') ?? unlockedDifficulties(level).at(-1);
    if (!unlockedDifficulties(level).includes(difficulty)) {
      throw new UserError(`${DIFFICULTIES[difficulty].label} ${JOBS[job].name} jobs unlock at job level ${DIFFICULTIES[difficulty].unlockLevel}. You are level ${level}.`, { title: 'Not unlocked yet' });
    }
    return interaction.reply({ ...cardPayload(ctx, interaction, job, difficulty), flags: EPHEMERAL });
  },
};

export default {
  commands: [command],
  components: [
    {
      id: 'work:start',
      async execute(interaction, ctx, [job, difficulty]) {
        const session = getServices(ctx).jobs.start({
          guildId: interaction.guildId, userId: interaction.user.id, job, difficulty, settings: settingsFor(ctx, interaction.guildId),
        });
        await interaction.update(taskPayload(ctx, session));
        scheduleBite(ctx, interaction, session);
      },
    },
    {
      id: 'work:reroll',
      async execute(interaction, ctx, [current, difficulty]) {
        const { jobs } = getServices(ctx);
        const others = Object.keys(JOBS).filter((key) => key !== current);
        const job = others[Math.floor(Math.random() * others.length)];
        const unlocked = unlockedDifficulties(jobs.levelOf(interaction.guildId, interaction.user.id, job));
        await interaction.update(cardPayload(ctx, interaction, job, unlocked.includes(difficulty) ? difficulty : unlocked.at(-1)));
      },
    },
    {
      id: 'work:act',
      async execute(interaction, ctx, [sessionId, choice]) {
        const result = getServices(ctx).jobs.act({
          sessionId, userId: interaction.user.id, choice, settings: settingsFor(ctx, interaction.guildId),
        });
        const kit = ctx.embeds.for(interaction.guildId);
        if (result.expired) {
          return interaction.update({ embeds: [kit.error('Out of time', 'This job expired before it was finished, so it paid nothing.')], components: [] });
        }
        if (result.settlement) return interaction.update(resultPayload(ctx, result.session, result.feedback, result.settlement));
        await interaction.update(taskPayload(ctx, result.session, result.feedback));
        return scheduleBite(ctx, interaction, result.session);
      },
    },
    {
      id: 'work:quit',
      async execute(interaction, ctx, [sessionId]) {
        getServices(ctx).jobs.quit({ sessionId, userId: interaction.user.id });
        const kit = ctx.embeds.for(interaction.guildId);
        await interaction.update({ embeds: [kit.info('You left the job', 'No coins were paid. Your break still applies.')], components: [] });
      },
    },
    {
      id: 'worklb:page',
      tier: 'restricted',
      execute: (interaction, ctx, [page]) => interaction.update(leaderboardPage(ctx, interaction.guildId, Number(page))),
    },
  ],
};
