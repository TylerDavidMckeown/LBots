import { defineBotConfig } from '@lyss/shared/botConfig.js';
import { ECONOMY_DEFAULTS } from './services/economyRules.js';

const HOUR = 3_600_000;

const ANNOUNCE = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
// Link-only channels are mentioned in embeds; the bot just needs to see them.
const LINK = ['ViewChannel'];

export default defineBotConfig({
  name: 'Lyss Community',
  namespace: 'community',
  databaseFile: 'community.db',
  brand: { footer: 'Lyss Tools • Community' },
  intents: ['Guilds', 'GuildMembers', 'GuildMessages', 'GuildMessageReactions', 'MessageContent'],
  partials: ['Message', 'Channel', 'Reaction', 'User', 'GuildMember'],
  status: [
    { type: 'Playing', text: 'with Lyss Coins' },
    { type: 'Watching', text: 'the community grow' },
    { type: 'Listening', text: '/help' },
  ],
  requiredPermissions: [
    'ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory',
    'AddReactions', 'ManageRoles', 'CreatePublicThreads', 'UseExternalEmojis',
  ],
  setup: [
    { key: 'channel.welcome', type: 'channel', section: 'Announcements', label: 'Welcome channel', permissions: ANNOUNCE },
    { key: 'channel.boost', type: 'channel', section: 'Announcements', label: 'Boost announcement channel', permissions: ANNOUNCE },
    { key: 'channel.birthdays', type: 'channel', section: 'Announcements', label: 'Birthday channel', permissions: ANNOUNCE },
    { key: 'channel.events', type: 'channel', section: 'Announcements', label: 'Event announcement channel', permissions: ANNOUNCE },
    { key: 'channel.suggestions', type: 'channel', section: 'Engagement', label: 'Suggestion channel', permissions: [...ANNOUNCE, 'CreatePublicThreads'] },
    { key: 'channel.giveaways', type: 'channel', section: 'Engagement', label: 'Giveaway channel', permissions: ANNOUNCE },
    { key: 'channel.polls', type: 'channel', section: 'Engagement', label: 'Poll channel', permissions: ANNOUNCE },
    { key: 'channel.starboard', type: 'channel', section: 'Engagement', label: 'Starboard channel', permissions: ANNOUNCE },
    { key: 'channel.rules', type: 'channel', section: 'Links', label: 'Rules channel', permissions: LINK },
    { key: 'channel.info', type: 'channel', section: 'Links', label: 'Information channel', permissions: LINK },
    { key: 'channel.support', type: 'channel', section: 'Links', label: 'Support channel', permissions: LINK },
    { key: 'channel.roles', type: 'channel', section: 'Links', label: 'Role selection channel', permissions: LINK },
    { key: 'role.birthday', type: 'role', section: 'Roles', label: 'Birthday role', manageable: true },
    { key: 'role.booster', type: 'role', section: 'Roles', label: 'Booster reward role', manageable: true },
    { key: 'role.customRoleAnchor', type: 'role', section: 'Roles', label: 'Custom role anchor', description: 'Purchased roles are placed directly below this role.', manageable: true },
    { key: 'welcome.enabled', type: 'boolean', section: 'Welcome & boosts', label: 'Welcome messages', default: true },
    { key: 'welcome.message', type: 'text', section: 'Welcome & boosts', label: 'Welcome text', maxLength: 1000, default: 'Welcome to **{server}**, {user}! You are our {count}th member. Make yourself at home.' },
    { key: 'welcome.banner', type: 'url', section: 'Welcome & boosts', label: 'Welcome banner image' },
    { key: 'boost.enabled', type: 'boolean', section: 'Welcome & boosts', label: 'Announce new boosts', default: true },
    { key: 'boost.announceStop', type: 'boolean', section: 'Welcome & boosts', label: 'Announce ended boosts', default: false },
    { key: 'boost.perks', type: 'text', section: 'Welcome & boosts', label: 'Booster perks text', maxLength: 1000, default: 'Thank you for supporting the server! 💜' },
    { key: 'boost.reward', type: 'integer', section: 'Welcome & boosts', label: 'Lyss Coins for boosting (0 = none)', default: 0, min: 0, max: 1_000_000 },
    { key: 'suggestions.threads', type: 'boolean', section: 'Engagement', label: 'Open a discussion thread per suggestion', default: true },
    { key: 'starboard.threshold', type: 'integer', section: 'Engagement', label: 'Stars needed for the starboard', default: 3, min: 1, max: 100 },
    { key: 'starboard.emoji', type: 'text', section: 'Engagement', label: 'Starboard emoji', default: '⭐', maxLength: 64 },
    { key: 'birthday.hour', type: 'integer', section: 'Birthdays', label: 'Announcement hour (server time, 0–23)', default: 9, min: 0, max: 23 },
    { key: 'birthday.roleDuration', type: 'duration', section: 'Birthdays', label: 'Birthday role lasts', default: 24 * HOUR, min: HOUR, max: 72 * HOUR },
  ],
  defaults: {
    'starboard.excludedChannels': [],
    ...ECONOMY_DEFAULTS,
  },
  help: { intro: 'Lyss Community runs the server\'s community features and the Lyss game world. Choose a category below.' },
});
