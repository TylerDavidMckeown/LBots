import { DateTime, IANAZone } from 'luxon';

const UNIT_MS = { w: 604_800_000, d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };

/**
 * Parses durations like "30m", "1h30m" or "2d 4h". Returns milliseconds, or null when invalid.
 */
export function parseDuration(input) {
  const text = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const pattern = /(\d+)(w|d|h|m|s)/g;
  let total = 0;
  let consumed = 0;
  let match;
  while ((match = pattern.exec(text))) {
    total += Number(match[1]) * UNIT_MS[match[2]];
    consumed += match[0].length;
  }
  if (consumed !== text.length || total <= 0 || !Number.isSafeInteger(total)) return null;
  return total;
}

/** Formats milliseconds as e.g. "1d 4h 30m". Shows at most `parts` units. */
export function formatDuration(ms, parts = 3) {
  if (!Number.isFinite(ms) || ms < 1_000) return '0s';
  const out = [];
  let rest = Math.floor(ms);
  for (const [unit, size] of Object.entries(UNIT_MS)) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      out.push(`${value}${unit}`);
      rest -= value * size;
    }
    if (out.length === parts) break;
  }
  return out.join(' ');
}

/** Discord timestamp markup. Styles: t T d D f F R. */
export function discordTimestamp(date, style = 'f') {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function isValidTimezone(zone) {
  return typeof zone === 'string' && IANAZone.isValidZone(zone);
}

export function nowIn(zone) {
  return DateTime.now().setZone(isValidTimezone(zone) ? zone : 'UTC');
}

/**
 * UTC milliseconds for the start of the local day containing `at` in `zone`.
 * Claim timestamps are stored in UTC; resets are calculated with this.
 */
export function startOfLocalDay(zone, at = Date.now()) {
  return DateTime.fromMillis(at, { zone: isValidTimezone(zone) ? zone : 'UTC' }).startOf('day').toMillis();
}
