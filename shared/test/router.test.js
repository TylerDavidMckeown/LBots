import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlashCommandBuilder } from 'discord.js';
import { DEFAULT_BRAND } from '../src/botConfig.js';
import { createEmbedStyle } from '../src/embedStyle.js';
import { UserError } from '../src/errorReporter.js';
import { Tier } from '../src/permissions.js';
import { createRouter, makeCustomId, parseCustomId } from '../src/router.js';

function fakeInteraction({ kind = 'command', commandName = 'ping', customId, sub = null, guildId = 'g1', userId = 'u1' } = {}) {
  return {
    replies: [],
    commandName,
    customId,
    guildId,
    channelId: 'c1',
    user: { id: userId },
    member: {},
    deferred: false,
    replied: false,
    isAutocomplete: () => kind === 'autocomplete',
    isCommand: () => kind === 'command',
    isChatInputCommand: () => kind === 'command',
    isMessageComponent: () => kind === 'component',
    isModalSubmit: () => false,
    inGuild: () => Boolean(guildId),
    options: { getSubcommand: () => sub, getSubcommandGroup: () => null },
    async reply(payload) { this.replied = true; this.replies.push(payload); },
    async followUp(payload) { this.replies.push(payload); },
    async editReply(payload) { this.replies.push(payload); },
    async respond(choices) { this.replies.push({ choices }); },
  };
}

function setup({ tier = Tier.MEMBER } = {}) {
  const reports = [];
  const calls = [];
  const command = (name, extra = {}) => ({
    data: new SlashCommandBuilder().setName(name).setDescription('test'),
    cooldown: 0,
    execute: async () => calls.push(name),
    ...extra,
  });
  const commands = new Map([
    ['ping', command('ping')],
    ['admin', command('admin', { tier: 'admin' })],
    ['mixed', command('mixed', { subcommandTiers: { reset: 'admin' } })],
    ['slow', command('slow', { cooldown: 60 })],
    ['oops', command('oops', { execute: async () => { throw new Error('database exploded'); } })],
    ['nope', command('nope', { execute: async () => { throw new UserError('You need at least 500 LC.', { title: 'Insufficient funds' }); } })],
  ]);
  const components = new Map([
    ['pet:feed', { id: 'pet:feed', execute: async (interaction, ctx, args) => calls.push(['pet:feed', args]) }],
  ]);
  const ctx = {
    config: { namespace: 'community' },
    commands,
    components,
    permissions: { tierOf: () => tier },
    embeds: createEmbedStyle({ brand: DEFAULT_BRAND }),
    errors: { report: async (error, context) => { reports.push({ error, context }); return 'LYS-TEST1'; } },
  };
  return { router: createRouter(ctx), calls, reports };
}

const embedOf = (interaction) => interaction.replies.at(-1)?.embeds?.[0]?.data;

test('custom IDs round-trip and enforce the length limit', () => {
  const id = makeCustomId('community', 'pet', 'feed', 42);
  assert.equal(id, 'community:pet:feed:42');
  assert.deepEqual(parseCustomId(id), { namespace: 'community', feature: 'pet', action: 'feed', args: ['42'], key: 'pet:feed' });
  assert.equal(parseCustomId('garbage'), null);
  assert.throws(() => makeCustomId('community', 'x', 'y', 'z'.repeat(100)), /too long/);
});

test('dispatches an allowed command', async () => {
  const { router, calls } = setup();
  await router.handle(fakeInteraction({ commandName: 'ping' }));
  assert.deepEqual(calls, ['ping']);
});

test('denies commands above the member tier without running them', async () => {
  const { router, calls } = setup({ tier: Tier.MEMBER });
  const interaction = fakeInteraction({ commandName: 'admin' });
  await router.handle(interaction);
  assert.deepEqual(calls, []);
  assert.match(embedOf(interaction).title, /Missing permission/);
  assert.match(embedOf(interaction).description, /Admin/);
});

test('applies per-subcommand tiers', async () => {
  const { router, calls } = setup({ tier: Tier.MEMBER });
  await router.handle(fakeInteraction({ commandName: 'mixed', sub: 'view' }));
  const denied = fakeInteraction({ commandName: 'mixed', sub: 'reset' });
  await router.handle(denied);
  assert.deepEqual(calls, ['mixed']);
  assert.match(embedOf(denied).title, /Missing permission/);
});

test('enforces cooldowns per user', async () => {
  const { router, calls } = setup();
  await router.handle(fakeInteraction({ commandName: 'slow' }));
  const second = fakeInteraction({ commandName: 'slow' });
  await router.handle(second);
  await router.handle(fakeInteraction({ commandName: 'slow', userId: 'u2' }));
  assert.deepEqual(calls, ['slow', 'slow']);
  assert.match(embedOf(second).title, /Slow down/);
});

test('rejects guild-only commands in DMs', async () => {
  const { router, calls } = setup();
  const interaction = fakeInteraction({ commandName: 'ping', guildId: null });
  await router.handle(interaction);
  assert.deepEqual(calls, []);
  assert.match(embedOf(interaction).title, /Server only/);
});

test('unexpected errors show only a reference ID and are reported', async () => {
  const { router, reports } = setup();
  const interaction = fakeInteraction({ commandName: 'oops' });
  await router.handle(interaction);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].context.source, 'command:/oops');
  assert.match(embedOf(interaction).description, /Reference: `LYS-TEST1`/);
  assert.doesNotMatch(embedOf(interaction).description, /database exploded/);
});

test('UserErrors are shown to the user and not reported', async () => {
  const { router, reports } = setup();
  const interaction = fakeInteraction({ commandName: 'nope' });
  await router.handle(interaction);
  assert.equal(reports.length, 0);
  assert.match(embedOf(interaction).title, /Insufficient funds/);
  assert.equal(embedOf(interaction).description, 'You need at least 500 LC.');
});

test('denials are ephemeral', async () => {
  const { router } = setup();
  const interaction = fakeInteraction({ commandName: 'admin' });
  await router.handle(interaction);
  assert.equal(interaction.replies[0].flags & 64, 64);
});

test('routes components with their arguments', async () => {
  const { router, calls } = setup();
  await router.handle(fakeInteraction({ kind: 'component', customId: 'community:pet:feed:42' }));
  assert.deepEqual(calls, [['pet:feed', ['42']]]);
});

test('unknown components show a friendly expiry message', async () => {
  const { router, calls } = setup();
  const interaction = fakeInteraction({ kind: 'component', customId: 'community:trade:accept:9' });
  await router.handle(interaction);
  assert.deepEqual(calls, []);
  assert.match(embedOf(interaction).title, /expired/);
});

test('components from another namespace are ignored', async () => {
  const { router, calls } = setup();
  const interaction = fakeInteraction({ kind: 'component', customId: 'tickets:pet:feed:42' });
  await router.handle(interaction);
  assert.deepEqual(calls, []);
  assert.equal(interaction.replies.length, 0);
});

test('rate-limits rapid component clicks', async () => {
  const { router, calls } = setup();
  for (let i = 0; i < 10; i += 1) {
    await router.handle(fakeInteraction({ kind: 'component', customId: 'community:pet:feed:1' }));
  }
  assert.equal(calls.length, 8);
});
