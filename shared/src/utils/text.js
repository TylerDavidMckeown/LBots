export { escapeMarkdown } from 'discord.js';

export function truncate(text, max, suffix = '…') {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

const numberFormat = new Intl.NumberFormat('en-GB');

export function formatNumber(value) {
  return numberFormat.format(value);
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** Text progress bar, e.g. "▰▰▰▱▱▱▱▱▱▱". */
export function progressBar(value, max, size = 10) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Wraps text in a code block, stripping fences that would break out of it. */
export function codeBlock(text, language = '') {
  return `\`\`\`${language}\n${String(text).replaceAll('```', 'ˋˋˋ')}\n\`\`\``;
}
