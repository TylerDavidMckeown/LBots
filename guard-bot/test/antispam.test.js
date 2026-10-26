import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANTISPAM_DEFAULTS, countEmoji, createSpamDetector, escalationStep, inviteCodes, isExcessiveCaps, parseAllowedInvites,
} from '../src/services/spamDetector.js';
import { createAntispamStore } from '../src/services/stores.js';
import { guardDb } from './helpers.js';

const settings = Object.fromEntries(Object.entries(ANTISPAM_DEFAULTS).map(([k, v]) => [k.replace('antispam.', ''), v]));

function feeder(detector = createSpamDetector()) {
  let n = 0;
  return (content, { at, userId = 'u1', mentionCount = 0, overrides = {} } = {}) => {
    n += 1;
    return detector.check({ guildId: 'g', userId, channelId: 'c', messageId: `m${n}`, content, mentionCount, at }, { ...settings, ...overrides });
  };
}

test('defaults match the specification', () => {
  assert.equal(settings.rateCount, 5);
  assert.equal(settings.rateSeconds, 5);
  assert.equal(settings.duplicateCount, 3);
  assert.equal(settings.duplicateSeconds, 30);
  assert.equal(settings.mentionLimit, 5);
  assert.equal(settings.invites, true);
  assert.equal(settings.caps, false);
  assert.equal(settings.emoji, false);
});

test('five messages in five seconds is a burst; four is not', () => {
  const send = feeder();
  for (let i = 0; i < 4; i += 1) assert.equal(send(`message ${i}`, { at: i * 1000 }), null);
  const result = send('message 5', { at: 4000 });
  assert.equal(result.rule, 'rate');
  assert.equal(result.messages.length, 5, 'the whole burst is reported for deletion');
});

test('messages spread over the window do not trigger the rate rule', () => {
  const send = feeder();
  for (let i = 0; i < 10; i += 1) assert.equal(send(`message ${i}`, { at: i * 1500 }), null);
});

test('three identical messages in 30 seconds are duplicates, ignoring case and spacing', () => {
  const send = feeder();
  assert.equal(send('Buy now', { at: 0 }), null);
  assert.equal(send('buy   NOW', { at: 10_000 }), null);
  assert.equal(send('buy now', { at: 20_000 }).rule, 'duplicate');
  const late = feeder();
  late('hi', { at: 0 });
  late('hi', { at: 20_000 });
  assert.equal(late('hi', { at: 31_000 }), null, 'the first copy fell out of the window');
});

test('mention, invite, caps and emoji rules', () => {
  const send = feeder();
  assert.equal(send('hi all', { at: 0, mentionCount: 5 }).rule, 'mentions');
  assert.equal(send('join discord.gg/abc123', { at: 10_000 }).rule, 'invite');
  assert.equal(send('join discord.gg/ours', { at: 20_000, overrides: { allowedInvites: 'ours, https://discord.gg/partner' } }), null);
  assert.equal(send('join discord.gg/partner', { at: 30_000, overrides: { allowedInvites: 'ours, https://discord.gg/partner' } }), null);
  assert.equal(send('discord.com/invite/x', { at: 40_000, overrides: { invites: false } }), null);
  assert.equal(send('THIS IS VERY LOUD TEXT INDEED', { at: 50_000 }), null, 'caps detection is off by default');
  assert.equal(send('THIS IS VERY LOUD TEXT INDEED', { at: 60_000, overrides: { caps: true } }).rule, 'caps');
  assert.equal(send('🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉', { at: 70_000, overrides: { emoji: true } }).rule, 'emoji');
});

test('members are tracked separately and reset clears a burst', () => {
  const detector = createSpamDetector();
  const send = feeder(detector);
  for (let i = 0; i < 4; i += 1) send(`a${i}`, { at: i * 100 });
  assert.equal(send('other member', { at: 450, userId: 'u2' }), null);
  detector.reset('g', 'u1');
  assert.equal(send('after reset', { at: 500 }), null);
});

test('helper rules', () => {
  assert.deepEqual(inviteCodes('a discord.gg/One and https://discord.com/invite/two-2'), ['One', 'two-2']);
  assert.deepEqual(parseAllowedInvites('none'), []);
  assert.deepEqual(parseAllowedInvites('abc, https://discord.gg/def'), ['abc', 'def']);
  assert.equal(isExcessiveCaps('OK'), false, 'short messages are ignored');
  assert.equal(isExcessiveCaps('Hello there, General Kenobi'), false);
  assert.equal(countEmoji('hi <:wave:123456789012345678> 👋 <a:spin:1>'), 3);
});

test('escalation: notice, then warning with 5-minute timeout, then 1-hour timeouts', () => {
  assert.deepEqual(escalationStep(1), { kind: 'notice' });
  assert.deepEqual(escalationStep(2), { kind: 'warn-timeout', timeoutMs: 300_000 });
  assert.deepEqual(escalationStep(3), { kind: 'timeout', timeoutMs: 3_600_000 });
  assert.deepEqual(escalationStep(9), { kind: 'timeout', timeoutMs: 3_600_000 });
});

test('offences are counted within the window and persisted', () => {
  const store = createAntispamStore(guardDb());
  const windowMs = 600_000;
  assert.equal(store.recordOffence({ guildId: 'g', userId: 'u', rule: 'rate', channelId: 'c', now: 0, windowMs }), 1);
  assert.equal(store.recordOffence({ guildId: 'g', userId: 'u', rule: 'invite', channelId: 'c', now: 200_000, windowMs }), 2);
  assert.equal(store.recordOffence({ guildId: 'g', userId: 'u', rule: 'rate', channelId: 'c', now: 700_000, windowMs }), 2, 'the first offence aged out');
  assert.equal(store.recordOffence({ guildId: 'g', userId: 'other', rule: 'rate', channelId: 'c', now: 700_000, windowMs }), 1);
  assert.deepEqual(store.offenceSummary('g', 0).map((r) => r.rule).sort(), ['invite', 'rate']);
  assert.equal(store.prune(650_000), 2);
});

test('whitelist matches roles and channels', () => {
  const store = createAntispamStore(guardDb());
  assert.equal(store.whitelist('g', 'role', 'r1', 'admin'), true);
  assert.equal(store.whitelist('g', 'role', 'r1', 'admin'), false);
  store.whitelist('g', 'channel', 'c1', 'admin');
  assert.equal(store.isWhitelisted('g', { roleIds: ['r9', 'r1'] }), true);
  assert.equal(store.isWhitelisted('g', { channelIds: ['c1'] }), true);
  assert.equal(store.isWhitelisted('g', { channelIds: ['r1'] }), false, 'kinds are not mixed');
  assert.equal(store.isWhitelisted('other', { roleIds: ['r1'] }), false);
  assert.equal(store.unwhitelist('g', 'role', 'r1'), true);
});
