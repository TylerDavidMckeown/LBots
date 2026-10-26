import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { plural, truncate } from '@lyss/shared/utils/text.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import {
  formatInvoiceNumber, formatMoney, formatQuoteNumber, statusLabel, tagList,
} from '../services/commissionService.js';
import { stars } from './ticketEmbeds.js';

const id = (...parts) => makeCustomId('tickets', ...parts);

const QUOTE_STATUS = {
  pending: '⏳ Awaiting response',
  accepted: '✅ Accepted',
  rejected: '❌ Declined',
  changes_requested: '✏️ Changes requested',
  superseded: '↪️ Superseded',
};

export function commissionEmbed(ctx, commission, { quotes = [], invoices = [] } = {}) {
  const kit = ctx.embeds.for(commission.guild_id);
  const embed = kit.base({ title: `🎨 Commission #${commission.id}`, description: truncate(commission.description, 1500) })
    .addFields(
      { name: 'Status', value: statusLabel(commission.status), inline: true },
      { name: 'Client', value: `<@${commission.client_id}>`, inline: true },
      { name: 'Project type', value: truncate(commission.project_type, 1024), inline: true },
      { name: 'Budget', value: truncate(commission.budget || 'Not specified', 1024), inline: true },
      { name: 'Deadline', value: truncate(commission.deadline || 'Flexible', 1024), inline: true },
      { name: 'Requested', value: discordTimestamp(commission.created_at, 'D'), inline: true },
    );
  if (quotes.length) {
    embed.addFields({ name: 'Quotes', value: truncate(quotes.map((q) => `${formatQuoteNumber(q.number)}: ${formatMoney(q.amount_cents, q.currency)} — ${QUOTE_STATUS[q.status]}`).join('\n'), 1024) });
  }
  if (invoices.length) {
    embed.addFields({ name: 'Invoices', value: truncate(invoices.map((i) => `${formatInvoiceNumber(i.number)}: ${formatMoney(i.amount_cents, i.currency)} — ${i.status === 'paid' ? '✅ Paid' : '⏳ Unpaid'}`).join('\n'), 1024) });
  }
  if (commission.status === 'cancelled' && commission.cancelled_reason) {
    embed.addFields({ name: 'Cancellation reason', value: truncate(commission.cancelled_reason, 1024) });
  }
  return embed;
}

export function statusChangeEmbed(ctx, commission, from, to, actorId, note) {
  const kit = ctx.embeds.for(commission.guild_id);
  const embed = kit.base({ title: 'Commission update', description: `${statusLabel(from)} → **${statusLabel(to)}**` })
    .addFields({ name: 'Updated by', value: `<@${actorId}>`, inline: true }, { name: 'Commission', value: `#${commission.id}`, inline: true });
  if (note) embed.addFields({ name: 'Note', value: truncate(note, 1024) });
  return embed;
}

export function quoteEmbed(ctx, quote) {
  const kit = ctx.embeds.for(quote.guild_id);
  const embed = kit.base({ title: `💬 Quote ${formatQuoteNumber(quote.number)}`, description: truncate(quote.description, 2000) })
    .addFields(
      { name: 'Price', value: formatMoney(quote.amount_cents, quote.currency), inline: true },
      { name: 'Revisions', value: quote.revisions === null ? 'Not specified' : String(quote.revisions), inline: true },
      { name: 'Delivery', value: truncate(quote.delivery || 'To be agreed', 1024), inline: true },
      { name: 'Status', value: QUOTE_STATUS[quote.status], inline: true },
    );
  if (quote.response_note) embed.addFields({ name: 'Client note', value: truncate(quote.response_note, 1024) });
  return embed;
}

/** Response buttons, only while the quote is waiting for an answer. */
export function quoteComponents(quote) {
  if (quote.status !== 'pending') return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('quote', 'accept', quote.id)).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(id('quote', 'changes', quote.id)).setLabel('Request changes').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId(id('quote', 'reject', quote.id)).setLabel('Decline').setStyle(ButtonStyle.Danger),
  )];
}

export function invoiceEmbed(ctx, invoice, commission) {
  const kit = ctx.embeds.for(invoice.guild_id);
  const paid = invoice.status === 'paid';
  const embed = kit.base({ title: `🧾 Invoice ${formatInvoiceNumber(invoice.number)}`, colour: paid ? 0x57f287 : kit.colours.primary })
    .addFields(
      { name: 'Amount', value: formatMoney(invoice.amount_cents, invoice.currency), inline: true },
      { name: 'Status', value: paid ? `✅ Paid ${discordTimestamp(invoice.paid_at, 'D')}` : '⏳ Unpaid', inline: true },
      { name: 'Client', value: `<@${commission.client_id}>`, inline: true },
      { name: 'Commission', value: `#${commission.id} · ${truncate(commission.project_type, 200)}`, inline: true },
      { name: 'Issued', value: discordTimestamp(invoice.created_at, 'D'), inline: true },
    );
  if (!paid) {
    embed.addFields({ name: 'How to pay', value: truncate(ctx.guildConfig.get(invoice.guild_id, 'commissions.paymentInstructions'), 1024) });
  }
  return embed;
}

export function reviewPrompt(ctx, commission) {
  const kit = ctx.embeds.for(commission.guild_id);
  return {
    content: `<@${commission.client_id}>`,
    embeds: [kit.success('Commission complete', 'Thank you for your commission! If you have a moment, please leave a review.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(id('review', 'open', commission.id)).setLabel('Leave a review').setStyle(ButtonStyle.Primary).setEmoji('⭐'),
    )],
    allowedMentions: { users: [commission.client_id] },
  };
}

const REVIEWS_PER_PAGE = 5;

export function reviewsPage(ctx, guildId, requestedPage, services) {
  const kit = ctx.embeds.for(guildId);
  const summary = services.commissions.reviewSummary(guildId);
  const { page, totalPages } = paginate(Array.from({ length: summary.count }), requestedPage, REVIEWS_PER_PAGE);
  const reviews = services.commissions.listReviews(guildId, REVIEWS_PER_PAGE, (page - 1) * REVIEWS_PER_PAGE);
  const description = summary.count
    ? `**${summary.average.toFixed(1)} / 5** ${stars(Math.round(summary.average))} from ${plural(summary.count, 'review')}`
    : 'No reviews yet.';
  const embed = kit.base({ title: '⭐ Commission reviews', description });
  for (const review of reviews) {
    embed.addFields({
      name: `${stars(review.rating)} · ${new Date(review.created_at).toISOString().slice(0, 10)}`,
      value: truncate(`${review.comment ? `“${review.comment}”` : '*No comment*'} — <@${review.client_id}>`, 1024),
    });
  }
  const components = totalPages > 1 ? [pageRow((p) => id('reviews', 'page', p), page, totalPages)] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export function portfolioPage(ctx, guildId, requestedPage, tag, services) {
  const kit = ctx.embeds.for(guildId);
  const entries = services.commissions.listPortfolio(guildId, tag);
  const { items, page, totalPages } = paginate(entries, requestedPage, 1);
  const entry = items[0];
  if (!entry) {
    return { embeds: [kit.info('Portfolio', tag ? `No portfolio entries are tagged \`${tag}\` yet.` : 'The portfolio is empty for now.')], components: [] };
  }
  const embed = kit.base({ title: `🖼️ ${truncate(entry.title, 200)}`, description: entry.description ? truncate(entry.description, 2000) : undefined });
  if (entry.image_url) embed.setImage(entry.image_url);
  const tags = tagList(entry.tags);
  embed.addFields(
    { name: 'Tags', value: tags.length ? tags.map((t) => `\`${t}\``).join(' ') : 'None', inline: true },
    { name: 'Entry', value: `#${entry.id}`, inline: true },
  );
  const components = totalPages > 1 ? [pageRow((p) => id('portfolio', 'page', p, tag || '-'), page, totalPages)] : [];
  return { embeds: [embed], components };
}
