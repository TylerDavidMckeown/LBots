import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { closedComponents, confirmRow, stars } from '../embeds/ticketEmbeds.js';
import { requireHandler, requireTicketById } from '../services/access.js';
import { getServices } from '../services/index.js';
import { assertCanOpen, deleteTicket, logTicketEvent, openTicket } from '../services/ticketActions.js';
import {
  assertCanClose, claim, closeAndConfirm, promptDelete, reopenAndConfirm, unclaim,
} from '../services/ticketInteractions.js';
import { TICKET_TYPES, ticketType } from '../services/ticketTypes.js';

const input = (customId, label, style, { required = true, max, placeholder } = {}) => {
  const field = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required);
  if (max) field.setMaxLength(max);
  if (placeholder) field.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(field);
};

function openModal(typeKey) {
  const type = ticketType(typeKey);
  const modal = new ModalBuilder().setCustomId(makeCustomId('tickets', 'ticket', 'submit', typeKey));
  if (typeKey === 'commissions') {
    return modal.setTitle('Request a commission').addComponents(
      input('projectType', 'Project type', TextInputStyle.Short, { max: 100, placeholder: 'e.g. Logo, illustration, Discord bot' }),
      input('description', 'Describe your project', TextInputStyle.Paragraph, { max: 1500 }),
      input('budget', 'Budget', TextInputStyle.Short, { required: false, max: 100, placeholder: 'e.g. $100–150' }),
      input('deadline', 'Deadline', TextInputStyle.Short, { required: false, max: 100, placeholder: 'e.g. End of the month, or flexible' }),
      input('references', 'Reference links (optional)', TextInputStyle.Paragraph, { required: false, max: 1000 }),
    );
  }
  return modal.setTitle(typeKey === 'support' ? 'Open a support ticket' : type.label)
    .addComponents(input('subject', type.prompt, TextInputStyle.Paragraph, { max: 1000 }));
}

const optional = (value) => value?.trim() || null;

export default [
  {
    id: 'ticket:open',
    tier: 'restricted',
    async execute(interaction, ctx, [typeKey]) {
      if (!TICKET_TYPES[typeKey]) throw new UserError('This panel is out of date. Please ask an admin to repost it.', { title: 'This has expired' });
      // Check first so members never fill in a form that cannot be submitted.
      assertCanOpen(ctx, interaction.guildId, interaction.user.id, typeKey);
      await interaction.showModal(openModal(typeKey));
    },
  },
  {
    id: 'ticket:submit',
    tier: 'restricted',
    async execute(interaction, ctx, [typeKey]) {
      if (!TICKET_TYPES[typeKey]) throw new UserError('This form is out of date.', { title: 'This has expired' });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const value = (fieldId) => interaction.fields.getTextInputValue(fieldId);
      const details = typeKey === 'commissions'
        ? {
          commission: {
            projectType: value('projectType').trim(),
            description: value('description').trim(),
            budget: optional(value('budget')),
            deadline: optional(value('deadline')),
            references: optional(value('references')),
          },
        }
        : { subject: value('subject').trim() };
      const { channel } = await openTicket(ctx, interaction, typeKey, details);
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.editReply({ embeds: [kit.success('Ticket created', `Your ticket is ready: ${channel}`)] });
    },
  },
  {
    id: 'ticket:claim',
    async execute(interaction, ctx, [ticketId]) {
      return claim(ctx, interaction, requireTicketById(ctx, ticketId));
    },
  },
  {
    id: 'ticket:unclaim',
    async execute(interaction, ctx, [ticketId]) {
      return unclaim(ctx, interaction, requireTicketById(ctx, ticketId));
    },
  },
  {
    id: 'ticket:close',
    tier: 'restricted',
    async execute(interaction, ctx, [ticketId]) {
      const ticket = requireTicketById(ctx, ticketId);
      assertCanClose(ctx, interaction, ticket);
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.reply({
        embeds: [kit.warning('Close this ticket?', 'A transcript will be saved and the channel will be locked.')],
        components: [confirmRow(makeCustomId('tickets', 'ticket', 'closeconfirm', ticket.id), 'Close ticket')],
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    id: 'ticket:closeconfirm',
    tier: 'restricted',
    async execute(interaction, ctx, [ticketId]) {
      const ticket = requireTicketById(ctx, ticketId);
      assertCanClose(ctx, interaction, ticket);
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.update({ embeds: [kit.loading('Closing ticket', 'Saving the transcript…')], components: [] });
      await closeAndConfirm(ctx, interaction, ticket);
    },
  },
  {
    id: 'ticket:closereason',
    tier: 'restricted',
    async execute(interaction, ctx, [ticketId]) {
      const ticket = requireTicketById(ctx, ticketId);
      assertCanClose(ctx, interaction, ticket);
      await interaction.showModal(new ModalBuilder()
        .setCustomId(makeCustomId('tickets', 'ticket', 'closereasonsubmit', ticket.id))
        .setTitle('Close ticket')
        .addComponents(input('reason', 'Reason', TextInputStyle.Paragraph, { max: 500 })));
    },
  },
  {
    id: 'ticket:closereasonsubmit',
    tier: 'restricted',
    async execute(interaction, ctx, [ticketId]) {
      const ticket = requireTicketById(ctx, ticketId);
      await closeAndConfirm(ctx, interaction, ticket, interaction.fields.getTextInputValue('reason').trim());
    },
  },
  {
    id: 'ticket:reopen',
    async execute(interaction, ctx, [ticketId]) {
      return reopenAndConfirm(ctx, interaction, requireTicketById(ctx, ticketId));
    },
  },
  {
    id: 'ticket:delete',
    async execute(interaction, ctx, [ticketId]) {
      return promptDelete(ctx, interaction, requireTicketById(ctx, ticketId));
    },
  },
  {
    id: 'ticket:deleteconfirm',
    async execute(interaction, ctx, [ticketId]) {
      const ticket = requireTicketById(ctx, ticketId);
      requireHandler(ctx, interaction, ticket.type);
      if (ticket.status !== 'closed') throw new UserError('Close the ticket before deleting it.', { title: 'Ticket still open' });
      const kit = ctx.embeds.for(interaction.guildId);
      // Reply before deleting: the channel (and this message) disappear afterwards.
      await interaction.update({ embeds: [kit.loading('Deleting ticket', 'Removing the channel…')], components: [] });
      await deleteTicket(ctx, ticket, interaction.user.id, `Deleted by ${interaction.user.tag}`);
    },
  },
  {
    id: 'ticket:rate',
    tier: 'restricted',
    async execute(interaction, ctx, [ticketId, rawStars]) {
      const { tickets } = getServices(ctx);
      const ticket = requireTicketById(ctx, ticketId);
      if (interaction.user.id !== ticket.opener_id) throw new UserError('Only the person who opened this ticket can rate it.', { title: 'Not your ticket' });
      const rating = Number(rawStars);
      if (!tickets.rate(ticket.id, interaction.user.id, rating)) throw new UserError('You have already rated this ticket. Thank you!', { title: 'Already rated' });
      await interaction.update({ components: closedComponents(ticket, { askRating: false }) });
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.followUp({ embeds: [kit.success('Thanks for your feedback!', `You rated this ticket ${stars(rating)}.`)], flags: MessageFlags.Ephemeral });
      await logTicketEvent(ctx, ticket, 'rated', interaction.user.id, { Rating: stars(rating) });
    },
  },
  {
    id: 'ticket:dismiss',
    tier: 'restricted',
    async execute(interaction, ctx) {
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.update({ embeds: [kit.info('Cancelled', 'Nothing was changed.')], components: [] });
    },
  },
];
