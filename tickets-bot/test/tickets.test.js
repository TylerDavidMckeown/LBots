import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '@lyss/shared/errorReporter.js';
import { inactivityAction } from '../src/jobs/inactivity.js';
import { createTicketService } from '../src/services/ticketService.js';
import { ticketsDb } from './helpers.js';

const G = 'guild-1';
const HOUR = 3_600_000;

function setup() {
  const db = ticketsDb();
  return { db, tickets: createTicketService(db) };
}

const open = (tickets, openerId = 'u1', type = 'support', guildId = G) => tickets.reserve({ guildId, type, openerId, subject: 'Help' });

test('ticket numbers increase per guild', () => {
  const { tickets } = setup();
  assert.equal(open(tickets, 'u1').number, 1);
  assert.equal(open(tickets, 'u2').number, 2);
  assert.equal(open(tickets, 'u1', 'support', 'guild-2').number, 1);
});

test('a member can only have one open ticket of each type', () => {
  const { tickets } = setup();
  open(tickets, 'u1', 'support');
  assert.throws(() => open(tickets, 'u1', 'support'), (e) => e instanceof UserError && /already have an open/.test(e.message));
  assert.doesNotThrow(() => open(tickets, 'u1', 'contact'), 'a different type is allowed');
});

test('the database itself rejects a second open ticket', () => {
  const { db, tickets } = setup();
  open(tickets, 'u1');
  assert.throws(() => db.prepare(`INSERT INTO tickets (guild_id, number, type, opener_id, created_at, last_activity_at) VALUES (?, 99, 'support', 'u1', 0, 0)`).run(G), /UNIQUE/);
});

test('a closed ticket frees the slot for a new one, and reopening the old one is then refused', () => {
  const { tickets } = setup();
  const first = open(tickets, 'u1');
  tickets.attachChannel(first.id, 'c1');
  assert.equal(tickets.close(first.id, { by: 'staff' }), true);
  const second = open(tickets, 'u1');
  assert.equal(second.number, 2);
  assert.throws(() => tickets.reopen(first.id), (e) => e instanceof UserError && /another open ticket/.test(e.message));
});

test('closing and reopening only succeed once', () => {
  const { tickets } = setup();
  const t = open(tickets);
  assert.equal(tickets.close(t.id, { by: 'staff', reason: 'Solved', now: 1000 }), true);
  assert.equal(tickets.close(t.id, { by: 'staff2' }), false, 'second close is a no-op');
  const closed = tickets.get(t.id);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closed_by, 'staff');
  assert.equal(closed.close_reason, 'Solved');

  assert.equal(tickets.reopen(t.id, 2000), true);
  assert.equal(tickets.reopen(t.id), false);
  const reopened = tickets.get(t.id);
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.closed_at, null);
  assert.equal(reopened.reopened_count, 1);
  assert.equal(reopened.last_activity_at, 2000);
});

test('claims are exclusive', () => {
  const { tickets } = setup();
  const t = open(tickets);
  assert.equal(tickets.claim(t.id, 'staff-a'), true);
  assert.equal(tickets.claim(t.id, 'staff-b'), false);
  assert.equal(tickets.get(t.id).claimed_by, 'staff-a');
  assert.equal(tickets.unclaim(t.id), true);
  assert.equal(tickets.claim(t.id, 'staff-b'), true);
});

test('reservations are released only before a channel is attached', () => {
  const { tickets } = setup();
  const a = open(tickets, 'u1');
  assert.equal(tickets.release(a.id), true);
  assert.equal(tickets.get(a.id), undefined);
  const b = open(tickets, 'u1');
  tickets.attachChannel(b.id, 'c1');
  assert.equal(tickets.release(b.id), false);
  assert.equal(tickets.getByChannel('c1').id, b.id);
});

test('a failed commission insert rolls back the ticket reservation', () => {
  const { tickets } = setup();
  assert.throws(() => tickets.reserve({ guildId: G, type: 'commissions', openerId: 'u1', onReserved: () => { throw new Error('insert failed'); } }), /insert failed/);
  assert.equal(tickets.findOpen(G, 'u1', 'commissions'), undefined);
});

test('activity resets the reminder and reminders are recorded once', () => {
  const { tickets } = setup();
  const t = open(tickets);
  tickets.attachChannel(t.id, 'c1');
  assert.equal(tickets.markReminded(t.id, 5000), true);
  assert.equal(tickets.markReminded(t.id, 6000), false);
  assert.equal(tickets.touch('c1', 7000), true);
  const after = tickets.get(t.id);
  assert.equal(after.reminded_at, null);
  assert.equal(after.last_activity_at, 7000);
  tickets.close(t.id, { by: 'x' });
  assert.equal(tickets.touch('c1', 8000), false, 'closed tickets are not touched');
});

test('ratings are 1–5 and recorded once', () => {
  const { tickets } = setup();
  const t = open(tickets);
  assert.throws(() => tickets.rate(t.id, 'u1', 6), UserError);
  assert.equal(tickets.rate(t.id, 'u1', 4), true);
  assert.equal(tickets.rate(t.id, 'u1', 5), false);
  assert.equal(tickets.getRating(t.id).rating, 4);
});

test('blacklist add, update, list and remove', () => {
  const { tickets } = setup();
  tickets.blacklist(G, 'u9', 'Spam', 'mod');
  tickets.blacklist(G, 'u9', 'Repeated spam', 'mod');
  assert.equal(tickets.isBlacklisted(G, 'u9').reason, 'Repeated spam');
  assert.equal(tickets.listBlacklist(G).length, 1);
  assert.equal(tickets.isBlacklisted('guild-2', 'u9'), undefined);
  assert.equal(tickets.unblacklist(G, 'u9'), true);
  assert.equal(tickets.unblacklist(G, 'u9'), false);
});

test('members can be added once and removed', () => {
  const { tickets } = setup();
  const t = open(tickets);
  assert.equal(tickets.addMember(t.id, 'u5', 'staff'), true);
  assert.equal(tickets.addMember(t.id, 'u5', 'staff'), false);
  assert.deepEqual(tickets.members(t.id).map((m) => m.user_id), ['u5']);
  assert.equal(tickets.removeMember(t.id, 'u5'), true);
});

test('stats summarise tickets, ratings and claimers', () => {
  const { tickets } = setup();
  const a = open(tickets, 'u1');
  const b = open(tickets, 'u2');
  open(tickets, 'u3', 'contact');
  tickets.claim(a.id, 'staff');
  tickets.claim(b.id, 'staff');
  tickets.close(a.id, { by: 'staff', now: a.created_at + HOUR });
  tickets.rate(a.id, 'u1', 5);
  tickets.blacklist(G, 'u9', null, 'mod');
  const s = tickets.stats(G, Date.now() + 1000);
  assert.deepEqual(s.counts.support, { open: 1, closed: 1, deleted: 0 });
  assert.equal(s.counts.contact.open, 1);
  assert.equal(s.opened7d, 3);
  assert.equal(s.resolution30d.n, 1);
  assert.equal(Math.round(s.resolution30d.avg), HOUR);
  assert.equal(s.ratings.avg, 5);
  assert.deepEqual(s.claimers, [{ claimed_by: 'staff', n: 2 }]);
  assert.equal(s.blacklisted, 1);
});

test('inactivity: remind after the quiet period, close only after a quiet reminder window', () => {
  const settings = { reminderMs: 48 * HOUR, closeMs: 24 * HOUR, autoClose: true };
  const base = { type: 'support', last_activity_at: 0, reminded_at: null };
  assert.equal(inactivityAction(base, { ...settings, now: 47 * HOUR }), null);
  assert.equal(inactivityAction(base, { ...settings, now: 48 * HOUR }), 'remind');

  const reminded = { ...base, reminded_at: 48 * HOUR };
  assert.equal(inactivityAction(reminded, { ...settings, now: 71 * HOUR }), null);
  assert.equal(inactivityAction(reminded, { ...settings, now: 72 * HOUR }), 'close');
  assert.equal(inactivityAction(reminded, { ...settings, autoClose: false, now: 100 * HOUR }), null);
  assert.equal(inactivityAction({ ...reminded, last_activity_at: 50 * HOUR }, { ...settings, now: 100 * HOUR }), null, 'activity after the reminder prevents closing');
});

test('inactivity never applies to commission or contact tickets', () => {
  const settings = { reminderMs: HOUR, closeMs: HOUR, autoClose: true, now: 1000 * HOUR };
  assert.equal(inactivityAction({ type: 'commissions', last_activity_at: 0, reminded_at: null }, settings), null);
  assert.equal(inactivityAction({ type: 'contact', last_activity_at: 0, reminded_at: null }, settings), null);
});
