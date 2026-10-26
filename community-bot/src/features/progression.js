import { SlashCommandBuilder } from 'discord.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { formatNumber, plural, progressBar, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { formatCoins, levelForXp } from '../services/economyRules.js';
import { getServices, settingsFor } from '../services/index.js';
import { itemList } from '../services/items.js';
import { jobLevelForXp, JOBS } from '../services/jobTasks.js';
import {
  BADGES, LEVEL_MILESTONES, levelCoins, levelRewards, memberLevelForXp, TITLES, XP_SOURCES, xpForMemberLevel,
} from '../services/progressionRules.js';
import { petLabel, petLevelForXp } from '../services/pets/rules.js';
import { cid, EPHEMERAL } from './common.js';

/** Member levels: /level, /xp and /progression. */

const PER_PAGE = 10;

export function rewardText(rewards) {
  return [
    rewards.coins ? `${formatCoins(rewards.coins)} (to your bank)` : null,
    rewards.items?.length ? itemList(rewards.items) : null,
    rewards.title ? `the title **${TITLES[rewards.title]}**` : null,
    rewards.badge ? `the ${BADGES[rewards.badge].emoji} **${BADGES[rewards.badge].name}** badge` : null,
  ].filter(Boolean).join(', ');
}

/** Lines announcing a member level-up and its rewards, for any activity's result message. */
export function progressionLines(result) {
  if (!result || result.levelAfter <= result.levelBefore) return [];
  return [`🌟 **You reached member level ${result.levelAfter}!**`, ...result.rewards.map((r) => `🎁 Level ${r.level}: ${rewardText(r)}`)];
}

function levelBar(xp) {
  const level = memberLevelForXp(xp);
  const floor = xpForMemberLevel(level);
  const span = xpForMemberLevel(level + 1) - floor;
  return { level, line: `Level **${level}** · ${formatNumber(xp - floor)} / ${formatNumber(span)} XP to level ${level + 1}\n${progressBar(xp - floor, span, 12)}` };
}

const nextMilestone = (level) => Object.keys(LEVEL_MILESTONES).map(Number).find((l) => l > level);

function levelEmbed(ctx, guildId, user) {
  const { progression, economy, jobs, pets } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const profile = progression.profile(guildId, user.id);
  const { level, line } = levelBar(profile.xp);
  const rank = progression.rank(guildId, user.id);
  const topJob = jobs.allProgress(guildId, user.id)[0];
  const pet = pets.active(guildId, user.id);
  const milestone = nextMilestone(level);
  return kit.base({ title: `🌟 ${user.username}'s level`, description: line })
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'Rank', value: rank ? `#${formatNumber(rank)}` : 'Unranked', inline: true },
      { name: 'Total XP', value: formatNumber(profile.xp), inline: true },
      { name: 'Economy level', value: String(levelForXp(economy.account(guildId, user.id).xp)), inline: true },
      { name: 'Best job', value: topJob ? `${JOBS[topJob.job].emoji} ${JOBS[topJob.job].name} · level ${jobLevelForXp(topJob.xp)}` : 'None yet', inline: true },
      { name: 'Active pet', value: pet ? `${petLabel(pet)} · level ${petLevelForXp(pet.xp)}` : 'None yet', inline: true },
      { name: 'Next milestone', value: milestone ? `Level ${milestone}: ${rewardText(levelRewards(milestone))}` : 'Every milestone reached!', inline: false },
    );
}

function xpEmbed(ctx, guildId, user) {
  const { progression, economy, jobs, pets } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const profile = progression.profile(guildId, user.id);
  const sources = progression.bySource(guildId, user.id);
  const lines = sources.map((s) => `${XP_SOURCES[s.source]?.emoji ?? '•'} ${XP_SOURCES[s.source]?.label ?? s.source} · **${formatNumber(s.xp)} XP** (${plural(s.n, 'time')})`);
  const economyXp = economy.account(guildId, user.id).xp;
  const jobXp = jobs.allProgress(guildId, user.id).reduce((sum, row) => sum + row.xp, 0);
  const petXp = pets.forOwner(guildId, user.id).reduce((sum, pet) => sum + pet.xp, 0);
  return kit.base({ title: `✨ ${user.username}'s XP`, description: `**${formatNumber(profile.xp)} member XP** · level ${memberLevelForXp(profile.xp)}\n\n${lines.join('\n') || 'No member XP yet. Work, play puzzles and look after pets to earn some.'}` })
    .addFields(
      { name: 'Economy XP', value: `${formatNumber(economyXp)} (level ${levelForXp(economyXp)})`, inline: true },
      { name: 'Job XP', value: formatNumber(jobXp), inline: true },
      { name: 'Pet XP', value: formatNumber(petXp), inline: true },
    );
}

function overviewEmbed(ctx, guildId, user) {
  const { progression } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const profile = progression.profile(guildId, user.id);
  const { level, line } = levelBar(profile.xp);
  const recent = progression.rewardsGranted(guildId, user.id, 5);
  const unlocks = progression.unlocks(guildId, user.id);
  const titles = unlocks.filter((u) => u.kind === 'title').map((u) => TITLES[u.unlock_key] ?? u.unlock_key);
  const badges = unlocks.filter((u) => u.kind === 'badge').map((u) => `${BADGES[u.unlock_key]?.emoji ?? '🏅'} ${BADGES[u.unlock_key]?.name ?? u.unlock_key}`);
  const milestone = nextMilestone(level);
  const settings = settingsFor(ctx, guildId);
  return kit.base({ title: `🌟 ${user.username}'s progression`, description: line })
    .addFields(
      { name: 'Next level', value: `Level ${level + 1}: ${rewardText(levelRewards(level + 1))}` },
      { name: 'Next milestone', value: milestone ? `Level ${milestone}: ${rewardText(levelRewards(milestone))}` : 'Every milestone reached!' },
      { name: 'Recent rewards', value: recent.map((r) => `Level ${r.level} · ${discordTimestamp(r.granted_at, 'R')}`).join('\n') || 'None yet', inline: true },
      { name: 'Titles', value: truncate(titles.join(', ') || 'None yet', 1024), inline: true },
      { name: 'Badges', value: truncate(badges.join(' · ') || 'None yet', 1024), inline: true },
      { name: 'How to earn XP', value: `${Object.values(XP_SOURCES).map((s) => `${s.emoji} ${s.label}`).join(' · ')}${settings.progressionXpPercent !== 100 ? `\nServer XP multiplier: ${settings.progressionXpPercent}%` : ''}` },
    );
}

function rewardsEmbed(ctx, guildId, userId) {
  const kit = ctx.embeds.for(guildId);
  const { level } = getServices(ctx).progression.profile(guildId, userId);
  const lines = Object.keys(LEVEL_MILESTONES).map(Number).map((l) => `${level >= l ? '✅' : '🔒'} **Level ${l}:** ${rewardText(levelRewards(l))}`);
  return kit.base({ title: '🎁 Level rewards', description: `Every level pays ${formatCoins(levelCoins(1))} × the new level into your bank (level 10 pays ${formatCoins(levelCoins(10))}). Milestones add more:\n\n${lines.join('\n')}` });
}

function leaderboardPage(ctx, guildId, requestedPage) {
  const { progression } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const { page, totalPages } = paginate(Array.from({ length: progression.leaderboardCount(guildId) }), requestedPage, PER_PAGE);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = progression.leaderboard(guildId, PER_PAGE, (page - 1) * PER_PAGE).map((row, i) => {
    const position = (page - 1) * PER_PAGE + i + 1;
    return `${medals[position - 1] ?? `**${position}.**`} <@${row.user_id}> · level ${row.level} · ${formatNumber(row.xp)} XP`;
  });
  return {
    embeds: [kit.base({ title: '🏆 Progression leaderboard', description: lines.join('\n') || 'Nobody has earned member XP yet.' })],
    components: totalPages > 1 ? [pageRow((p) => cid('prog', 'lb', p), page, totalPages)] : [],
    allowedMentions: { parse: [] },
  };
}

function historyPage(ctx, guildId, userId, requestedPage) {
  const { progression } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const { page, totalPages } = paginate(Array.from({ length: progression.historyCount(guildId, userId) }), requestedPage, PER_PAGE);
  const lines = progression.history(guildId, userId, PER_PAGE, (page - 1) * PER_PAGE).map((row) => (
    `\`+${formatNumber(row.amount)}\` ${XP_SOURCES[row.source]?.emoji ?? '•'} ${XP_SOURCES[row.source]?.label ?? row.source} · ${discordTimestamp(row.created_at, 'R')}`
  ));
  return {
    embeds: [kit.base({ title: '📜 XP history', description: lines.join('\n') || 'No member XP yet.' })],
    components: totalPages > 1 ? [pageRow((p) => cid('prog', 'history', userId, p), page, totalPages)] : [],
  };
}

const userOption = (o) => o.setName('user').setDescription('Member (defaults to you)');
const progressionCommand = (data, execute) => ({ data, execute, category: 'Progression', tier: 'member' });

export default {
  commands: [
    progressionCommand(
      new SlashCommandBuilder().setName('level').setDescription('View your member level').addUserOption(userOption),
      (interaction, ctx) => interaction.reply({ embeds: [levelEmbed(ctx, interaction.guildId, interaction.options.getUser('user') ?? interaction.user)] }),
    ),
    progressionCommand(
      new SlashCommandBuilder().setName('xp').setDescription('See where your XP comes from').addUserOption(userOption),
      (interaction, ctx) => interaction.reply({ embeds: [xpEmbed(ctx, interaction.guildId, interaction.options.getUser('user') ?? interaction.user)], flags: EPHEMERAL }),
    ),
    progressionCommand(
      new SlashCommandBuilder().setName('progression').setDescription('Member levels and rewards')
        .addSubcommand((s) => s.setName('view').setDescription('Your level, rewards and unlocks').addUserOption(userOption))
        .addSubcommand((s) => s.setName('leaderboard').setDescription('The highest member levels'))
        .addSubcommand((s) => s.setName('rewards').setDescription('Every level reward'))
        .addSubcommand((s) => s.setName('history').setDescription('Your recent XP')),
      (interaction, ctx) => {
        const guildId = interaction.guildId;
        switch (interaction.options.getSubcommand()) {
          case 'leaderboard': return interaction.reply(leaderboardPage(ctx, guildId, 1));
          case 'rewards': return interaction.reply({ embeds: [rewardsEmbed(ctx, guildId, interaction.user.id)], flags: EPHEMERAL });
          case 'history': return interaction.reply({ ...historyPage(ctx, guildId, interaction.user.id, 1), flags: EPHEMERAL });
          default: return interaction.reply({ embeds: [overviewEmbed(ctx, guildId, interaction.options.getUser('user') ?? interaction.user)] });
        }
      },
    ),
  ],
  components: [
    {
      id: 'prog:lb',
      tier: 'restricted',
      execute: (interaction, ctx, [page]) => interaction.update(leaderboardPage(ctx, interaction.guildId, Number(page))),
    },
    {
      id: 'prog:history',
      async execute(interaction, ctx, [userId, page]) {
        // History is private; the buttons live on an ephemeral message, but check anyway.
        if (userId !== interaction.user.id) return interaction.reply({ embeds: [ctx.embeds.for(interaction.guildId).error('Not yours', 'You can only page through your own XP history.')], flags: EPHEMERAL });
        return interaction.update(historyPage(ctx, interaction.guildId, userId, Number(page)));
      },
    },
  ],
};
