/**
 * Anti-spam settings and detection. Pure (no Discord calls), so the rules can be tested.
 */

export const ANTISPAM_SETTINGS = Object.freeze([
  { key: 'antispam.rateCount', type: 'integer', label: 'Messages per burst window', default: 5, min: 2, max: 30 },
  { key: 'antispam.rateSeconds', type: 'integer', label: 'Burst window (seconds)', default: 5, min: 2, max: 60 },
  { key: 'antispam.duplicateCount', type: 'integer', label: 'Identical messages allowed', default: 3, min: 2, max: 20 },
  { key: 'antispam.duplicateSeconds', type: 'integer', label: 'Identical message window (seconds)', default: 30, min: 5, max: 600 },
  { key: 'antispam.mentionLimit', type: 'integer', label: 'Unique mentions per message', default: 5, min: 2, max: 50 },
  { key: 'antispam.invites', type: 'boolean', label: 'Block Discord invite links', default: true },
  { key: 'antispam.allowedInvites', type: 'text', label: 'Allowed invite codes (comma separated, or "none")', default: '', maxLength: 500 },
  { key: 'antispam.caps', type: 'boolean', label: 'Detect excessive caps', default: false },
  { key: 'antispam.emoji', type: 'boolean', label: 'Detect emoji spam', default: false },
  { key: 'antispam.emojiLimit', type: 'integer', label: 'Emoji per message', default: 10, min: 3, max: 50 },
]);

export const ANTISPAM_DEFAULTS = Object.freeze(Object.fromEntries(ANTISPAM_SETTINGS.map((s) => [s.key, s.default])));

export const RULE_TEXT = Object.freeze({
  rate: 'sending messages too quickly',
  duplicate: 'repeating the same message',
  mentions: 'mentioning too many people',
  invite: 'posting Discord invites',
  caps: 'using excessive capitals',
  emoji: 'sending too many emoji',
});

/** Offences within this window count towards escalation. */
export const OFFENCE_WINDOW_MS = 10 * 60_000;
/** Detections this soon after an offence belong to the same burst and are not punished again. */
export const BURST_COOLDOWN_MS = 15_000;

/**
 * Escalation for the Nth offence in the window:
 * 1 → delete and warn in channel; 2 → warning case and 5-minute timeout; 3+ → 1-hour timeout.
 */
export function escalationStep(offenceCount) {
  if (offenceCount <= 1) return { kind: 'notice' };
  if (offenceCount === 2) return { kind: 'warn-timeout', timeoutMs: 5 * 60_000 };
  return { kind: 'timeout', timeoutMs: 60 * 60_000 };
}

const INVITE_PATTERN = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg)\/([a-z0-9-]+)/gi;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;

export function inviteCodes(content) {
  return [...String(content ?? '').matchAll(INVITE_PATTERN)].map((m) => m[1]);
}

export function parseAllowedInvites(text) {
  const value = String(text ?? '').trim();
  if (!value || /^none$/i.test(value)) return [];
  return value.split(/[,\s]+/).map((code) => code.replace(/^.*\//, '')).filter(Boolean);
}

export function isExcessiveCaps(content) {
  const letters = String(content ?? '').replace(CUSTOM_EMOJI, '').replace(/[^A-Za-z]/g, '');
  if (letters.length < 15) return false;
  return letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.7;
}

export function countEmoji(content) {
  const text = String(content ?? '');
  return (text.match(CUSTOM_EMOJI) ?? []).length + (text.replace(CUSTOM_EMOJI, '').match(UNICODE_EMOJI) ?? []).length;
}

const normalise = (content) => String(content ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Tracks recent messages per member and reports the first rule a message breaks.
 * @param {{ maxTracked?: number }} options
 */
export function createSpamDetector({ maxTracked = 50 } = {}) {
  const history = new Map();

  return {
    /**
     * @param {{ guildId, userId, channelId, messageId, content, mentionCount, at }} message
     * @param {object} s Settings keyed without the "antispam." prefix.
     * @returns {{ rule: string, messages: { messageId, channelId }[] } | null}
     */
    check(message, s) {
      const key = `${message.guildId}:${message.userId}`;
      const keepMs = Math.max(s.rateSeconds, s.duplicateSeconds) * 1000;
      const entry = { messageId: message.messageId, channelId: message.channelId, at: message.at, text: normalise(message.content) };
      const recent = (history.get(key) ?? []).filter((e) => message.at - e.at < keepMs);
      recent.push(entry);
      history.set(key, recent.slice(-maxTracked));
      const self = [{ messageId: entry.messageId, channelId: entry.channelId }];
      const refs = (list) => list.map(({ messageId, channelId }) => ({ messageId, channelId }));

      if (message.mentionCount >= s.mentionLimit) return { rule: 'mentions', messages: self };
      if (s.invites) {
        const allowed = parseAllowedInvites(s.allowedInvites);
        if (inviteCodes(message.content).some((code) => !allowed.includes(code))) return { rule: 'invite', messages: self };
      }
      if (s.caps && isExcessiveCaps(message.content)) return { rule: 'caps', messages: self };
      if (s.emoji && countEmoji(message.content) >= s.emojiLimit) return { rule: 'emoji', messages: self };

      const burst = recent.filter((e) => message.at - e.at < s.rateSeconds * 1000);
      if (burst.length >= s.rateCount) return { rule: 'rate', messages: refs(burst) };
      if (entry.text) {
        const duplicates = recent.filter((e) => e.text === entry.text && message.at - e.at < s.duplicateSeconds * 1000);
        if (duplicates.length >= s.duplicateCount) return { rule: 'duplicate', messages: refs(duplicates) };
      }
      return null;
    },
    /** Forgets a member's history after punishment so the same burst is not detected again. */
    reset(guildId, userId) {
      history.delete(`${guildId}:${userId}`);
    },
    size: () => history.size,
  };
}
