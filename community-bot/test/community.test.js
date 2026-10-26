import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { DateTime } from 'luxon';
import { UserError } from '@lyss/shared/errorReporter.js';
import { isValidEmoji, panelPayload } from '../src/features/autoroles.js';
import {
  ageOn, celebratesOn, isValidBirthday, nextOccurrence,
} from '../src/features/birthdays.js';
import { formatFields, parseFields, specFromEmbed } from '../src/features/embedBuilder.js';
import { shuffle } from '../src/features/giveaways.js';
import { pollPayload } from '../src/features/polls.js';
import { matchesEmoji } from '../src/features/starboard.js';
import { renderWelcome } from '../src/features/welcome.js';
import {
  createAutoroleStore, createBirthdayStore, createEmbedStore, createGiveawayStore, createPollStore, createSuggestionStore, MAX_AUTOROLES,
} from '../src/services/communityStores.js';
import { roleProblem } from '../src/services/roles.js';
import { communityDb, fakeCtx } from './helpers.js';

const G = 'guild';

test('roles with moderation permissions, staff roles and high roles are never handed out', () => {
  const context = { guildId: G, botPosition: 10, protectedRoleIds: ['staff-role'] };
  const role = (overrides) => ({ id: 'r', managed: false, position: 5, permissions: 0n, ...overrides });
  assert.equal(roleProblem(role(), context), null);
  assert.match(roleProblem(role({ id: G }), context), /@everyone/);
  assert.match(roleProblem(role({ managed: true }), context), /integration/);
  assert.match(roleProblem(role({ id: 'staff-role' }), context), /staff/);
  assert.match(roleProblem(role({ permissions: PermissionFlagsBits.Administrator }), context), /Administrator/);
  assert.match(roleProblem(role({ permissions: PermissionFlagsBits.ManageMessages | PermissionFlagsBits.SendMessages }), context), /ManageMessages/);
  assert.equal(roleProblem(role({ permissions: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles }), context), null);
  assert.match(roleProblem(role({ position: 10 }), context), /above my highest role/);
});

test('autoroles: limit, update and panel layout', () => {
  const store = createAutoroleStore(communityDb());
  for (let i = 0; i < MAX_AUTOROLES; i += 1) store.add({ guildId: G, roleId: `r${i}`, label: `Role ${i}`, addedBy: 'a' });
  assert.throws(() => store.add({ guildId: G, roleId: 'extra', label: 'x', addedBy: 'a' }), UserError);
  assert.equal(store.add({ guildId: G, roleId: 'r1', label: 'Renamed', addedBy: 'a' }).updated, true);

  const ctx = fakeCtx();
  const roles = (n) => Array.from({ length: n }, (_, i) => ({ role_id: `r${i}`, label: `Role ${i}`, emoji: i === 0 ? '🎮' : null }));
  const small = panelPayload(ctx, G, roles(7)).components.map((row) => row.toJSON());
  assert.equal(small.length, 2, '7 buttons fit in two rows');
  assert.equal(small[0].components[0].custom_id, 'community:autorole:toggle:r0');
  const large = panelPayload(ctx, G, roles(15)).components[0].toJSON();
  assert.equal(large.components[0].custom_id, 'community:autorole:select');
  assert.equal(large.components[0].options.length, 15);
  assert.ok(isValidEmoji('🎮') && isValidEmoji('<:lyss:123456789012345678>') && isValidEmoji('👍🏽'));
  assert.ok(!isValidEmoji('hello') && !isValidEmoji('🎮🎮 text'));
});

test('suggestions: numbering, one vote per member, toggling and closing', () => {
  const store = createSuggestionStore(communityDb());
  const s = store.create({ guildId: G, authorId: 'author', content: 'Add a music channel' });
  assert.equal(store.create({ guildId: G, authorId: 'x', content: 'Two' }).number, 2);
  assert.deepEqual(store.vote(s.id, 'u1', 1), { up: 1, down: 0, current: 1 });
  assert.deepEqual(store.vote(s.id, 'u1', -1), { up: 0, down: 1, current: -1 }, 'switching moves the vote');
  assert.deepEqual(store.vote(s.id, 'u1', -1), { up: 0, down: 0, current: 0 }, 'voting again removes it');
  store.vote(s.id, 'u2', 1);
  store.respond(s.id, 'considered', 'staff', 'Looking into it');
  store.vote(s.id, 'u3', 1);
  store.respond(s.id, 'approved', 'staff');
  assert.throws(() => store.vote(s.id, 'u4', 1), /closed/);
  assert.equal(store.remove(s.id, 'author'), false, 'only pending suggestions can be deleted');
  const pending = store.get(2);
  assert.equal(store.remove(pending.id, 'not-author'), false);
  assert.equal(store.remove(pending.id, 'x'), true);
  assert.throws(() => store.respond(pending.id, 'approved', 'staff'), /deleted/);
});

test('giveaways: entries toggle, end exactly once, no entries after the end', () => {
  const store = createGiveawayStore(communityDb());
  const now = Date.now();
  const g = store.create({ guildId: G, channelId: 'c', hostId: 'h', prize: 'Nitro', winnerCount: 1, endsAt: now + 60_000 });
  assert.deepEqual(store.toggleEntry(g.id, 'a', now), { entered: true, count: 1 });
  store.toggleEntry(g.id, 'b', now);
  assert.deepEqual(store.toggleEntry(g.id, 'a', now), { entered: false, count: 1 });
  assert.equal(store.finish(g.id, ['b']), true);
  assert.equal(store.finish(g.id, ['x']), false, 'a second end is ignored');
  assert.deepEqual(store.get(g.id).winners, ['b']);
  assert.throws(() => store.toggleEntry(g.id, 'c', now), /ended/);
  assert.equal(store.cancel(g.id), false);
  const late = store.create({ guildId: G, channelId: 'c', hostId: 'h', prize: 'x', winnerCount: 1, endsAt: now - 1 });
  assert.throws(() => store.toggleEntry(late.id, 'a', now), /ended/, 'expired by time even before the job runs');
});

test('shuffle is a permutation', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual([...shuffle(items)].sort((a, b) => a - b), items);
  assert.deepEqual(shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});

test('polls: single choice moves votes, multiple choice toggles, closed polls reject votes', () => {
  const ctx = fakeCtx();
  const store = createPollStore(ctx.db);
  assert.throws(() => store.create({ guildId: G, channelId: 'c', authorId: 'a', question: 'Q', options: ['Yes'] }), /2 to 10/);
  assert.throws(() => store.create({ guildId: G, channelId: 'c', authorId: 'a', question: 'Q', options: ['Yes', 'yes'] }), /different/);
  const single = store.create({ guildId: G, channelId: 'c', authorId: 'a', question: 'Pizza?', options: ['Yes', 'No', 'Maybe'] });
  assert.deepEqual(store.vote(single.id, 'u1', 0), [0]);
  assert.deepEqual(store.vote(single.id, 'u1', 2), [2]);
  assert.deepEqual(store.vote(single.id, 'u1', 2), []);
  store.vote(single.id, 'u1', 1);
  store.vote(single.id, 'u2', 1);
  assert.deepEqual(store.results(single.id), { counts: [0, 2, 0], voters: 2, totalVotes: 2 });
  assert.throws(() => store.vote(single.id, 'u1', 7), /does not exist/);

  const multi = store.create({ guildId: G, channelId: 'c', authorId: 'a', question: 'Games?', options: ['A', 'B', 'C'], multiple: true, anonymous: true });
  store.vote(multi.id, 'u1', 0);
  assert.deepEqual(store.vote(multi.id, 'u1', 2), [0, 2]);
  assert.equal(pollPayload(ctx, store.get(multi.id), store.results(multi.id)).components.length, 1, 'anonymous polls have no voters button');
  assert.equal(pollPayload(ctx, store.get(single.id), store.results(single.id)).components.length, 2);

  assert.equal(store.close(single.id), true);
  assert.equal(store.close(single.id), false);
  assert.throws(() => store.vote(single.id, 'u3', 0), /closed/);
  const final = pollPayload(ctx, store.get(single.id), store.results(single.id));
  assert.equal(final.components.length, 0);
  assert.match(final.embeds[0].data.description, /No 🏆/);
});

test('birthdays: validation, leap days, age privacy and once-per-day announcements', () => {
  assert.equal(isValidBirthday(2, 29), true, '29 Feb without a year');
  assert.equal(isValidBirthday(2, 29, 2001), false);
  assert.equal(isValidBirthday(4, 31), false);
  assert.equal(isValidBirthday(1, 1, 2999), false, 'no future years');
  assert.equal(celebratesOn({ month: 2, day: 29 }, 2, 28, false), true);
  assert.equal(celebratesOn({ month: 2, day: 29 }, 2, 28, true), false);

  const from = DateTime.fromISO('2026-10-23T10:00', { zone: 'Europe/London' });
  assert.equal(nextOccurrence({ month: 10, day: 23 }, from).toISODate(), '2026-10-23', 'today counts');
  assert.equal(nextOccurrence({ month: 1, day: 5 }, from).toISODate(), '2027-01-05');
  assert.equal(nextOccurrence({ month: 2, day: 29 }, from).toISODate(), '2027-02-28');
  assert.equal(ageOn({ month: 10, day: 24, year: 2000 }, from), 25);
  assert.equal(ageOn({ month: 10, day: 23, year: 2000 }, from), 26);
  assert.equal(ageOn({ month: 10, day: 23 }, from), null, 'no year, no age');

  const store = createBirthdayStore(communityDb());
  assert.equal(store.claimAnnouncement(G, '2026-10-23'), true);
  assert.equal(store.claimAnnouncement(G, '2026-10-23'), false, 'a restart cannot announce the same day twice');
  store.markPosted(G, '2026-10-23');
  assert.ok(store.announcement(G, '2026-10-23').posted_at);
});

test('embed builder: field parsing round-trips and drafts are owner-only', () => {
  const fields = parseFields('Rules | Be kind | inline\nLinks | lyss.gg');
  assert.deepEqual(fields, [{ name: 'Rules', value: 'Be kind', inline: true }, { name: 'Links', value: 'lyss.gg', inline: false }]);
  assert.deepEqual(parseFields(formatFields(fields)), fields);
  const spec = specFromEmbed({ data: { title: 'Hi', color: 0xc084fc, footer: { text: 'f' }, image: { url: 'https://x/y.png' }, fields: [] } });
  assert.equal(spec.color, '#c084fc');
  assert.equal(spec.image, 'https://x/y.png');

  const store = createEmbedStore(communityDb());
  store.saveDraft({ id: 'd1', guildId: G, userId: 'u1', data: { title: 'x' }, now: 1_000 });
  assert.equal(store.draft('d1', 'u2', 2_000), null, 'other members cannot use a draft');
  assert.equal(store.draft('d1', 'u1', 2_000).data.title, 'x');
  assert.equal(store.draft('d1', 'u1', 1_000 + 3_600_001), null, 'drafts expire after an hour');
  store.saveTemplate(G, 'rules', { title: 'Rules' }, 'u1');
  assert.equal(store.template(G, 'rules').data.title, 'Rules');
});

test('starboard emoji matching and welcome templates', () => {
  assert.equal(matchesEmoji({ id: null, name: '⭐' }, '⭐'), true);
  assert.equal(matchesEmoji({ id: null, name: '⭐️' }, '⭐'), true, 'variation selectors are ignored');
  assert.equal(matchesEmoji({ id: '123', name: 'star' }, '<:star:123>'), true);
  assert.equal(matchesEmoji({ id: '999', name: 'star' }, '<:star:123>'), false);
  assert.equal(matchesEmoji({ id: null, name: '🔥' }, '⭐'), false);
  assert.equal(renderWelcome('Hi {user}, welcome to {server} (#{count}) {unknown}', { user: '@a', username: 'a', server: 'Lyss', count: '10' }), 'Hi @a, welcome to Lyss (#10) {unknown}');
});
