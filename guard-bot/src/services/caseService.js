import { UserError } from '@lyss/shared/errorReporter.js';
import { parseDuration } from '@lyss/shared/utils/time.js';

export const MAX_TIMEOUT_MS = 28 * 86_400_000;

export const CASE_ACTIONS = Object.freeze({
  warn: { label: 'Warning', emoji: '⚠️', colour: 0xfee75c },
  unwarn: { label: 'Warning removed', emoji: '↩️', colour: 0x57f287 },
  timeout: { label: 'Timeout', emoji: '⏳', colour: 0xf0b232 },
  untimeout: { label: 'Timeout removed', emoji: '⌛', colour: 0x57f287 },
  kick: { label: 'Kick', emoji: '👢', colour: 0xf0b232 },
  ban: { label: 'Ban', emoji: '🔨', colour: 0xed4245 },
  tempban: { label: 'Temporary ban', emoji: '⏱️', colour: 0xed4245 },
  unban: { label: 'Unban', emoji: '🕊️', colour: 0x57f287 },
  purge: { label: 'Purge', emoji: '🧹', colour: 0x5865f2 },
  slowmode: { label: 'Slowmode', emoji: '🐢', colour: 0x5865f2 },
  lock: { label: 'Channel locked', emoji: '🔒', colour: 0x5865f2 },
  unlock: { label: 'Channel unlocked', emoji: '🔓', colour: 0x5865f2 },
});

/**
 * Parses warning escalation rules such as "3:1h, 5:24h" into
 * [{ count: 3, durationMs }, ...]. "off" or "none" disables escalation.
 * Returns null when the text is invalid.
 */
export function parseEscalation(text) {
  const value = String(text ?? '').trim();
  if (/^(off|none)?$/i.test(value)) return [];
  const rules = [];
  for (const part of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = /^(\d+)\s*:\s*(\S+)$/.exec(part);
    if (!match) return null;
    const count = Number(match[1]);
    const durationMs = parseDuration(match[2]);
    if (count < 1 || !durationMs || durationMs < 60_000 || durationMs > MAX_TIMEOUT_MS) return null;
    rules.push({ count, durationMs });
  }
  if (new Set(rules.map((r) => r.count)).size !== rules.length) return null;
  return rules.sort((a, b) => a.count - b.count);
}

/** The rule triggered by reaching exactly `activeCount` warnings, so each threshold fires once per climb. */
export function escalationFor(rules, activeCount) {
  return rules.find((rule) => rule.count === activeCount) ?? null;
}

export function createCaseService(db) {
  const q = {
    next: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM mod_cases WHERE guild_id = ?'),
    insert: db.prepare(`
      INSERT INTO mod_cases (guild_id, number, action, target_id, channel_id, moderator_id, reason, duration_ms, expires_at, source, related_case_id, metadata, created_at)
      VALUES (@guildId, @number, @action, @targetId, @channelId, @moderatorId, @reason, @durationMs, @expiresAt, @source, @relatedCaseId, @metadata, @now)
    `),
    byId: db.prepare('SELECT * FROM mod_cases WHERE id = ?'),
    byNumber: db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND number = ?'),
    forTarget: db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? ORDER BY number DESC LIMIT ? OFFSET ?'),
    countForTarget: db.prepare('SELECT COUNT(*) AS n FROM mod_cases WHERE guild_id = ? AND target_id = ?'),
    warnings: db.prepare(`SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? AND action = 'warn' ORDER BY number DESC`),
    activeWarnings: db.prepare(`
      SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? AND action = 'warn'
        AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY number
    `),
    revoke: db.prepare('UPDATE mod_cases SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL'),
    reason: db.prepare('UPDATE mod_cases SET reason = ?, updated_at = ? WHERE id = ?'),
    log: db.prepare('UPDATE mod_cases SET log_channel_id = ?, log_message_id = ? WHERE id = ?'),
    latestBan: db.prepare(`SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? AND action IN ('ban', 'tempban', 'unban') ORDER BY number DESC LIMIT 1`),

    addNote: db.prepare('INSERT INTO mod_notes (guild_id, target_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)'),
    note: db.prepare('SELECT * FROM mod_notes WHERE id = ?'),
    notes: db.prepare('SELECT * FROM mod_notes WHERE guild_id = ? AND target_id = ? ORDER BY created_at DESC, id DESC'),
    removeNote: db.prepare('DELETE FROM mod_notes WHERE guild_id = ? AND id = ?'),
  };

  const parse = (row) => (row ? { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : null } : row);

  return {
    /** Creates a case with the next number for the guild. */
    create({
      guildId, action, moderatorId, targetId = null, channelId = null, reason = null, durationMs = null, expiresAt = null,
      source = 'manual', relatedCaseId = null, metadata = null, now = Date.now(),
    }) {
      return db.transaction(() => {
        const number = q.next.get(guildId).n;
        const id = Number(q.insert.run({
          guildId, number, action, targetId, channelId, moderatorId, reason, durationMs, expiresAt, source, relatedCaseId,
          metadata: metadata ? JSON.stringify(metadata) : null, now,
        }).lastInsertRowid);
        return parse(q.byId.get(id));
      }).immediate();
    },
    getById: (id) => parse(q.byId.get(id)),
    get: (guildId, number) => parse(q.byNumber.get(guildId, number)),
    forTarget: (guildId, targetId, limit = 10, offset = 0) => q.forTarget.all(guildId, targetId, limit, offset).map(parse),
    countForTarget: (guildId, targetId) => q.countForTarget.get(guildId, targetId).n,
    warnings: (guildId, targetId) => q.warnings.all(guildId, targetId).map(parse),
    activeWarnings: (guildId, targetId, now = Date.now()) => q.activeWarnings.all(guildId, targetId, now).map(parse),
    latestBanCase: (guildId, targetId) => parse(q.latestBan.get(guildId, targetId)),
    setLogMessage: (id, channelId, messageId) => q.log.run(channelId, messageId, id),

    /** Revokes an active warning. */
    revokeWarning(guildId, number, { by, reason = null, now = Date.now() }) {
      const warning = q.byNumber.get(guildId, number);
      if (!warning) throw new UserError(`Case #${number} does not exist.`, { title: 'Case not found' });
      if (warning.action !== 'warn') throw new UserError(`Case #${number} is not a warning.`, { title: 'Not a warning' });
      if (!q.revoke.run(now, by, reason, warning.id).changes) throw new UserError(`Warning #${number} was already removed.`, { title: 'Already removed' });
      return parse(q.byId.get(warning.id));
    },

    updateReason(guildId, number, reason, now = Date.now()) {
      const found = q.byNumber.get(guildId, number);
      if (!found) throw new UserError(`Case #${number} does not exist.`, { title: 'Case not found' });
      q.reason.run(reason, now, found.id);
      return parse(q.byId.get(found.id));
    },

    addNote(guildId, targetId, authorId, content, now = Date.now()) {
      return q.note.get(Number(q.addNote.run(guildId, targetId, authorId, content, now).lastInsertRowid));
    },
    notes: (guildId, targetId) => q.notes.all(guildId, targetId),
    removeNote: (guildId, id) => q.removeNote.run(guildId, id).changes > 0,
  };
}
