import { UserError } from '@lyss/shared/errorReporter.js';

/** Database stores for the phase 4 community features. */

export const MAX_AUTOROLES = 25;

export function createAutoroleStore(db) {
  const q = {
    get: db.prepare('SELECT * FROM autoroles WHERE guild_id = ? AND role_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM autoroles WHERE guild_id = ?'),
    upsert: db.prepare(`
      INSERT INTO autoroles (guild_id, role_id, label, emoji, description, added_by, created_at)
      VALUES (@guildId, @roleId, @label, @emoji, @description, @addedBy, @now)
      ON CONFLICT (guild_id, role_id) DO UPDATE SET label = excluded.label, emoji = excluded.emoji, description = excluded.description
    `),
    remove: db.prepare('DELETE FROM autoroles WHERE guild_id = ? AND role_id = ?'),
    list: db.prepare('SELECT * FROM autoroles WHERE guild_id = ? ORDER BY created_at, role_id'),
    addPanel: db.prepare('INSERT INTO autorole_panels (message_id, guild_id, channel_id, title, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    panels: db.prepare('SELECT * FROM autorole_panels WHERE guild_id = ?'),
    removePanel: db.prepare('DELETE FROM autorole_panels WHERE message_id = ?'),
  };
  return {
    /** Adds or updates a self-assignable role. Returns whether it already existed. */
    add({ guildId, roleId, label, emoji = null, description = null, addedBy, now = Date.now() }) {
      return db.transaction(() => {
        const existing = q.get.get(guildId, roleId);
        if (!existing && q.count.get(guildId).n >= MAX_AUTOROLES) {
          throw new UserError(`A server can have at most ${MAX_AUTOROLES} self-assignable roles.`, { title: 'Too many roles' });
        }
        q.upsert.run({ guildId, roleId, label, emoji, description, addedBy, now });
        return { updated: Boolean(existing) };
      })();
    },
    get: (guildId, roleId) => q.get.get(guildId, roleId),
    remove: (guildId, roleId) => q.remove.run(guildId, roleId).changes > 0,
    list: (guildId) => q.list.all(guildId),
    addPanel: ({ messageId, guildId, channelId, title, description, createdBy, now = Date.now() }) => q.addPanel.run(messageId, guildId, channelId, title, description, createdBy, now),
    panels: (guildId) => q.panels.all(guildId),
    removePanel: (messageId) => q.removePanel.run(messageId),
  };
}

export function createBoostStore(db) {
  const q = {
    record: db.prepare('INSERT INTO boost_events (guild_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)'),
    recent: db.prepare('SELECT * FROM boost_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?'),
  };
  return {
    record: (guildId, userId, kind, now = Date.now()) => q.record.run(guildId, userId, kind, now),
    recent: (guildId, limit = 10) => q.recent.all(guildId, limit),
  };
}

export const SUGGESTION_STATUSES = Object.freeze({
  pending: { label: 'Pending', emoji: '🕓', colour: 0x5865f2, open: true },
  considered: { label: 'Under consideration', emoji: '🤔', colour: 0xfee75c, open: true },
  approved: { label: 'Approved', emoji: '✅', colour: 0x57f287, open: false },
  denied: { label: 'Denied', emoji: '❌', colour: 0xed4245, open: false },
  implemented: { label: 'Implemented', emoji: '🚀', colour: 0x9b59b6, open: false },
  deleted: { label: 'Deleted', emoji: '🗑️', colour: 0x99aab5, open: false },
});

export function createSuggestionStore(db) {
  const q = {
    next: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM suggestions WHERE guild_id = ?'),
    insert: db.prepare('INSERT INTO suggestions (guild_id, number, author_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    byId: db.prepare('SELECT * FROM suggestions WHERE id = ?'),
    byNumber: db.prepare('SELECT * FROM suggestions WHERE guild_id = ? AND number = ?'),
    setMessage: db.prepare('UPDATE suggestions SET channel_id = ?, message_id = ?, thread_id = ? WHERE id = ?'),
    vote: db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?'),
    upsertVote: db.prepare(`
      INSERT INTO suggestion_votes (suggestion_id, user_id, vote, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (suggestion_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at
    `),
    removeVote: db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?'),
    counts: db.prepare('SELECT COALESCE(SUM(vote = 1), 0) AS up, COALESCE(SUM(vote = -1), 0) AS down FROM suggestion_votes WHERE suggestion_id = ?'),
    respond: db.prepare(`UPDATE suggestions SET status = ?, staff_id = ?, staff_response = ?, updated_at = ? WHERE id = ? AND status != 'deleted'`),
    remove: db.prepare(`UPDATE suggestions SET status = 'deleted', updated_at = ? WHERE id = ? AND author_id = ? AND status = 'pending'`),
  };
  return {
    create({ guildId, authorId, content, now = Date.now() }) {
      return db.transaction(() => {
        const number = q.next.get(guildId).n;
        return q.byId.get(Number(q.insert.run(guildId, number, authorId, content, now, now).lastInsertRowid));
      }).immediate();
    },
    get: (id) => q.byId.get(id),
    getByNumber: (guildId, number) => q.byNumber.get(guildId, number),
    setMessage: (id, channelId, messageId, threadId = null) => q.setMessage.run(channelId, messageId, threadId, id),
    counts: (id) => q.counts.get(id),
    /**
     * Records a member's vote. Voting the same way again removes the vote; voting the
     * other way switches it. Only open suggestions accept votes.
     */
    vote(id, userId, value, now = Date.now()) {
      if (value !== 1 && value !== -1) throw new Error('Vote must be 1 or -1');
      return db.transaction(() => {
        const suggestion = q.byId.get(id);
        if (!suggestion || !SUGGESTION_STATUSES[suggestion.status].open) throw new UserError('Voting on this suggestion has closed.', { title: 'Voting closed' });
        const existing = q.vote.get(id, userId);
        let current = value;
        if (existing?.vote === value) {
          q.removeVote.run(id, userId);
          current = 0;
        } else {
          q.upsertVote.run(id, userId, value, now);
        }
        return { ...q.counts.get(id), current };
      })();
    },
    respond(id, status, staffId, response = null, now = Date.now()) {
      if (!SUGGESTION_STATUSES[status] || status === 'deleted' || status === 'pending') throw new Error(`Invalid suggestion status ${status}`);
      if (!q.respond.run(status, staffId, response, now, id).changes) throw new UserError('That suggestion was deleted.', { title: 'Suggestion deleted' });
      return q.byId.get(id);
    },
    /** Authors can delete their own suggestion while it is still pending. */
    remove: (id, userId, now = Date.now()) => q.remove.run(now, id, userId).changes > 0,
  };
}

export function createGiveawayStore(db) {
  const parse = (row) => (row ? { ...row, winners: JSON.parse(row.winners) } : row);
  const q = {
    insert: db.prepare(`
      INSERT INTO giveaways (guild_id, channel_id, host_id, prize, winner_count, required_role_id, ends_at, created_at)
      VALUES (@guildId, @channelId, @hostId, @prize, @winnerCount, @requiredRoleId, @endsAt, @now)
    `),
    get: db.prepare('SELECT * FROM giveaways WHERE id = ?'),
    setMessage: db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?'),
    entry: db.prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
    enter: db.prepare('INSERT INTO giveaway_entries (giveaway_id, user_id, created_at) VALUES (?, ?, ?)'),
    leave: db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
    entries: db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY created_at'),
    count: db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?'),
    finish: db.prepare(`UPDATE giveaways SET status = 'ended', winners = ?, ended_at = ? WHERE id = ? AND status = 'active'`),
    setWinners: db.prepare(`UPDATE giveaways SET winners = ?, announced_at = NULL WHERE id = ? AND status = 'ended'`),
    announced: db.prepare('UPDATE giveaways SET announced_at = ? WHERE id = ?'),
    cancel: db.prepare(`UPDATE giveaways SET status = 'cancelled', ended_at = ? WHERE id = ? AND status = 'active'`),
    active: db.prepare(`SELECT * FROM giveaways WHERE guild_id = ? AND status = 'active' ORDER BY ends_at`),
  };
  return {
    create(data) {
      return parse(q.get.get(Number(q.insert.run({ requiredRoleId: null, now: Date.now(), ...data }).lastInsertRowid)));
    },
    get: (id) => parse(q.get.get(id)),
    setMessage: (id, messageId) => q.setMessage.run(messageId, id),
    /** Enters, or leaves if already entered. Only while the giveaway is running. */
    toggleEntry(id, userId, now = Date.now()) {
      return db.transaction(() => {
        const giveaway = q.get.get(id);
        if (!giveaway || giveaway.status !== 'active' || giveaway.ends_at <= now) throw new UserError('This giveaway has ended.', { title: 'Giveaway ended' });
        const entered = !q.entry.get(id, userId);
        if (entered) q.enter.run(id, userId, now);
        else q.leave.run(id, userId);
        return { entered, count: q.count.get(id).n };
      })();
    },
    entries: (id) => q.entries.all(id).map((r) => r.user_id),
    count: (id) => q.count.get(id).n,
    /** Marks the giveaway ended with its winners. Returns false if it was already ended or cancelled. */
    finish: (id, winners, now = Date.now()) => q.finish.run(JSON.stringify(winners), now, id).changes > 0,
    setWinners: (id, winners) => q.setWinners.run(JSON.stringify(winners), id).changes > 0,
    markAnnounced: (id, now = Date.now()) => q.announced.run(now, id),
    cancel: (id, now = Date.now()) => q.cancel.run(now, id).changes > 0,
    listActive: (guildId) => q.active.all(guildId).map(parse),
  };
}

export const MAX_POLL_OPTIONS = 10;

export function createPollStore(db) {
  const parse = (row) => (row ? { ...row, options: JSON.parse(row.options), multiple: Boolean(row.multiple), anonymous: Boolean(row.anonymous) } : row);
  const q = {
    insert: db.prepare(`
      INSERT INTO polls (guild_id, channel_id, author_id, question, options, multiple, anonymous, ends_at, created_at)
      VALUES (@guildId, @channelId, @authorId, @question, @options, @multiple, @anonymous, @endsAt, @now)
    `),
    get: db.prepare('SELECT * FROM polls WHERE id = ?'),
    setMessage: db.prepare('UPDATE polls SET message_id = ? WHERE id = ?'),
    userVotes: db.prepare('SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
    add: db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_index, created_at) VALUES (?, ?, ?, ?)'),
    removeOne: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ? AND option_index = ?'),
    removeAll: db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?'),
    counts: db.prepare('SELECT option_index, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY option_index'),
    voterCount: db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM poll_votes WHERE poll_id = ?'),
    voters: db.prepare('SELECT option_index, user_id FROM poll_votes WHERE poll_id = ? ORDER BY created_at'),
    close: db.prepare(`UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'`),
  };
  return {
    create({ guildId, channelId, authorId, question, options, multiple = false, anonymous = false, endsAt = null, now = Date.now() }) {
      if (options.length < 2 || options.length > MAX_POLL_OPTIONS) throw new UserError(`Polls need 2 to ${MAX_POLL_OPTIONS} options.`, { title: 'Invalid poll' });
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new UserError('Each poll option must be different.', { title: 'Invalid poll' });
      const id = Number(q.insert.run({
        guildId, channelId, authorId, question, options: JSON.stringify(options), multiple: multiple ? 1 : 0, anonymous: anonymous ? 1 : 0, endsAt, now,
      }).lastInsertRowid);
      return parse(q.get.get(id));
    },
    get: (id) => parse(q.get.get(id)),
    setMessage: (id, messageId) => q.setMessage.run(messageId, id),
    /**
     * Single choice: picking another option moves the vote; picking the same option removes it.
     * Multiple choice: each option toggles independently.
     * @returns {number[]} The member's selected options after the change.
     */
    vote(pollId, userId, index, now = Date.now()) {
      return db.transaction(() => {
        const poll = parse(q.get.get(pollId));
        if (!poll || poll.status !== 'open' || (poll.ends_at && poll.ends_at <= now)) throw new UserError('This poll has closed.', { title: 'Poll closed' });
        if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) throw new UserError('That option does not exist.', { title: 'Invalid option' });
        const current = q.userVotes.all(pollId, userId).map((r) => r.option_index);
        if (current.includes(index)) {
          q.removeOne.run(pollId, userId, index);
        } else {
          if (!poll.multiple) q.removeAll.run(pollId, userId);
          q.add.run(pollId, userId, index, now);
        }
        return q.userVotes.all(pollId, userId).map((r) => r.option_index).sort((a, b) => a - b);
      })();
    },
    results(pollId) {
      const poll = parse(q.get.get(pollId));
      const counts = poll.options.map(() => 0);
      for (const row of q.counts.all(pollId)) counts[row.option_index] = row.n;
      return { counts, voters: q.voterCount.get(pollId).n, totalVotes: counts.reduce((a, b) => a + b, 0) };
    },
    voters(pollId) {
      const byOption = new Map();
      for (const row of q.voters.all(pollId)) {
        if (!byOption.has(row.option_index)) byOption.set(row.option_index, []);
        byOption.get(row.option_index).push(row.user_id);
      }
      return byOption;
    },
    close: (id, now = Date.now()) => q.close.run(now, id).changes > 0,
  };
}

export function createStarboardStore(db) {
  const q = {
    get: db.prepare('SELECT * FROM starboard_entries WHERE message_id = ?'),
    upsert: db.prepare(`
      INSERT INTO starboard_entries (message_id, guild_id, channel_id, author_id, starboard_message_id, stars, created_at, updated_at)
      VALUES (@messageId, @guildId, @channelId, @authorId, @starboardMessageId, @stars, @now, @now)
      ON CONFLICT (message_id) DO UPDATE SET starboard_message_id = excluded.starboard_message_id, stars = excluded.stars, updated_at = excluded.updated_at
    `),
    remove: db.prepare('DELETE FROM starboard_entries WHERE message_id = ?'),
  };
  return {
    get: (messageId) => q.get.get(messageId),
    upsert: (entry) => q.upsert.run({ now: Date.now(), ...entry }),
    remove: (messageId) => q.remove.run(messageId),
  };
}

export function createBirthdayStore(db) {
  const q = {
    set: db.prepare(`
      INSERT INTO birthdays (guild_id, user_id, month, day, year, show_age, locked, set_by, updated_at)
      VALUES (@guildId, @userId, @month, @day, @year, @showAge, @locked, @setBy, @now)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET month = excluded.month, day = excluded.day, year = excluded.year,
        show_age = excluded.show_age, locked = excluded.locked, set_by = excluded.set_by, updated_at = excluded.updated_at
    `),
    get: db.prepare('SELECT * FROM birthdays WHERE guild_id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM birthdays WHERE guild_id = ? AND user_id = ?'),
    all: db.prepare('SELECT * FROM birthdays WHERE guild_id = ?'),
    claim: db.prepare('INSERT INTO birthday_announcements (guild_id, date, claimed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'),
    announcement: db.prepare('SELECT * FROM birthday_announcements WHERE guild_id = ? AND date = ?'),
    posted: db.prepare('UPDATE birthday_announcements SET posted_at = ? WHERE guild_id = ? AND date = ?'),
  };
  return {
    set: ({ guildId, userId, month, day, year = null, showAge = false, locked = true, setBy, now = Date.now() }) => q.set.run({
      guildId, userId, month, day, year, showAge: showAge ? 1 : 0, locked: locked ? 1 : 0, setBy, now,
    }),
    get: (guildId, userId) => q.get.get(guildId, userId),
    remove: (guildId, userId) => q.remove.run(guildId, userId).changes > 0,
    all: (guildId) => q.all.all(guildId),
    /** True for the first caller on a given local date. */
    claimAnnouncement: (guildId, date, now = Date.now()) => q.claim.run(guildId, date, now).changes > 0,
    announcement: (guildId, date) => q.announcement.get(guildId, date),
    markPosted: (guildId, date, now = Date.now()) => q.posted.run(now, guildId, date),
  };
}

export const MAX_TEMPLATES = 50;
const DRAFT_TTL_MS = 60 * 60_000;

export function createEmbedStore(db) {
  const q = {
    saveTemplate: db.prepare(`
      INSERT INTO embed_templates (guild_id, name, data, created_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, name) DO UPDATE SET data = excluded.data, created_by = excluded.created_by, updated_at = excluded.updated_at
    `),
    template: db.prepare('SELECT * FROM embed_templates WHERE guild_id = ? AND name = ?'),
    templates: db.prepare('SELECT name, created_by, updated_at FROM embed_templates WHERE guild_id = ? ORDER BY name'),
    templateCount: db.prepare('SELECT COUNT(*) AS n FROM embed_templates WHERE guild_id = ?'),
    deleteTemplate: db.prepare('DELETE FROM embed_templates WHERE guild_id = ? AND name = ?'),
    saveDraft: db.prepare(`
      INSERT INTO embed_drafts (id, guild_id, user_id, data, channel_id, edit_channel_id, edit_message_id, expires_at)
      VALUES (@id, @guildId, @userId, @data, @channelId, @editChannelId, @editMessageId, @expiresAt)
      ON CONFLICT (id) DO UPDATE SET data = excluded.data, channel_id = excluded.channel_id, expires_at = excluded.expires_at
    `),
    draft: db.prepare('SELECT * FROM embed_drafts WHERE id = ?'),
    deleteDraft: db.prepare('DELETE FROM embed_drafts WHERE id = ?'),
    pruneDrafts: db.prepare('DELETE FROM embed_drafts WHERE expires_at < ?'),
  };
  return {
    saveTemplate(guildId, name, data, userId, now = Date.now()) {
      return db.transaction(() => {
        if (!q.template.get(guildId, name) && q.templateCount.get(guildId).n >= MAX_TEMPLATES) {
          throw new UserError(`A server can save at most ${MAX_TEMPLATES} embed templates.`, { title: 'Too many templates' });
        }
        q.saveTemplate.run(guildId, name, JSON.stringify(data), userId, now);
      })();
    },
    template(guildId, name) {
      const row = q.template.get(guildId, name);
      return row ? { ...row, data: JSON.parse(row.data) } : null;
    },
    templates: (guildId) => q.templates.all(guildId),
    deleteTemplate: (guildId, name) => q.deleteTemplate.run(guildId, name).changes > 0,
    saveDraft({ id, guildId, userId, data, channelId = null, editChannelId = null, editMessageId = null, now = Date.now() }) {
      q.saveDraft.run({ id, guildId, userId, data: JSON.stringify(data), channelId, editChannelId, editMessageId, expiresAt: now + DRAFT_TTL_MS });
    },
    /** A draft owned by `userId` that has not expired, or null. */
    draft(id, userId, now = Date.now()) {
      const row = q.draft.get(id);
      if (!row || row.user_id !== userId || row.expires_at < now) return null;
      return { ...row, data: JSON.parse(row.data) };
    },
    deleteDraft: (id) => q.deleteDraft.run(id),
    pruneDrafts: (now = Date.now()) => q.pruneDrafts.run(now).changes,
  };
}
