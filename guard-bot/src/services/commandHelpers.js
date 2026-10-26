import { MessageFlags } from 'discord.js';
import { ownerIdsFromEnv } from '@lyss/shared/env.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { formatDuration, parseDuration } from '@lyss/shared/utils/time.js';
import { CASE_ACTIONS } from './caseService.js';
import { checkHierarchy } from './hierarchy.js';

// Option builders shared by the moderation commands.
export const userOption = (description = 'The member') => (o) => o.setName('user').setDescription(description).setRequired(true);
export const reasonOption = (o) => o.setName('reason').setDescription('Reason (recorded in the case and audit log)').setMaxLength(500);

export const deferEphemeral = (interaction) => interaction.deferReply({ flags: MessageFlags.Ephemeral });

/**
 * Resolves the `user` option and enforces role hierarchy, owner protection and self-targeting rules.
 * @returns {Promise<{ user: import('discord.js').User, member: import('discord.js').GuildMember | null }>}
 */
export async function resolveTarget(interaction, { requireMember = true } = {}) {
  const { guild } = interaction;
  const user = interaction.options.getUser('user', true);
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (requireMember && !member) throw new UserError(`${user} is not in this server.`, { title: 'Member not found' });
  const actor = interaction.member?.roles?.highest ? interaction.member : await guild.members.fetch(interaction.user.id);
  const me = guild.members.me ?? await guild.members.fetchMe();
  const ownerIds = ownerIdsFromEnv();
  const problem = checkHierarchy({
    actorId: interaction.user.id,
    actorPosition: actor.roles.highest.position,
    actorIsOwner: guild.ownerId === interaction.user.id || ownerIds.includes(interaction.user.id),
    targetId: user.id,
    targetPosition: member ? member.roles.highest.position : null,
    guildOwnerId: guild.ownerId,
    botId: me.id,
    botPosition: me.roles.highest.position,
    protectedIds: ownerIds,
  });
  if (problem) throw new UserError(problem, { title: 'Not allowed' });
  return { user, member };
}

/** Reads the reason, enforcing guard.requireReason for actions that need one. */
export function readReason(ctx, interaction, { required = false } = {}) {
  const reason = interaction.options.getString('reason')?.trim();
  if (reason) return reason;
  if (required && ctx.guildConfig.get(interaction.guildId, 'guard.requireReason')) {
    throw new UserError('Please give a reason. Admins can make reasons optional in `/setup value` › Require reasons.', { title: 'Reason required' });
  }
  return null;
}

export function readDuration(interaction, name, { min, max, label }) {
  const ms = parseDuration(interaction.options.getString(name, true));
  if (!ms) throw new UserError('Use a duration such as 10m, 2h or 3d.', { title: 'Invalid duration' });
  if (ms < min || ms > max) throw new UserError(`${label} must be between ${formatDuration(min)} and ${formatDuration(max)}.`, { title: 'Invalid duration' });
  return ms;
}

export function caseReply(ctx, interaction, c, extra = '') {
  const info = CASE_ACTIONS[c.action];
  const kit = ctx.embeds.for(interaction.guildId);
  return interaction.editReply({ embeds: [kit.success(`${info.emoji} ${info.label}`, `Recorded as case **#${c.number}**.${extra}`)] });
}
