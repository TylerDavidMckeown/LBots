import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

/** Permissions that must never be handed out through self-assignable or reward roles. */
export const PRIVILEGED_PERMISSIONS = Object.freeze([
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers',
  'ManageMessages', 'MentionEveryone', 'ManageWebhooks', 'ManageNicknames', 'ManageGuildExpressions', 'ManageEvents',
  'ManageThreads', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ViewGuildInsights',
].filter((name) => name in P));

export function privilegedPermissionsOf(permissions) {
  const bits = new PermissionsBitField(permissions);
  return PRIVILEGED_PERMISSIONS.filter((name) => bits.has(P[name], false));
}

const roleMention = (role) => `<@&${role.id}>`;

/**
 * Why the bot should not hand out this role, or null when it is safe.
 * @param {{ id, managed, position, permissions }} role
 * @param {{ guildId: string, botPosition: number, protectedRoleIds?: string[] }} context
 */
export function roleProblem(role, { guildId, botPosition, protectedRoleIds = [] }) {
  if (role.id === guildId) return 'The @everyone role cannot be assigned.';
  if (role.managed) return `${roleMention(role)} is managed by an integration and cannot be assigned.`;
  if (protectedRoleIds.includes(role.id)) return `${roleMention(role)} is a staff or permission role and cannot be self-assigned.`;
  const privileged = privilegedPermissionsOf(role.permissions);
  if (privileged.length) return `${roleMention(role)} has moderation or admin permissions (${privileged.slice(0, 3).join(', ')}${privileged.length > 3 ? '…' : ''}), so it cannot be handed out.`;
  if (role.position >= botPosition) return `${roleMention(role)} is above my highest role. Move my role higher first.`;
  return null;
}

/** The roles configured for permission tiers, which must never be self-assigned. */
export function protectedRoleIds(ctx, guildId) {
  return ['role.admin', 'role.moderator', 'role.staff', 'role.restricted'].map((key) => ctx.guildConfig.get(guildId, key)).filter(Boolean);
}

/** Checks a role against the live guild. Returns a problem string or null. */
export async function assignableProblem(ctx, guild, role) {
  const me = guild.members.me ?? await guild.members.fetchMe();
  if (!me.permissions.has(P.ManageRoles)) return 'I need the Manage Roles permission.';
  return roleProblem(role, { guildId: guild.id, botPosition: me.roles.highest.position, protectedRoleIds: protectedRoleIds(ctx, guild.id) });
}
