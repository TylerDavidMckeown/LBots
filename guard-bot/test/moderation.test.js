import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { parseSlowmode } from '../src/commands/channels.js';
import { caseEmbed, caseLine } from '../src/embeds/caseEmbeds.js';
import { createCaseService, escalationFor, parseEscalation } from '../src/services/caseService.js';
import { diffChannel, diffRole } from '../src/services/diff.js';
import { checkHierarchy } from '../src/services/hierarchy.js';
import { isIgnoredChannel, logChannelId } from '../src/services/logService.js';
import { createMessageCache } from '../src/services/stores.js';
import { fakeCtx, guardDb } from './helpers.js';

const G = 'guild-1';
const HOUR = 3_600_000;
const DAY = 86_400_000;

test('case numbers increase per guild and carry metadata', () => {
  const cases = createCaseService(guardDb());
  const a = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm1', reason: 'Spam' });
  const b = cases.create({ guildId: G, action: 'purge', channelId: 'c1', moderatorId: 'm1', metadata: { count: 12 } });
  const c = cases.create({ guildId: 'guild-2', action: 'kick', targetId: 'u1', moderatorId: 'm1' });
  assert.deepEqual([a.number, b.number, c.number], [1, 2, 1]);
  assert.deepEqual(cases.get(G, 2).metadata, { count: 12 });
  assert.equal(cases.get(G, 3), undefined);
});

test('the database rejects unknown actions', () => {
  const cases = createCaseService(guardDb());
  assert.throws(() => cases.create({ guildId: G, action: 'nuke', moderatorId: 'm1' }), /CHECK constraint/);
});

test('active warnings exclude expired and removed warnings', () => {
  const cases = createCaseService(guardDb());
  const now = 1_000_000_000;
  cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm', expiresAt: now - 1, now: now - DAY });
  const active = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm', expiresAt: now + DAY, now });
  const removed = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm', expiresAt: now + DAY, now });
  cases.create({ guildId: G, action: 'kick', targetId: 'u1', moderatorId: 'm', now });
  cases.revokeWarning(G, removed.number, { by: 'm2', reason: 'Mistake', now });

  assert.deepEqual(cases.activeWarnings(G, 'u1', now).map((w) => w.number), [active.number]);
  assert.equal(cases.warnings(G, 'u1').length, 3);
  assert.equal(cases.countForTarget(G, 'u1'), 4);
});

test('only warnings can be removed, and only once', () => {
  const cases = createCaseService(guardDb());
  const w = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm' });
  const k = cases.create({ guildId: G, action: 'kick', targetId: 'u1', moderatorId: 'm' });
  assert.throws(() => cases.revokeWarning(G, k.number, { by: 'm' }), /not a warning/);
  assert.throws(() => cases.revokeWarning(G, 99, { by: 'm' }), /does not exist/);
  cases.revokeWarning(G, w.number, { by: 'm' });
  assert.throws(() => cases.revokeWarning(G, w.number, { by: 'm' }), (e) => e instanceof UserError && /already removed/.test(e.message));
});

test('latestBanCase finds the newest ban decision', () => {
  const cases = createCaseService(guardDb());
  const temp = cases.create({ guildId: G, action: 'tempban', targetId: 'u1', moderatorId: 'm' });
  assert.equal(cases.latestBanCase(G, 'u1').id, temp.id);
  const perm = cases.create({ guildId: G, action: 'ban', targetId: 'u1', moderatorId: 'm' });
  cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm' });
  assert.equal(cases.latestBanCase(G, 'u1').id, perm.id, 'a newer ban supersedes the tempban');
});

test('reasons can be updated and notes are scoped to the guild', () => {
  const cases = createCaseService(guardDb());
  const c = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm', reason: 'old' });
  assert.equal(cases.updateReason(G, c.number, 'new').reason, 'new');
  const note = cases.addNote(G, 'u1', 'm', 'Watch this member');
  assert.equal(cases.notes(G, 'u1').length, 1);
  assert.equal(cases.removeNote('guild-2', note.id), false);
  assert.equal(cases.removeNote(G, note.id), true);
});

test('escalation rules parse and fire exactly at their thresholds', () => {
  assert.deepEqual(parseEscalation('3:1h, 5:24h'), [{ count: 3, durationMs: HOUR }, { count: 5, durationMs: 24 * HOUR }]);
  assert.deepEqual(parseEscalation('5:1d,3:30m'), [{ count: 3, durationMs: 30 * 60_000 }, { count: 5, durationMs: DAY }]);
  assert.deepEqual(parseEscalation('off'), []);
  for (const bad of ['3', '3:forever', '3:1h,3:2h', '0:1h', '3:30s', '3:29d', 'three:1h']) assert.equal(parseEscalation(bad), null, bad);

  const rules = parseEscalation('3:1h, 5:24h');
  assert.equal(escalationFor(rules, 2), null);
  assert.equal(escalationFor(rules, 3).durationMs, HOUR);
  assert.equal(escalationFor(rules, 4), null, 'the 3-warning rule does not fire again at 4');
  assert.equal(escalationFor(rules, 5).durationMs, 24 * HOUR);
});

test('hierarchy protects self, the bot, the owner, protected owners and higher roles', () => {
  const base = { actorId: 'mod', actorPosition: 10, targetId: 'u', targetPosition: 5, guildOwnerId: 'owner', botId: 'bot', botPosition: 20, protectedIds: ['lyss'] };
  assert.equal(checkHierarchy(base), null);
  assert.match(checkHierarchy({ ...base, targetId: 'mod' }), /yourself/);
  assert.match(checkHierarchy({ ...base, targetId: 'bot' }), /myself/);
  assert.match(checkHierarchy({ ...base, targetId: 'owner' }), /server owner/);
  assert.match(checkHierarchy({ ...base, targetId: 'lyss' }), /protected/);
  assert.equal(checkHierarchy({ ...base, targetId: 'lyss', actorIsOwner: true }), null);
  assert.match(checkHierarchy({ ...base, targetPosition: 10 }), /below yours/, 'equal roles cannot moderate each other');
  assert.equal(checkHierarchy({ ...base, targetPosition: 15, actorIsOwner: true }), null);
  assert.match(checkHierarchy({ ...base, actorPosition: 30, targetPosition: 20 }), /above mine/);
  assert.equal(checkHierarchy({ ...base, targetPosition: null }), null, 'users outside the server can be banned');
});

test('slowmode accepts off and durations up to 6 hours', () => {
  assert.equal(parseSlowmode('off'), 0);
  assert.equal(parseSlowmode('0'), 0);
  assert.equal(parseSlowmode('30'), 30);
  assert.equal(parseSlowmode('5m'), 300);
  assert.equal(parseSlowmode('6h'), 21_600);
  for (const bad of ['7h', 'soon', '-1']) assert.equal(parseSlowmode(bad), null, bad);
});

test('log routing: category channel, shared fallback, disabled categories and ignored channels', () => {
  const ctx = fakeCtx();
  assert.equal(logChannelId(ctx, G, 'message'), null);
  ctx.guildConfig.set(G, 'channel.sharedLog', 'shared');
  assert.equal(logChannelId(ctx, G, 'message'), 'shared');
  ctx.guildConfig.set(G, 'channel.messageLog', 'messages');
  assert.equal(logChannelId(ctx, G, 'message'), 'messages');
  assert.equal(logChannelId(ctx, G, 'member'), 'shared');
  ctx.guildConfig.set(G, 'logs.member', false);
  assert.equal(logChannelId(ctx, G, 'member'), null);

  ctx.guildConfig.set(G, 'logs.ignoredChannels', ['staff-chat']);
  assert.equal(isIgnoredChannel(ctx, G, 'general'), false);
  assert.equal(isIgnoredChannel(ctx, G, 'staff-chat'), true);
  assert.equal(isIgnoredChannel(ctx, G, 'messages'), true, 'log channels never log themselves');
  assert.equal(isIgnoredChannel(ctx, G, 'thread', 'staff-chat'), true, 'threads inherit from their parent');
});

test('message cache stores, edits, prunes and removes', () => {
  const cache = createMessageCache(guardDb());
  cache.add({ messageId: 'm1', guildId: G, channelId: 'c', authorId: 'u', content: 'hello', attachments: [{ name: 'a.png', url: 'https://x' }], createdAt: 100 });
  cache.add({ messageId: 'm2', guildId: G, channelId: 'c', authorId: 'u', content: 'second', createdAt: 200 });
  assert.equal(cache.get('m1').attachments[0].name, 'a.png');
  assert.equal(cache.edit('m1', 'edited', 150), true);
  assert.equal(cache.get('m1').content, 'edited');
  assert.deepEqual(cache.getMany(['m2', 'm1', 'missing']).map((r) => r.message_id), ['m1', 'm2']);
  assert.equal(cache.prune(G, 150), 1);
  cache.removeMany(['m2']);
  assert.equal(cache.get('m2'), undefined);
});

test('channel and role diffs describe meaningful changes only', () => {
  const channel = { name: 'general', topic: null, nsfw: false, rateLimitPerUser: 0, parentId: 'cat', permissionOverwrites: new Map() };
  assert.deepEqual(diffChannel(channel, { ...channel }), []);
  const changed = diffChannel(channel, { ...channel, name: 'chat', rateLimitPerUser: 10, permissionOverwrites: new Map([['r', { id: 'r', allow: 1n, deny: 0n }]]) });
  assert.equal(changed.length, 3);
  assert.match(changed[0], /general.*chat/);

  const role = { name: 'Mods', color: 0xff0000, hoist: false, mentionable: false, permissions: PermissionFlagsBits.KickMembers };
  assert.deepEqual(diffRole(role, { ...role }), []);
  const roleChanges = diffRole(role, { ...role, color: 0x00ff00, permissions: PermissionFlagsBits.BanMembers });
  assert.deepEqual(roleChanges, ['Colour: #FF0000 → #00FF00', 'Permissions added: BanMembers', 'Permissions removed: KickMembers']);
});

test('case embeds and history lines show the important details', () => {
  const ctx = fakeCtx();
  const cases = createCaseService(ctx.db);
  const c = cases.create({ guildId: G, action: 'tempban', targetId: 'u1', moderatorId: 'm1', reason: 'Raiding', durationMs: DAY, expiresAt: Date.now() + DAY });
  const data = caseEmbed(ctx, c).toJSON();
  assert.match(data.title, /Case #1 · Temporary ban/);
  assert.ok(data.fields.some((f) => f.name === 'Duration' && f.value === '1d'));
  assert.ok(data.fields.some((f) => f.name === 'Reason' && f.value === 'Raiding'));
  const w = cases.create({ guildId: G, action: 'warn', targetId: 'u1', moderatorId: 'm1', expiresAt: 1 });
  assert.match(caseLine(w), /expired/);
});
