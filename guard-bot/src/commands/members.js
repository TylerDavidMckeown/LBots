import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { plural, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { MAX_TIMEOUT_MS } from '../services/caseService.js';
import {
  caseReply, deferEphemeral, readDuration, readReason, reasonOption, resolveTarget, userOption,
} from '../services/commandHelpers.js';
import { getServices } from '../services/index.js';
import {
  actorOf, ban, kick, timeout, untimeout, unban, unwarn, warn,
} from '../services/moderation.js';

const MINUTE = 60_000;
const DAY = 86_400_000;

const DELETE_CHOICES = [
  { name: 'Don\'t delete any', value: 0 },
  { name: 'Previous hour', value: 3_600 },
  { name: 'Previous 24 hours', value: 86_400 },
  { name: 'Previous 7 days', value: 604_800 },
];

const moderation = (data, execute) => ({ data, execute, category: 'Moderation', tier: 'moderator' });

export default [
  moderation(
    new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
      .addUserOption(userOption('Member to warn')).addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const reason = readReason(ctx, interaction, { required: true });
      const { user, member } = await resolveTarget(interaction);
      const { warnCase, escalation } = await warn(ctx, interaction.guild, actorOf(interaction.user), user, reason, { member });
      const active = getServices(ctx).cases.activeWarnings(interaction.guildId, user.id).length;
      let extra = `\n${user} now has **${plural(active, 'active warning')}**.`;
      if (escalation) extra += `\nThat reached ${escalation.rule.count} warnings, so they were timed out for ${formatDuration(escalation.rule.durationMs)} (case #${escalation.case.number}).`;
      return caseReply(ctx, interaction, warnCase, extra);
    },
  ),

  {
    data: new SlashCommandBuilder().setName('warnings').setDescription('View warnings')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')),
    category: 'Moderation',
    tier: 'member',
    async execute(interaction, ctx) {
      const target = interaction.options.getUser('user') ?? interaction.user;
      const isModerator = ctx.permissions.tierOf(interaction) >= Tier.MODERATOR;
      if (target.id !== interaction.user.id && !isModerator) {
        throw new UserError('You can only view your own warnings.', { title: 'Missing permission' });
      }
      const now = Date.now();
      const all = getServices(ctx).cases.warnings(interaction.guildId, target.id);
      const active = all.filter((w) => !w.revoked_at && (!w.expires_at || w.expires_at > now));
      const lines = active.map((w) => `**#${w.number}** · ${discordTimestamp(w.created_at, 'd')} · expires ${discordTimestamp(w.expires_at, 'R')}${isModerator ? ` · <@${w.moderator_id}>` : ''}\n> ${truncate(w.reason || 'No reason provided', 150)}`);
      const kit = ctx.embeds.for(interaction.guildId);
      const embed = kit.base({ title: `⚠️ Warnings · ${target.username}`, description: truncate(lines.join('\n') || 'No active warnings.', 4096) })
        .addFields({ name: 'Active', value: String(active.length), inline: true }, { name: 'Expired or removed', value: String(all.length - active.length), inline: true });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },

  moderation(
    new SlashCommandBuilder().setName('unwarn').setDescription('Remove a warning')
      .addIntegerOption((o) => o.setName('case').setDescription('Warning case number').setRequired(true).setMinValue(1))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const { revoked, record } = await unwarn(ctx, interaction.guild, actorOf(interaction.user), interaction.options.getInteger('case', true), readReason(ctx, interaction));
      return caseReply(ctx, interaction, record, `\nWarning #${revoked.number} for <@${revoked.target_id}> no longer counts.`);
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('timeout').setDescription('Time out a member')
      .addUserOption(userOption('Member to time out'))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true).setMaxLength(20))
      .addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const durationMs = readDuration(interaction, 'duration', { min: MINUTE, max: MAX_TIMEOUT_MS, label: 'A timeout' });
      const reason = readReason(ctx, interaction, { required: true });
      const { member } = await resolveTarget(interaction);
      const created = await timeout(ctx, interaction.guild, actorOf(interaction.user), member, durationMs, reason);
      return caseReply(ctx, interaction, created, `\n${member} is timed out until ${discordTimestamp(created.expires_at, 'f')}.`);
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member\'s timeout')
      .addUserOption(userOption('Member')).addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const { member } = await resolveTarget(interaction);
      return caseReply(ctx, interaction, await untimeout(ctx, interaction.guild, actorOf(interaction.user), member, readReason(ctx, interaction)));
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
      .addUserOption(userOption('Member to kick')).addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const reason = readReason(ctx, interaction, { required: true });
      const { member } = await resolveTarget(interaction);
      return caseReply(ctx, interaction, await kick(ctx, interaction.guild, actorOf(interaction.user), member, reason));
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('ban').setDescription('Ban a member or user ID')
      .addUserOption(userOption('User to ban')).addStringOption(reasonOption)
      .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages').addChoices(...DELETE_CHOICES)),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const reason = readReason(ctx, interaction, { required: true });
      const { user } = await resolveTarget(interaction, { requireMember: false });
      const created = await ban(ctx, interaction.guild, actorOf(interaction.user), user, reason, { deleteMessageSeconds: interaction.options.getInteger('delete_messages') ?? 0 });
      return caseReply(ctx, interaction, created);
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('tempban').setDescription('Ban a member for a limited time')
      .addUserOption(userOption('User to ban'))
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 12h, 7d (max 365d)').setRequired(true).setMaxLength(20))
      .addStringOption(reasonOption)
      .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages').addChoices(...DELETE_CHOICES)),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const durationMs = readDuration(interaction, 'duration', { min: MINUTE, max: 365 * DAY, label: 'A temporary ban' });
      const reason = readReason(ctx, interaction, { required: true });
      const { user } = await resolveTarget(interaction, { requireMember: false });
      const created = await ban(ctx, interaction.guild, actorOf(interaction.user), user, reason, {
        durationMs, deleteMessageSeconds: interaction.options.getInteger('delete_messages') ?? 0,
      });
      return caseReply(ctx, interaction, created, `\nThey will be unbanned automatically ${discordTimestamp(created.expires_at, 'R')}.`);
    },
  ),

  moderation(
    new SlashCommandBuilder().setName('unban').setDescription('Unban a user')
      .addUserOption(userOption('User to unban (mention or ID)')).addStringOption(reasonOption),
    async (interaction, ctx) => {
      await deferEphemeral(interaction);
      const { user } = await resolveTarget(interaction, { requireMember: false });
      return caseReply(ctx, interaction, await unban(ctx, interaction.guild, actorOf(interaction.user), user.id, readReason(ctx, interaction)));
    },
  ),
];
