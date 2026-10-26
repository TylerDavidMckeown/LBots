import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { healthCheck } from './db.js';
import { isHexColour, isHttpUrl } from './embedBuilder/validators.js';
import { UserError } from './errorReporter.js';
import { formatDuration, isValidTimezone, parseDuration } from './utils/time.js';
import { plural, truncate } from './utils/text.js';

export const SETTING_TYPES = ['channel', 'category', 'role', 'timezone', 'colour', 'boolean', 'integer', 'duration', 'text', 'url'];

const MESSAGE_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const CATEGORY_CHANNEL_LIMIT = 50;

/** Settings every bot shares. Bots append their own via `setup` in config.js. */
export const BASE_SETUP_ITEMS = Object.freeze([
  { key: 'channel.errorLog', type: 'channel', section: 'General', label: 'Error log channel', description: 'Receives sanitised error reports.', permissions: MESSAGE_PERMISSIONS },
  { key: 'timezone', type: 'timezone', section: 'General', label: 'Server timezone', description: 'IANA name, e.g. Europe/London.' },
  { key: 'role.admin', type: 'role', section: 'Permissions', label: 'Admin role', description: 'Grants the Admin tier.' },
  { key: 'role.moderator', type: 'role', section: 'Permissions', label: 'Moderator role', description: 'Grants the Moderator tier.' },
  { key: 'role.staff', type: 'role', section: 'Permissions', label: 'Staff role', description: 'Grants the Staff tier.' },
  { key: 'role.restricted', type: 'role', section: 'Permissions', label: 'Restricted role', description: 'Members with this role get limited access.' },
  { key: 'brand.primary', type: 'colour', section: 'Branding', label: 'Primary colour' },
  { key: 'brand.secondary', type: 'colour', section: 'Branding', label: 'Secondary colour' },
  { key: 'brand.footer', type: 'text', section: 'Branding', label: 'Embed footer', maxLength: 200 },
]);

const SUBCOMMAND_TYPES = {
  channel: ['channel', 'category'],
  role: ['role'],
  value: ['timezone', 'colour', 'boolean', 'integer', 'duration', 'text', 'url'],
  reset: SETTING_TYPES,
};

/**
 * Validates and normalises a raw string for a value-type setting.
 * @returns {{ value?: any, error?: string }}
 */
export function parseSettingValue(item, raw) {
  const text = String(raw ?? '').trim();
  switch (item.type) {
    case 'timezone':
      return isValidTimezone(text) ? { value: text } : { error: `"${text}" is not a valid timezone. Use an IANA name such as Europe/London.` };
    case 'colour':
      return isHexColour(text) ? { value: `#${text.replace('#', '').toUpperCase()}` } : { error: 'Use a hex colour such as #C084FC.' };
    case 'boolean': {
      if (/^(true|on|yes|enable|enabled)$/i.test(text)) return { value: true };
      if (/^(false|off|no|disable|disabled)$/i.test(text)) return { value: false };
      return { error: 'Use on or off.' };
    }
    case 'integer': {
      const n = Number(text);
      if (!text || !Number.isSafeInteger(n)) return { error: 'Enter a whole number.' };
      if (item.min !== undefined && n < item.min) return { error: `The minimum is ${item.min}.` };
      if (item.max !== undefined && n > item.max) return { error: `The maximum is ${item.max}.` };
      return { value: n };
    }
    case 'duration': {
      const ms = parseDuration(text);
      if (ms === null) return { error: 'Use a duration such as 30m, 2h or 1d12h.' };
      if (item.min !== undefined && ms < item.min) return { error: `The minimum is ${formatDuration(item.min)}.` };
      if (item.max !== undefined && ms > item.max) return { error: `The maximum is ${formatDuration(item.max)}.` };
      return { value: ms };
    }
    case 'url':
      return isHttpUrl(text) ? { value: text } : { error: 'Enter a full http(s) link.' };
    case 'text': {
      const max = item.maxLength ?? 200;
      if (!text) return { error: 'Enter some text.' };
      return text.length <= max ? { value: text } : { error: `Keep it to ${max} characters or fewer.` };
    }
    default:
      return { error: `${item.label} cannot be set with a text value.` };
  }
}

/** Re-validates a stored value (as opposed to raw user input). */
export function validateStoredValue(item, value) {
  if (item.type === 'duration') {
    if (!Number.isSafeInteger(value) || value <= 0) return 'Stored duration is invalid.';
    if (item.min !== undefined && value < item.min) return `The minimum is ${formatDuration(item.min)}.`;
    if (item.max !== undefined && value > item.max) return `The maximum is ${formatDuration(item.max)}.`;
    return null;
  }
  return parseSettingValue(item, String(value)).error ?? null;
}

export function formatSettingValue(item, value) {
  if (value === undefined || value === null) return null;
  switch (item.type) {
    case 'channel':
    case 'category':
      return `<#${value}>`;
    case 'role':
      return `<@&${value}>`;
    case 'boolean':
      return value ? 'On' : 'Off';
    case 'duration':
      return formatDuration(value);
    default:
      return truncate(String(value), 200);
  }
}

function findItem(config, key, allowedTypes) {
  const item = config.setupItems.find((i) => i.key === key);
  if (!item) throw new UserError(`Unknown setting \`${truncate(key, 80)}\`. Pick one from the list.`, { title: 'Unknown setting' });
  if (!allowedTypes.includes(item.type)) {
    throw new UserError(`**${item.label}** is a ${item.type} setting. Use the matching /setup subcommand.`, { title: 'Wrong setting type' });
  }
  return item;
}

function missingPermissions(channel, me, names) {
  const granted = channel.permissionsFor(me);
  return names.filter((name) => !granted?.has(PermissionFlagsBits[name]));
}

/** Groups items by section, preserving declaration order. */
function sections(items) {
  const map = new Map();
  for (const item of items) {
    const name = item.section ?? 'General';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(item);
  }
  return map;
}

function fieldsFromSections(map, renderLine) {
  const fields = [];
  for (const [name, items] of map) {
    const lines = items.map(renderLine).filter(Boolean);
    if (lines.length) fields.push({ name, value: truncate(lines.join('\n'), 1024) });
  }
  return fields.slice(0, 25);
}

/**
 * Runs every configuration check for a guild.
 * @returns {Promise<{ name: string, results: { level: 'pass' | 'warn' | 'fail', text: string }[] }[]>}
 */
export async function runSetupChecks(guild, ctx) {
  const { config, guildConfig, db } = ctx;
  const me = guild.members.me ?? await guild.members.fetchMe();
  const report = [];

  const missingBotPerms = config.requiredPermissions.filter((name) => !me.permissions.has(PermissionFlagsBits[name]));
  report.push({
    name: 'Bot permissions',
    results: missingBotPerms.length
      ? missingBotPerms.map((name) => ({ level: 'fail', text: `Missing server permission: **${name}**` }))
      : [{ level: 'pass', text: `All ${config.requiredPermissions.length} required permissions granted.` }],
  });

  const configResults = [];
  for (const item of config.setupItems) {
    if (!guildConfig.isSet(guild.id, item.key)) {
      if (item.required) configResults.push({ level: 'fail', text: `**${item.label}** is required but not set.` });
      continue;
    }
    const value = guildConfig.get(guild.id, item.key);
    if (item.type === 'channel' || item.type === 'category') {
      const channel = guild.channels.cache.get(value) ?? await guild.channels.fetch(value).catch(() => null);
      if (!channel) {
        configResults.push({ level: 'fail', text: `**${item.label}** points to a channel that no longer exists.` });
        continue;
      }
      const wantCategory = item.type === 'category';
      if (wantCategory !== (channel.type === ChannelType.GuildCategory)) {
        configResults.push({ level: 'fail', text: `**${item.label}** must be a ${wantCategory ? 'category' : 'channel'}.` });
        continue;
      }
      const needed = item.permissions ?? (wantCategory ? ['ViewChannel', 'ManageChannels'] : MESSAGE_PERMISSIONS);
      const missing = missingPermissions(channel, me, needed);
      if (missing.length) configResults.push({ level: 'fail', text: `**${item.label}** (${channel}): missing ${missing.join(', ')}.` });
      if (wantCategory) {
        const children = guild.channels.cache.filter((c) => c.parentId === channel.id).size;
        if (children >= CATEGORY_CHANNEL_LIMIT) configResults.push({ level: 'fail', text: `**${item.label}** is full (${children}/${CATEGORY_CHANNEL_LIMIT} channels).` });
        else if (children >= CATEGORY_CHANNEL_LIMIT - 5) configResults.push({ level: 'warn', text: `**${item.label}** is nearly full (${children}/${CATEGORY_CHANNEL_LIMIT} channels).` });
      }
    } else if (item.type === 'role') {
      const role = guild.roles.cache.get(value) ?? await guild.roles.fetch(value).catch(() => null);
      if (!role) {
        configResults.push({ level: 'fail', text: `**${item.label}** points to a role that no longer exists.` });
      } else if (item.manageable && (role.managed || role.position >= me.roles.highest.position)) {
        configResults.push({ level: 'fail', text: `**${item.label}** (${role}) is above my highest role or managed by an integration, so I cannot assign it.` });
      }
    } else {
      const error = validateStoredValue(item, value);
      if (error) configResults.push({ level: 'fail', text: `**${item.label}**: ${error}` });
    }
  }
  report.push({ name: 'Configuration', results: configResults.length ? configResults : [{ level: 'pass', text: 'Every configured setting is valid.' }] });

  // Only presence is reported. Secret values are never displayed.
  const envResults = [
    ...config.requiredEnv.map((name) => ({ level: process.env[name] ? 'pass' : 'fail', text: `\`${name}\` ${process.env[name] ? 'is set' : 'is missing'}` })),
    ...config.optionalEnv.map((name) => ({ level: process.env[name] ? 'pass' : 'warn', text: `\`${name}\` ${process.env[name] ? 'is set' : 'is not set (optional)'}` })),
  ];
  report.push({ name: 'Environment', results: envResults });

  const health = healthCheck(db);
  report.push({
    name: 'Database',
    results: [health.ok
      ? { level: 'pass', text: `Healthy (${health.migrations} migrations applied).` }
      : { level: 'fail', text: `Problem detected: ${truncate(health.detail, 200)}` }],
  });

  for (const check of config.checks ?? []) {
    report.push(await check(guild, ctx));
  }
  return report;
}

/** Builds the /setup command for a bot from its config.setupItems. */
export function createSetupCommand(config) {
  const settingOption = (option) => option.setName('setting').setDescription('Which setting to change').setRequired(true).setAutocomplete(true);

  const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription(`Configure ${config.name}`)
    .addSubcommand((sub) => sub.setName('view').setDescription('Show the current configuration'))
    .addSubcommand((sub) => sub.setName('check').setDescription('Verify permissions, channels, roles and configuration'))
    .addSubcommand((sub) => sub.setName('channel').setDescription('Set a channel or category setting')
      .addStringOption(settingOption)
      .addChannelOption((option) => option.setName('channel').setDescription('The channel or category').setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory)))
    .addSubcommand((sub) => sub.setName('role').setDescription('Set a role setting')
      .addStringOption(settingOption)
      .addRoleOption((option) => option.setName('role').setDescription('The role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('value').setDescription('Set a text, number, colour or timezone setting')
      .addStringOption(settingOption)
      .addStringOption((option) => option.setName('value').setDescription('The new value').setRequired(true).setMaxLength(1000)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Reset a setting to its default')
      .addStringOption(settingOption));

  async function view(interaction, ctx) {
    const kit = ctx.embeds.for(interaction.guildId);
    const icons = kit.emojis;
    const fields = fieldsFromSections(sections(config.setupItems), (item) => {
      const isSet = ctx.guildConfig.isSet(interaction.guildId, item.key);
      const shown = formatSettingValue(item, ctx.guildConfig.get(interaction.guildId, item.key));
      if (isSet) return `${icons.set} ${item.label}: ${shown}`;
      if (item.required) return `${icons.missing} ${item.label}: **not set (required)**`;
      return `${icons.unset} ${item.label}: ${shown ? `${shown} *(default)*` : '*not set*'}`;
    });
    const embed = kit.base({ title: `${config.name} configuration`, description: 'Use `/setup channel`, `/setup role` or `/setup value` to change a setting, and `/setup check` to verify everything.' })
      .addFields(fields);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  async function check(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const kit = ctx.embeds.for(interaction.guildId);
    const report = await runSetupChecks(interaction.guild, ctx);
    const symbol = { pass: '✅', warn: '⚠️', fail: '❌' };
    const all = report.flatMap((section) => section.results);
    const failures = all.filter((r) => r.level === 'fail').length;
    const warnings = all.filter((r) => r.level === 'warn').length;
    const summary = failures
      ? `Found **${plural(failures, 'problem')}** and ${plural(warnings, 'warning')}.`
      : warnings ? `No problems, ${plural(warnings, 'warning')}.` : 'Everything looks good.';
    const embed = (failures ? kit.error : warnings ? kit.warning : kit.success)('Setup check', summary)
      .addFields(report.slice(0, 25).map((section) => ({
        name: section.name,
        value: truncate(section.results.map((r) => `${symbol[r.level]} ${r.text}`).join('\n') || '—', 1024),
      })));
    return interaction.editReply({ embeds: [embed] });
  }

  async function save(interaction, ctx, item, value, note = '') {
    ctx.guildConfig.set(interaction.guildId, item.key, value, interaction.user.id);
    ctx.logger.info('Setting changed', { guildId: interaction.guildId, userId: interaction.user.id, key: item.key });
    const kit = ctx.embeds.for(interaction.guildId);
    return interaction.reply({
      embeds: [kit.success('Setting saved', `**${item.label}** is now ${formatSettingValue(item, value)}.${note}`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  async function setChannel(interaction, ctx) {
    const item = findItem(config, interaction.options.getString('setting', true), SUBCOMMAND_TYPES.channel);
    const channel = interaction.options.getChannel('channel', true);
    const isCategory = channel.type === ChannelType.GuildCategory;
    if (item.type === 'category' && !isCategory) throw new UserError(`**${item.label}** must be a category.`, { title: 'Wrong channel type' });
    if (item.type === 'channel') {
      const allowed = item.channelTypes ?? TEXT_CHANNEL_TYPES;
      if (!allowed.includes(channel.type)) throw new UserError(`**${item.label}** must be a text or announcement channel.`, { title: 'Wrong channel type' });
    }
    const resolved = interaction.guild.channels.cache.get(channel.id);
    const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
    const missing = resolved ? missingPermissions(resolved, me, item.permissions ?? (isCategory ? ['ViewChannel', 'ManageChannels'] : MESSAGE_PERMISSIONS)) : [];
    const note = missing.length ? `\n\n⚠️ I am missing **${missing.join(', ')}** there. Fix this before relying on it.` : '';
    return save(interaction, ctx, item, channel.id, note);
  }

  async function setRole(interaction, ctx) {
    const item = findItem(config, interaction.options.getString('setting', true), SUBCOMMAND_TYPES.role);
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guildId) throw new UserError('The @everyone role cannot be used here.', { title: 'Invalid role' });
    let note = '';
    if (item.manageable) {
      const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (role.managed) throw new UserError('That role is managed by an integration and cannot be assigned.', { title: 'Invalid role' });
      if (role.position >= me.roles.highest.position) note = '\n\n⚠️ This role is above my highest role, so I cannot assign it yet. Move my role higher.';
    }
    return save(interaction, ctx, item, role.id, note);
  }

  async function setValue(interaction, ctx) {
    const item = findItem(config, interaction.options.getString('setting', true), SUBCOMMAND_TYPES.value);
    const { value, error } = parseSettingValue(item, interaction.options.getString('value', true));
    if (error) throw new UserError(error, { title: 'Invalid value' });
    return save(interaction, ctx, item, value);
  }

  async function reset(interaction, ctx) {
    const item = findItem(config, interaction.options.getString('setting', true), SUBCOMMAND_TYPES.reset);
    const removed = ctx.guildConfig.unset(interaction.guildId, item.key);
    ctx.logger.info('Setting reset', { guildId: interaction.guildId, userId: interaction.user.id, key: item.key });
    const kit = ctx.embeds.for(interaction.guildId);
    const fallback = formatSettingValue(item, ctx.guildConfig.get(interaction.guildId, item.key));
    const message = removed
      ? `**${item.label}** was reset${fallback ? ` to the default (${fallback})` : ''}.`
      : `**${item.label}** was not set, so nothing changed.`;
    return interaction.reply({ embeds: [kit.success('Setting reset', message)], flags: MessageFlags.Ephemeral });
  }

  const handlers = { view, check, channel: setChannel, role: setRole, value: setValue, reset };

  return {
    data,
    category: 'General',
    tier: 'admin',
    cooldown: 2,
    async execute(interaction, ctx) {
      return handlers[interaction.options.getSubcommand()](interaction, ctx);
    },
    async autocomplete(interaction) {
      const types = SUBCOMMAND_TYPES[interaction.options.getSubcommand()] ?? [];
      const query = interaction.options.getFocused().toLowerCase();
      const choices = config.setupItems
        .filter((item) => types.includes(item.type))
        .filter((item) => !query || item.label.toLowerCase().includes(query) || item.key.toLowerCase().includes(query))
        .slice(0, 25)
        .map((item) => ({ name: truncate(`${item.section ?? 'General'} › ${item.label}`, 100), value: item.key }));
      return interaction.respond(choices);
    },
  };
}
