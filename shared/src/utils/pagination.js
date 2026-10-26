import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Returns one page of `items`, clamping `page` (1-based) into range. */
export function paginate(items, page = 1, perPage = 10) {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const start = (current - 1) * perPage;
  return { items: items.slice(start, start + perPage), page: current, totalPages, total: items.length };
}

/**
 * First / previous / indicator / next / last buttons.
 * @param {(page: number) => string} customIdFor Builds a custom ID for a target page.
 */
export function pageRow(customIdFor, page, totalPages) {
  const button = (label, target, disabled, suffix = '') => new ButtonBuilder()
    // Suffix keeps IDs unique when two buttons point at the same page.
    .setCustomId(`${customIdFor(target)}${suffix}`)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(
    button('«', 1, page <= 1, ':f'),
    button('‹', page - 1, page <= 1, ':p'),
    button(`${page} / ${totalPages}`, page, true, ':i'),
    button('›', page + 1, page >= totalPages, ':n'),
    button('»', totalPages, page >= totalPages, ':l'),
  );
}
