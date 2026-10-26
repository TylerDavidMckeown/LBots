/**
 * The three ticket panels. Each type decides who can see and handle its tickets.
 * - handlerRoleKeys: guild_config role settings whose members handle this type.
 * - viewerRoleKeys: roles given access to the ticket channel.
 * - staffTierAccess: members at the Staff tier or above also handle it.
 * - includeOwners: OWNER_ID users are added to the channel and can handle it.
 */
export const TICKET_TYPES = Object.freeze({
  support: {
    key: 'support',
    label: 'Support',
    emoji: '🛟',
    categoryKey: 'category.support',
    handlerRoleKeys: ['role.support'],
    viewerRoleKeys: ['role.support', 'role.staff', 'role.moderator', 'role.admin'],
    staffTierAccess: true,
    includeOwners: false,
    inactivity: true,
    openerCanClose: true,
    ratings: true,
    prompt: 'What do you need help with?',
    welcome: 'Thanks for reaching out! Describe the problem in as much detail as you can and a member of the support team will be with you shortly.',
    panel: {
      title: '🛟 Need a hand?',
      description: 'Open a support ticket for questions, setup help or troubleshooting. Only you and the support team can see it.',
      button: 'Open a support ticket',
    },
  },
  contact: {
    key: 'contact',
    label: 'Contact Lyss',
    emoji: '✉️',
    categoryKey: 'category.contact',
    handlerRoleKeys: ['role.contact'],
    viewerRoleKeys: ['role.contact'],
    staffTierAccess: false,
    includeOwners: true,
    inactivity: false,
    openerCanClose: true,
    ratings: true,
    prompt: 'What would you like to talk about?',
    welcome: 'Thanks for getting in touch. This conversation is private between you and Lyss, who will reply here as soon as possible.',
    panel: {
      title: '✉️ Contact Lyss',
      description: 'Private enquiries, partnerships and personal messages. Only you and Lyss can see this ticket.',
      button: 'Contact Lyss',
    },
  },
  commissions: {
    key: 'commissions',
    label: 'Commission',
    emoji: '🎨',
    categoryKey: 'category.commissions',
    handlerRoleKeys: ['role.commissions'],
    viewerRoleKeys: ['role.commissions'],
    staffTierAccess: false,
    includeOwners: true,
    inactivity: false,
    openerCanClose: false,
    ratings: false,
    welcome: 'Thanks for your commission request! Lyss will review the details below and send you a quote in this channel.',
    panel: {
      title: '🎨 Commissions',
      description: 'Request custom creative or technical work. Tell us about your project and you will receive a quote in a private ticket.',
      button: 'Request a commission',
    },
  },
});

export const TYPE_KEYS = Object.keys(TICKET_TYPES);
export const TYPE_CHOICES = Object.values(TICKET_TYPES).map((type) => ({ name: type.label, value: type.key }));

export function ticketType(key) {
  const type = TICKET_TYPES[key];
  if (!type) throw new Error(`Unknown ticket type: ${key}`);
  return type;
}

export function formatTicketNumber(number) {
  return String(number).padStart(4, '0');
}

export function ticketLabel(ticket) {
  return `${ticketType(ticket.type).label} ticket #${formatTicketNumber(ticket.number)}`;
}
