import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';

/** Internal permission tiers, lowest to highest. */
export const Tier = Object.freeze({
  RESTRICTED: 0,
  MEMBER: 1,
  STAFF: 2,
  MODERATOR: 3,
  ADMIN: 4,
  OWNER: 5,
});

export const TIER_LABELS = Object.freeze({
  [Tier.RESTRICTED]: 'Restricted member',
  [Tier.MEMBER]: 'Member',
  [Tier.STAFF]: 'Staff',
  [Tier.MODERATOR]: 'Moderator',
  [Tier.ADMIN]: 'Admin',
  [Tier.OWNER]: 'Owner',
});

/** Accepts 'admin', 'ADMIN' or a numeric tier. Unknown names throw so typos fail loudly at startup. */
export function parseTier(value) {
  if (typeof value === 'number' && value in TIER_LABELS) return value;
  const key = String(value ?? 'member').toUpperCase();
  if (!(key in Tier)) throw new Error(`Unknown permission tier: ${value}`);
  return Tier[key];
}

function roleIdsOf(member) {
  if (!member?.roles) return [];
  if (member.roles.cache) return [...member.roles.cache.keys()];
  return Array.isArray(member.roles) ? member.roles : [];
}

/**
 * Resolves a member's tier.
 * @param {object} member GuildMember or raw API member.
 * @param {{ ownerIds?: string[], guildOwnerId?: string, roles?: { admin?: string, moderator?: string, staff?: string, restricted?: string } }} options
 */
export function resolveTier(member, { ownerIds = [], guildOwnerId, roles = {} } = {}) {
  if (!member) return Tier.MEMBER;
  const userId = member.id ?? member.user?.id;
  if (ownerIds.includes(userId) || (guildOwnerId && guildOwnerId === userId)) return Tier.OWNER;

  const permissions = new PermissionsBitField(member.permissions ?? 0n);
  const roleIds = roleIdsOf(member);
  const has = (roleId) => Boolean(roleId) && roleIds.includes(roleId);

  if (permissions.has(PermissionFlagsBits.Administrator) || permissions.has(PermissionFlagsBits.ManageGuild) || has(roles.admin)) {
    return Tier.ADMIN;
  }
  if (has(roles.moderator)) return Tier.MODERATOR;
  if (has(roles.staff)) return Tier.STAFF;
  if (has(roles.restricted)) return Tier.RESTRICTED;
  return Tier.MEMBER;
}

export function hasTier(actual, required) {
  return actual >= parseTier(required);
}

/** Binds tier resolution to a bot's owner IDs and guild configuration. */
export function createPermissions({ guildConfig, ownerIds = [] }) {
  return {
    tierOf(interactionOrMember) {
      const member = interactionOrMember.member ?? interactionOrMember;
      const guild = interactionOrMember.guild ?? member?.guild;
      const guildId = interactionOrMember.guildId ?? guild?.id;
      if (!guildId) {
        const userId = interactionOrMember.user?.id ?? member?.id;
        return ownerIds.includes(userId) ? Tier.OWNER : Tier.MEMBER;
      }
      return resolveTier(member, {
        ownerIds,
        guildOwnerId: guild?.ownerId,
        roles: {
          admin: guildConfig.get(guildId, 'role.admin'),
          moderator: guildConfig.get(guildId, 'role.moderator'),
          staff: guildConfig.get(guildId, 'role.staff'),
          restricted: guildConfig.get(guildId, 'role.restricted'),
        },
      });
    },
  };
}
