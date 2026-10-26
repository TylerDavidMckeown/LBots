import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { portfolioPage, quoteEmbed, reviewsPage } from '../embeds/commissionEmbeds.js';
import { stars } from '../embeds/ticketEmbeds.js';
import { notifyStatusChange, postInCommission } from '../services/commissionActions.js';
import { formatQuoteNumber } from '../services/commissionService.js';
import { getServices } from '../services/index.js';

function textRow(customId, label, style, { required = true, max } = {}) {
  const field = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required);
  if (max) field.setMaxLength(max);
  return new ActionRowBuilder().addComponents(field);
}

/** Validates that the clicking member is the client and the quote still awaits a response. */
function pendingQuoteForClient(ctx, interaction, rawId) {
  const { commissions } = getServices(ctx);
  const quote = commissions.getQuote(Number(rawId));
  if (!quote) throw new UserError('That quote no longer exists.', { title: 'This has expired' });
  const commission = commissions.get(quote.commission_id);
  if (commission.client_id !== interaction.user.id) throw new UserError('Only the client can respond to this quote.', { title: 'Not your quote' });
  if (quote.status !== 'pending') throw new UserError(`${formatQuoteNumber(quote.number)} is no longer waiting for a response.`, { title: 'Quote closed' });
  return { quote, commission };
}

async function respond(interaction, ctx, rawId, response, note = null) {
  const result = getServices(ctx).commissions.respondToQuote(Number(rawId), {
    userId: interaction.user.id,
    response,
    note,
    slots: ctx.guildConfig.get(interaction.guildId, 'commissions.slots'),
  });
  await interaction.update({ embeds: [quoteEmbed(ctx, result.quote)], components: [] });
  return result;
}

export default [
  {
    id: 'quote:accept',
    async execute(interaction, ctx, [quoteId]) {
      const { commission } = await respond(interaction, ctx, quoteId, 'accept');
      await notifyStatusChange(ctx, { from: 'quoted', to: 'accepted', commission }, interaction.user.id, 'The client accepted the quote.');
    },
  },
  {
    id: 'quote:reject',
    async execute(interaction, ctx, [quoteId]) {
      const { quote, commission } = await respond(interaction, ctx, quoteId, 'reject');
      const kit = ctx.embeds.for(interaction.guildId);
      await postInCommission(ctx, commission, { embeds: [kit.warning('Quote declined', `${interaction.user} declined ${formatQuoteNumber(quote.number)}. A revised quote can be sent with \`/quote create\`.`)] });
    },
  },
  {
    id: 'quote:changes',
    async execute(interaction, ctx, [quoteId]) {
      const { quote } = pendingQuoteForClient(ctx, interaction, quoteId);
      await interaction.showModal(new ModalBuilder()
        .setCustomId(makeCustomId('tickets', 'quote', 'changessubmit', quote.id))
        .setTitle(`Changes to ${formatQuoteNumber(quote.number)}`)
        .addComponents(textRow('note', 'What would you like changed?', TextInputStyle.Paragraph, { max: 1000 })));
    },
  },
  {
    id: 'quote:changessubmit',
    async execute(interaction, ctx, [quoteId]) {
      const note = interaction.fields.getTextInputValue('note').trim();
      const { quote, commission } = await respond(interaction, ctx, quoteId, 'changes', note);
      const kit = ctx.embeds.for(interaction.guildId);
      await postInCommission(ctx, commission, { embeds: [kit.info('Changes requested', `${interaction.user} asked for changes to ${formatQuoteNumber(quote.number)}:\n> ${note.replace(/\n/g, '\n> ')}`)] });
    },
  },
  {
    id: 'review:open',
    async execute(interaction, ctx, [commissionId]) {
      const { commissions } = getServices(ctx);
      const commission = commissions.get(Number(commissionId));
      if (!commission) throw new UserError('That commission no longer exists.', { title: 'This has expired' });
      if (commission.client_id !== interaction.user.id) throw new UserError('Only the client can review this commission.', { title: 'Not your commission' });
      if (commissions.reviewFor(commission.id)) throw new UserError('You have already reviewed this commission. Thank you!', { title: 'Already reviewed' });
      await interaction.showModal(new ModalBuilder()
        .setCustomId(makeCustomId('tickets', 'review', 'submit', commission.id))
        .setTitle('Review your commission')
        .addComponents(
          textRow('rating', 'Rating from 1 to 5', TextInputStyle.Short, { max: 1 }),
          textRow('comment', 'Comment (optional)', TextInputStyle.Paragraph, { required: false, max: 1000 }),
        ));
    },
  },
  {
    id: 'review:submit',
    async execute(interaction, ctx, [commissionId]) {
      const rating = Number(interaction.fields.getTextInputValue('rating'));
      const comment = interaction.fields.getTextInputValue('comment').trim() || null;
      getServices(ctx).commissions.addReview({ commissionId: Number(commissionId), clientId: interaction.user.id, rating, comment });
      const kit = ctx.embeds.for(interaction.guildId);
      await interaction.update({
        embeds: [kit.success('Thank you for your review!', `${stars(rating)}${comment ? `\n“${comment}”` : ''}`)],
        components: [],
      });
    },
  },
  {
    id: 'reviews:page',
    tier: 'restricted',
    async execute(interaction, ctx, [page]) {
      await interaction.update(reviewsPage(ctx, interaction.guildId, Number(page), getServices(ctx)));
    },
  },
  {
    id: 'portfolio:page',
    tier: 'restricted',
    async execute(interaction, ctx, [page, tag]) {
      await interaction.update(portfolioPage(ctx, interaction.guildId, Number(page), tag === '-' ? null : tag, getServices(ctx)));
    },
  },
];
