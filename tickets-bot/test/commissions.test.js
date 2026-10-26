import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '@lyss/shared/errorReporter.js';
import {
  canTransition, createCommissionService, formatMoney, normaliseTags, parseAmount, tagList,
} from '../src/services/commissionService.js';
import { buildPanel, commissionAvailability } from '../src/services/panelService.js';
import { createTicketService } from '../src/services/ticketService.js';
import { fakeCtx, ticketsDb } from './helpers.js';

const G = 'guild-1';

function setup(db = ticketsDb()) {
  const tickets = createTicketService(db);
  const commissions = createCommissionService(db);
  let n = 0;
  const request = (clientId = `client-${(n += 1)}`) => {
    let commission;
    tickets.reserve({
      guildId: G,
      type: 'commissions',
      openerId: clientId,
      onReserved: (ticket) => { commission = commissions.create({ guildId: G, ticketId: ticket.id, clientId, projectType: 'Logo', description: 'A fox logo' }); },
    });
    return commission;
  };
  const quote = (commission, amountCents = 15_000) => commissions.createQuote({
    commissionId: commission.id, amountCents, currency: 'USD', description: 'Logo with 2 concepts', createdBy: 'lyss',
  });
  return { db, tickets, commissions, request, quote };
}

const accept = (commissions, q, userId, slots = 3) => commissions.respondToQuote(q.id, { userId, response: 'accept', slots });

test('parseAmount accepts sensible prices and rejects everything else', () => {
  assert.equal(parseAmount('150'), 15_000);
  assert.equal(parseAmount('99.5'), 9_950);
  assert.equal(parseAmount('1,500.25'), 150_025);
  for (const bad of ['', '0', '-5', '1.234', 'ten', '1e3', '100000001', '12.']) assert.equal(parseAmount(bad), null, bad);
});

test('formatMoney falls back for unknown currencies', () => {
  assert.match(formatMoney(15_000, 'USD'), /150\.00/);
  assert.equal(formatMoney(15_000, 'ZZZZ'), '150.00 ZZZZ');
});

test('tags are normalised and matched exactly', () => {
  assert.deepEqual(normaliseTags('Logo, branding  Logo, 3D!'), ['logo', 'branding', '3d']);
  const { commissions } = setup();
  commissions.addPortfolio({ guildId: G, title: 'A', tags: ['logo'], createdBy: 'lyss' });
  commissions.addPortfolio({ guildId: G, title: 'B', tags: ['logos'], createdBy: 'lyss' });
  commissions.addPortfolio({ guildId: G, title: 'C', createdBy: 'lyss' });
  assert.deepEqual(commissions.listPortfolio(G, 'logo').map((e) => e.title), ['A']);
  assert.equal(commissions.listPortfolio(G).length, 3);
  assert.deepEqual(tagList(commissions.listPortfolio(G, 'logos')[0].tags), ['logos']);
  assert.equal(commissions.removePortfolio('other-guild', 1), false, 'cannot remove another guild\'s entry');
});

test('workflow transitions follow Request → Quote → Accept → Progress → Delivered → Completed', () => {
  assert.equal(canTransition('requested', 'quoted'), true);
  assert.equal(canTransition('requested', 'accepted'), false);
  assert.equal(canTransition('in_progress', 'revisions'), true);
  assert.equal(canTransition('revisions', 'in_progress'), true);
  assert.equal(canTransition('delivered', 'completed'), true);
  assert.equal(canTransition('completed', 'cancelled'), false);
  assert.equal(canTransition('cancelled', 'in_progress'), false);
});

test('a full commission lifecycle with audit events', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const q = quote(c);
  assert.equal(commissions.get(c.id).status, 'quoted');
  accept(commissions, q, 'alice');
  for (const to of ['in_progress', 'revisions', 'in_progress', 'delivered', 'completed']) {
    commissions.transition(c.id, to, { actorId: 'lyss' });
  }
  const done = commissions.get(c.id);
  assert.equal(done.status, 'completed');
  assert.ok(done.completed_at);
  assert.deepEqual(commissions.events(c.id).map((e) => e.to_status),
    ['requested', 'quoted', 'accepted', 'in_progress', 'revisions', 'in_progress', 'delivered', 'completed']);
});

test('invalid status changes are refused', () => {
  const { commissions, request } = setup();
  const c = request();
  assert.throws(() => commissions.transition(c.id, 'completed', { actorId: 'lyss' }), (e) => e instanceof UserError && /cannot move/.test(e.message));
  commissions.transition(c.id, 'cancelled', { actorId: 'lyss', note: 'Client unavailable' });
  assert.equal(commissions.get(c.id).cancelled_reason, 'Client unavailable');
  assert.throws(() => commissions.transition(c.id, 'in_progress', { actorId: 'lyss' }), UserError);
});

test('a new quote supersedes the previous pending one', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const q1 = quote(c, 10_000);
  const q2 = quote(c, 12_000);
  assert.equal(commissions.getQuote(q1.id).status, 'superseded');
  assert.equal(commissions.getQuote(q2.id).status, 'pending');
  assert.equal(q2.number, q1.number + 1);
  assert.throws(() => accept(commissions, q1, 'alice'), /no longer waiting/);
});

test('only the client can respond, and only once', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const q = quote(c);
  assert.throws(() => accept(commissions, q, 'mallory'), /Only the client/);
  accept(commissions, q, 'alice');
  assert.throws(() => accept(commissions, q, 'alice'), /no longer waiting/);
  assert.throws(() => quote(c), /before one is accepted/, 'no new quotes after acceptance');
});

test('declining or requesting changes keeps the commission quoted', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const q1 = quote(c);
  commissions.respondToQuote(q1.id, { userId: 'alice', response: 'changes', note: 'Cheaper please', slots: 3 });
  assert.equal(commissions.getQuote(q1.id).response_note, 'Cheaper please');
  const q2 = quote(c, 9_000);
  commissions.respondToQuote(q2.id, { userId: 'alice', response: 'reject', slots: 3 });
  assert.equal(commissions.get(c.id).status, 'quoted');
});

test('accepting a quote respects the slot limit', () => {
  const { commissions, request, quote } = setup();
  const a = request('a');
  const b = request('b');
  const qa = quote(a);
  const qb = quote(b);
  accept(commissions, qa, 'a', 1);
  assert.equal(commissions.activeCount(G), 1);
  assert.throws(() => accept(commissions, qb, 'b', 1), /slots are full/);
  assert.equal(commissions.getQuote(qb.id).status, 'pending', 'failed acceptance changes nothing');

  commissions.transition(a.id, 'cancelled', { actorId: 'lyss', note: 'x' });
  accept(commissions, qb, 'b', 1);
  assert.equal(commissions.get(b.id).status, 'accepted');
});

test('invoices: accepted quotes only, one per quote, payment status is idempotent', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const q = quote(c, 25_050);
  assert.throws(() => commissions.createInvoice({ guildId: G, quoteNumber: q.number, createdBy: 'lyss' }), /not been accepted/);
  assert.throws(() => commissions.createInvoice({ guildId: G, quoteNumber: 999, createdBy: 'lyss' }), /does not exist/);
  accept(commissions, q, 'alice');

  const invoice = commissions.createInvoice({ guildId: G, quoteNumber: q.number, createdBy: 'lyss' });
  assert.equal(invoice.amount_cents, 25_050);
  assert.equal(invoice.status, 'unpaid');
  assert.throws(() => commissions.createInvoice({ guildId: G, quoteNumber: q.number, createdBy: 'lyss' }), /already exists/);

  assert.equal(commissions.setInvoicePaid(invoice.id, true, 'lyss'), true);
  assert.equal(commissions.setInvoicePaid(invoice.id, true, 'lyss'), false);
  assert.ok(commissions.getInvoiceByNumber(G, invoice.number).paid_at);
  assert.equal(commissions.setInvoicePaid(invoice.id, false, 'lyss'), true);
  assert.equal(commissions.getInvoiceByNumber(G, invoice.number).paid_at, null);
});

test('reviews: client only, after completion, once', () => {
  const { commissions, request, quote } = setup();
  const c = request('alice');
  const review = () => commissions.addReview({ commissionId: c.id, clientId: 'alice', rating: 5, comment: 'Lovely' });
  assert.throws(review, /once the commission is completed/);
  accept(commissions, quote(c), 'alice');
  for (const to of ['in_progress', 'delivered', 'completed']) commissions.transition(c.id, to, { actorId: 'lyss' });

  assert.throws(() => commissions.addReview({ commissionId: c.id, clientId: 'mallory', rating: 5 }), /Only the client/);
  assert.throws(() => commissions.addReview({ commissionId: c.id, clientId: 'alice', rating: 0 }), /1 to 5/);
  review();
  assert.throws(review, /already reviewed/);
  assert.deepEqual(commissions.reviewSummary(G), { average: 5, count: 1 });
});

test('commission availability and the panel counter', () => {
  const ctx = fakeCtx();
  const { commissions, request, quote } = setup(ctx.db);
  ctx.guildConfig.set(G, 'commissions.slots', 1);

  const panelButton = () => buildPanel(ctx, G, 'commissions').components[0].toJSON().components[0];
  assert.equal(commissionAvailability(ctx, G).accepting, true);
  assert.equal(panelButton().disabled, false);

  accept(commissions, quote(request('a')), 'a', 1);
  assert.deepEqual(commissionAvailability(ctx, G), { open: true, slots: 1, active: 1, free: 0, accepting: false });
  assert.equal(panelButton().disabled, true);
  assert.match(buildPanel(ctx, G, 'commissions').embeds[0].data.fields[0].value, /All 1 slots taken/);

  ctx.guildConfig.set(G, 'commissions.open', false);
  assert.match(buildPanel(ctx, G, 'commissions').embeds[0].data.fields[0].value, /Closed/);
  assert.equal(buildPanel(ctx, G, 'support').components[0].toJSON().components[0].disabled, false);
});
