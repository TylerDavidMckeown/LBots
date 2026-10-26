import { defineBotConfig } from '@lyss/shared/botConfig.js';

const HOUR = 3_600_000;
const MESSAGE_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
const TICKET_CATEGORY_PERMISSIONS = ['ViewChannel', 'ManageChannels', 'ManageRoles'];

export default defineBotConfig({
  name: 'Lyss Tickets',
  namespace: 'tickets',
  databaseFile: 'tickets.db',
  brand: { footer: 'Lyss Tools • Tickets' },
  intents: ['Guilds', 'GuildMessages', 'MessageContent'],
  status: [
    { type: 'Watching', text: 'for new tickets' },
    { type: 'Listening', text: '/help' },
    { type: 'Watching', text: 'over {guilds} servers' },
  ],
  requiredPermissions: [
    'ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory',
    'ManageChannels', 'ManageRoles', 'ManageMessages',
  ],
  setup: [
    { key: 'category.support', type: 'category', section: 'Tickets', label: 'Support ticket category', permissions: TICKET_CATEGORY_PERMISSIONS },
    { key: 'category.contact', type: 'category', section: 'Tickets', label: 'Contact Lyss category', permissions: TICKET_CATEGORY_PERMISSIONS },
    { key: 'category.commissions', type: 'category', section: 'Tickets', label: 'Commission ticket category', permissions: TICKET_CATEGORY_PERMISSIONS },
    { key: 'channel.transcripts', type: 'channel', section: 'Tickets', label: 'Transcript channel', permissions: [...MESSAGE_PERMISSIONS, 'AttachFiles'] },
    { key: 'channel.ticketLog', type: 'channel', section: 'Tickets', label: 'Ticket log channel', permissions: MESSAGE_PERMISSIONS },
    { key: 'role.support', type: 'role', section: 'Tickets', label: 'Support team role' },
    { key: 'role.contact', type: 'role', section: 'Tickets', label: 'Contact handler role', description: 'Optional. Owners (OWNER_ID) always handle contact tickets.' },
    { key: 'role.commissions', type: 'role', section: 'Tickets', label: 'Commission manager role', description: 'Optional. Owners (OWNER_ID) always handle commissions.' },
    { key: 'tickets.ratings', type: 'boolean', section: 'Tickets', label: 'Ask for satisfaction ratings', default: true },
    { key: 'tickets.dmTranscripts', type: 'boolean', section: 'Tickets', label: 'DM transcripts to the opener', default: true },
    { key: 'tickets.autoClose', type: 'boolean', section: 'Timings', label: 'Auto-close inactive support tickets', default: true },
    { key: 'tickets.inactivityReminder', type: 'duration', section: 'Timings', label: 'Inactivity reminder after', default: 48 * HOUR, min: HOUR, max: 30 * 24 * HOUR },
    { key: 'tickets.inactivityClose', type: 'duration', section: 'Timings', label: 'Close after reminder', default: 24 * HOUR, min: HOUR, max: 30 * 24 * HOUR },
    { key: 'tickets.retention', type: 'duration', section: 'Timings', label: 'Closed ticket retention', default: 24 * HOUR, min: HOUR, max: 90 * 24 * HOUR },
    { key: 'commissions.open', type: 'boolean', section: 'Commissions', label: 'Accepting commissions', default: true },
    { key: 'commissions.slots', type: 'integer', section: 'Commissions', label: 'Commission slots', default: 3, min: 0, max: 50 },
    { key: 'commissions.currency', type: 'text', section: 'Commissions', label: 'Currency (ISO code)', default: 'USD', maxLength: 3 },
    { key: 'commissions.paymentInstructions', type: 'text', section: 'Commissions', label: 'Payment instructions', maxLength: 1000, default: 'Payment instructions have not been configured yet. Lyss will share them with you directly.' },
  ],
  help: { intro: 'Lyss Tickets handles support requests, private contact and commissions. Choose a category below.' },
});
