import { UserError } from '@lyss/shared/errorReporter.js';
import { ticketType } from './ticketTypes.js';

/**
 * Database operations for tickets. Every state change is a conditional UPDATE,
 * so concurrent clicks (two people pressing Close) can only succeed once.
 */
export function createTicketService(db) {
  const q = {
    get: db.prepare('SELECT * FROM tickets WHERE id = ?'),
    byChannel: db.prepare(`SELECT * FROM tickets WHERE channel_id = ? AND status != 'deleted'`),
    findOpen: db.prepare(`SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND type = ? AND status = 'open'`),
    nextNumber: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM tickets WHERE guild_id = ?'),
    insert: db.prepare(`
      INSERT INTO tickets (guild_id, number, type, opener_id, subject, created_at, last_activity_at)
      VALUES (@guildId, @number, @type, @openerId, @subject, @now, @now)
    `),
    release: db.prepare('DELETE FROM tickets WHERE id = ? AND channel_id IS NULL'),
    attach: db.prepare('UPDATE tickets SET channel_id = ? WHERE id = ? AND channel_id IS NULL'),
    claim: db.prepare(`UPDATE tickets SET claimed_by = ? WHERE id = ? AND status = 'open' AND claimed_by IS NULL`),
    unclaim: db.prepare(`UPDATE tickets SET claimed_by = NULL WHERE id = ? AND status = 'open' AND claimed_by IS NOT NULL`),
    close: db.prepare(`
      UPDATE tickets SET status = 'closed', closed_at = @now, closed_by = @by, close_reason = @reason
      WHERE id = @id AND status = 'open'
    `),
    reopen: db.prepare(`
      UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL, close_reason = NULL,
        reminded_at = NULL, last_activity_at = @now, reopened_count = reopened_count + 1
      WHERE id = @id AND status = 'closed'
    `),
    markDeleted: db.prepare(`UPDATE tickets SET status = 'deleted', deleted_at = ? WHERE id = ? AND status != 'deleted'`),
    transcript: db.prepare('UPDATE tickets SET transcript_path = ?, transcript_url = ? WHERE id = ?'),
    touch: db.prepare(`UPDATE tickets SET last_activity_at = ?, reminded_at = NULL WHERE channel_id = ? AND status = 'open'`),
    markReminded: db.prepare(`UPDATE tickets SET reminded_at = ? WHERE id = ? AND status = 'open' AND reminded_at IS NULL`),
    listOpen: db.prepare(`SELECT * FROM tickets WHERE status = 'open' AND channel_id IS NOT NULL`),

    addMember: db.prepare(`INSERT INTO ticket_members (ticket_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`),
    removeMember: db.prepare('DELETE FROM ticket_members WHERE ticket_id = ? AND user_id = ?'),
    members: db.prepare('SELECT * FROM ticket_members WHERE ticket_id = ? ORDER BY added_at'),

    blacklistGet: db.prepare('SELECT * FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?'),
    blacklistAdd: db.prepare(`
      INSERT INTO ticket_blacklist (guild_id, user_id, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by, created_at = excluded.created_at
    `),
    blacklistRemove: db.prepare('DELETE FROM ticket_blacklist WHERE guild_id = ? AND user_id = ?'),
    blacklistList: db.prepare('SELECT * FROM ticket_blacklist WHERE guild_id = ? ORDER BY created_at DESC'),

    rate: db.prepare(`INSERT INTO ticket_ratings (ticket_id, user_id, rating, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (ticket_id) DO NOTHING`),
    rating: db.prepare('SELECT * FROM ticket_ratings WHERE ticket_id = ?'),
  };

  const stats = {
    byTypeStatus: db.prepare('SELECT type, status, COUNT(*) AS n FROM tickets WHERE guild_id = ? GROUP BY type, status'),
    openedSince: db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND created_at >= ?'),
    resolution: db.prepare('SELECT AVG(closed_at - created_at) AS avg, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND closed_at IS NOT NULL AND closed_at >= ?'),
    ratings: db.prepare('SELECT AVG(r.rating) AS avg, COUNT(*) AS n FROM ticket_ratings r JOIN tickets t ON t.id = r.ticket_id WHERE t.guild_id = ?'),
    claimers: db.prepare('SELECT claimed_by, COUNT(*) AS n FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL GROUP BY claimed_by ORDER BY n DESC LIMIT 5'),
    blacklisted: db.prepare('SELECT COUNT(*) AS n FROM ticket_blacklist WHERE guild_id = ?'),
  };

  return {
    get: (id) => q.get.get(id),
    getByChannel: (channelId) => q.byChannel.get(channelId),
    findOpen: (guildId, openerId, type) => q.findOpen.get(guildId, openerId, type),

    /**
     * Reserves a ticket number and row before the Discord channel exists, so two
     * simultaneous clicks cannot create two tickets. `onReserved(ticket)` runs in the
     * same transaction (used to create the linked commission record).
     */
    reserve({ guildId, type, openerId, subject = null, now = Date.now(), onReserved }) {
      ticketType(type);
      return db.transaction(() => {
        if (q.findOpen.get(guildId, openerId, type)) {
          throw new UserError(`You already have an open ${ticketType(type).label.toLowerCase()} ticket.`, { title: 'Ticket already open' });
        }
        const number = q.nextNumber.get(guildId).n;
        const id = Number(q.insert.run({ guildId, number, type, openerId, subject, now }).lastInsertRowid);
        const ticket = q.get.get(id);
        onReserved?.(ticket);
        return ticket;
      }).immediate();
    },

    /** Removes a reservation whose channel could not be created. */
    release: (id) => q.release.run(id).changes > 0,
    attachChannel: (id, channelId) => q.attach.run(channelId, id).changes > 0,

    claim: (id, userId) => q.claim.run(userId, id).changes > 0,
    unclaim: (id) => q.unclaim.run(id).changes > 0,
    close: (id, { by, reason = null, now = Date.now() }) => q.close.run({ id, by, reason, now }).changes > 0,
    reopen(id, now = Date.now()) {
      try {
        return q.reopen.run({ id, now }).changes > 0;
      } catch (error) {
        // The opener has since opened another ticket of the same type.
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new UserError('The opener already has another open ticket of this type. Close it first.', { title: 'Cannot reopen' });
        }
        throw error;
      }
    },
    markDeleted: (id, now = Date.now()) => q.markDeleted.run(now, id).changes > 0,
    setTranscript: (id, path, url) => q.transcript.run(path, url, id),

    touch: (channelId, now = Date.now()) => q.touch.run(now, channelId).changes > 0,
    markReminded: (id, now = Date.now()) => q.markReminded.run(now, id).changes > 0,
    listOpen: () => q.listOpen.all(),

    addMember: (id, userId, addedBy, now = Date.now()) => q.addMember.run(id, userId, addedBy, now).changes > 0,
    removeMember: (id, userId) => q.removeMember.run(id, userId).changes > 0,
    members: (id) => q.members.all(id),

    isBlacklisted: (guildId, userId) => q.blacklistGet.get(guildId, userId),
    blacklist: (guildId, userId, reason, addedBy, now = Date.now()) => q.blacklistAdd.run(guildId, userId, reason, addedBy, now),
    unblacklist: (guildId, userId) => q.blacklistRemove.run(guildId, userId).changes > 0,
    listBlacklist: (guildId) => q.blacklistList.all(guildId),

    /** Records the opener's rating once. Returns false if the ticket was already rated. */
    rate(ticketId, userId, rating, now = Date.now()) {
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new UserError('Ratings must be between 1 and 5 stars.');
      return q.rate.run(ticketId, userId, rating, now).changes > 0;
    },
    getRating: (ticketId) => q.rating.get(ticketId),

    stats(guildId, now = Date.now()) {
      const DAY = 86_400_000;
      const counts = {};
      for (const row of stats.byTypeStatus.all(guildId)) {
        counts[row.type] ??= { open: 0, closed: 0, deleted: 0 };
        counts[row.type][row.status] = row.n;
      }
      return {
        counts,
        opened7d: stats.openedSince.get(guildId, now - 7 * DAY).n,
        opened30d: stats.openedSince.get(guildId, now - 30 * DAY).n,
        resolution30d: stats.resolution.get(guildId, now - 30 * DAY),
        ratings: stats.ratings.get(guildId),
        claimers: stats.claimers.all(guildId),
        blacklisted: stats.blacklisted.get(guildId).n,
      };
    },
  };
}
