import { defineBotConfig } from '@lyss/shared/botConfig.js';
import { parseEscalation } from './services/caseService.js';
import { ANTISPAM_DEFAULTS } from './services/spamDetector.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const LOG_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

export default defineBotConfig({
  name: 'Lyss Guard',
  namespace: 'guard',
  databaseFile: 'guard.db',
  brand: { footer: 'Lyss Tools • Guard' },
  intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'MessageContent', 'GuildModeration'],
  partials: ['Message', 'Channel', 'GuildMember'],
  status: [
    { type: 'Watching', text: 'over the server' },
    { type: 'Listening', text: '/help' },
  ],
  requiredPermissions: [
    'ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory',
    'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageChannels', 'ViewAuditLog',
  ],
  setup: [
    { key: 'channel.sharedLog', type: 'channel', section: 'Logging', label: 'Shared log channel', description: 'Used for any log category without its own channel.', permissions: LOG_PERMISSIONS },
    { key: 'channel.modLog', type: 'channel', section: 'Logging', label: 'Moderation log channel', permissions: LOG_PERMISSIONS },
    { key: 'channel.memberLog', type: 'channel', section: 'Logging', label: 'Member log channel', permissions: LOG_PERMISSIONS },
    { key: 'channel.messageLog', type: 'channel', section: 'Logging', label: 'Message log channel', permissions: LOG_PERMISSIONS },
    { key: 'channel.serverLog', type: 'channel', section: 'Logging', label: 'Server log channel', permissions: LOG_PERMISSIONS },
    { key: 'logs.messageCacheRetention', type: 'duration', section: 'Logging', label: 'Keep message content for logs', default: 7 * DAY, min: HOUR, max: 30 * DAY },
    { key: 'guard.warningExpiry', type: 'duration', section: 'Moderation', label: 'Warning expiry', default: 30 * DAY, min: DAY, max: 365 * DAY },
    { key: 'guard.escalation', type: 'text', section: 'Moderation', label: 'Warning escalation (warnings:timeout)', description: 'e.g. "3:1h, 5:24h", or "off".', default: '3:1h, 5:24h', maxLength: 200 },
    { key: 'guard.requireReason', type: 'boolean', section: 'Moderation', label: 'Require reasons for warnings, timeouts, kicks and bans', default: true },
    { key: 'guard.dmTargets', type: 'boolean', section: 'Moderation', label: 'DM members about actions taken against them', default: true },
  ],
  defaults: {
    'logs.member': true,
    'logs.message': true,
    'logs.server': true,
    'logs.moderation': true,
    'logs.ignoredChannels': [],
    'antispam.enabled': false,
    ...ANTISPAM_DEFAULTS,
  },
  checks: [
    async (guild, ctx) => ({
      name: 'Moderation rules',
      results: [
        parseEscalation(ctx.guildConfig.get(guild.id, 'guard.escalation'))
          ? { level: 'pass', text: 'Warning escalation rules are valid.' }
          : { level: 'fail', text: 'Warning escalation is invalid. Use a format like `3:1h, 5:24h` or `off`.' },
        ctx.guildConfig.get(guild.id, 'antispam.enabled')
          ? { level: 'pass', text: 'Anti-spam is enabled.' }
          : { level: 'warn', text: 'Anti-spam is disabled. Enable it with `/antispam toggle`.' },
      ],
    }),
  ],
  help: { intro: 'Lyss Guard keeps the server safe with moderation tools, logging and anti-spam. Choose a category below.' },
});
