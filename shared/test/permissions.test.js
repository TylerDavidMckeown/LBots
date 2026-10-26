import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { openDatabase } from '../src/db.js';
import { createGuildConfig } from '../src/guildConfig.js';
import { createPermissions, hasTier, parseTier, resolveTier, Tier } from '../src/permissions.js';

const roles = { admin: 'r-admin', moderator: 'r-mod', staff: 'r-staff', restricted: 'r-restricted' };
const member = ({ id = '100000000000000001', permissions = 0n, roleIds = [] } = {}) => ({ id, permissions, roles: roleIds });

test('resolves every tier', () => {
  assert.equal(resolveTier(member({ id: '9' }), { ownerIds: ['9'], roles }), Tier.OWNER);
  assert.equal(resolveTier(member({ id: '8' }), { guildOwnerId: '8', roles }), Tier.OWNER);
  assert.equal(resolveTier(member({ permissions: PermissionFlagsBits.Administrator }), { roles }), Tier.ADMIN);
  assert.equal(resolveTier(member({ permissions: PermissionFlagsBits.ManageGuild }), { roles }), Tier.ADMIN);
  assert.equal(resolveTier(member({ roleIds: ['r-admin'] }), { roles }), Tier.ADMIN);
  assert.equal(resolveTier(member({ roleIds: ['r-mod'] }), { roles }), Tier.MODERATOR);
  assert.equal(resolveTier(member({ roleIds: ['r-staff'] }), { roles }), Tier.STAFF);
  assert.equal(resolveTier(member({ roleIds: ['r-restricted'] }), { roles }), Tier.RESTRICTED);
  assert.equal(resolveTier(member(), { roles }), Tier.MEMBER);
});

test('higher roles win over the restricted role', () => {
  assert.equal(resolveTier(member({ roleIds: ['r-restricted', 'r-mod'] }), { roles }), Tier.MODERATOR);
});

test('unconfigured roles never match', () => {
  assert.equal(resolveTier(member({ roleIds: [undefined, null, ''] }), { roles: {} }), Tier.MEMBER);
});

test('works with cached GuildMember role managers', () => {
  const cached = { id: '1', permissions: 0n, roles: { cache: new Map([['r-staff', {}]]) } };
  assert.equal(resolveTier(cached, { roles }), Tier.STAFF);
});

test('hasTier compares against named tiers and rejects typos', () => {
  assert.equal(hasTier(Tier.ADMIN, 'moderator'), true);
  assert.equal(hasTier(Tier.MEMBER, 'staff'), false);
  assert.equal(hasTier(Tier.RESTRICTED, 'restricted'), true);
  assert.equal(hasTier(Tier.RESTRICTED, 'member'), false);
  assert.throws(() => parseTier('admn'), /Unknown permission tier/);
});

test('createPermissions reads role configuration per guild', () => {
  const guildConfig = createGuildConfig(openDatabase(':memory:'));
  guildConfig.set('g1', 'role.moderator', 'r-mod');
  const permissions = createPermissions({ guildConfig, ownerIds: ['42'] });

  const inGuild = (guildId, m) => ({ guildId, guild: { id: guildId, ownerId: '0' }, member: m, user: { id: m.id } });
  assert.equal(permissions.tierOf(inGuild('g1', member({ roleIds: ['r-mod'] }))), Tier.MODERATOR);
  assert.equal(permissions.tierOf(inGuild('g2', member({ roleIds: ['r-mod'] }))), Tier.MEMBER, 'roles do not leak across guilds');
  assert.equal(permissions.tierOf({ guildId: null, user: { id: '42' }, member: null }), Tier.OWNER);
  assert.equal(permissions.tierOf({ guildId: null, user: { id: '7' }, member: null }), Tier.MEMBER);
});
