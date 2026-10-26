import { UserError } from '@lyss/shared/errorReporter.js';

export const COMMISSION_STATUSES = Object.freeze({
  requested: { label: 'Requested', emoji: '📝' },
  quoted: { label: 'Quoted', emoji: '💬' },
  accepted: { label: 'Accepted', emoji: '🤝' },
  in_progress: { label: 'In progress', emoji: '🛠️' },
  revisions: { label: 'Revisions', emoji: '🔁' },
  delivered: { label: 'Delivered', emoji: '📦' },
  completed: { label: 'Completed', emoji: '✅' },
  cancelled: { label: 'Cancelled', emoji: '🚫' },
});

/** Statuses that occupy a commission slot. */
export const ACTIVE_STATUSES = ['accepted', 'in_progress', 'revisions', 'delivered'];

/** Statuses staff can set directly. `quoted` and `accepted` only happen through quotes; cancelling has its own command. */
export const MANUAL_STATUSES = ['in_progress', 'revisions', 'delivered', 'completed'];

/** Request → Quote → Acceptance → In progress ⇄ Revisions → Delivered → Completed, with cancellation from any open state. */
const TRANSITIONS = Object.freeze({
  requested: ['quoted', 'cancelled'],
  quoted: ['accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['revisions', 'delivered', 'cancelled'],
  revisions: ['in_progress', 'delivered', 'cancelled'],
  delivered: ['revisions', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
});

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusLabel(status) {
  const info = COMMISSION_STATUSES[status];
  return info ? `${info.emoji} ${info.label}` : status;
}

export const formatQuoteNumber = (n) => `Q-${String(n).padStart(4, '0')}`;
export const formatInvoiceNumber = (n) => `INV-${String(n).padStart(4, '0')}`;

const MAX_CENTS = 10_000_000_000; // 100,000,000.00

/** "150", "1,500.5" or "99.99" to integer cents. Returns null for anything else. */
export function parseAmount(input) {
  const text = String(input ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

export function formatMoney(cents, currency = 'USD') {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Normalises free-text tags to lowercase-dashed words. */
export function normaliseTags(input) {
  return [...new Set(String(input ?? '')
    .split(/[,\s]+/)
    .map((tag) => tag.toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean))]
    .slice(0, 10);
}

/** Splits a stored ",a,b," tag string. */
export function tagList(stored) {
  return String(stored ?? '').split(',').filter(Boolean);
}

export function createCommissionService(db) {
  const q = {
    insert: db.prepare(`
      INSERT INTO commissions (guild_id, ticket_id, client_id, project_type, description, budget, deadline, reference_links, created_at, updated_at)
      VALUES (@guildId, @ticketId, @clientId, @projectType, @description, @budget, @deadline, @references, @now, @now)
    `),
    get: db.prepare('SELECT * FROM commissions WHERE id = ?'),
    withTicket: db.prepare(`
      SELECT c.*, t.channel_id, t.number AS ticket_number, t.status AS ticket_status
      FROM commissions c JOIN tickets t ON t.id = c.ticket_id WHERE c.id = ?
    `),
    byChannel: db.prepare(`
      SELECT c.*, t.channel_id, t.number AS ticket_number, t.status AS ticket_status
      FROM commissions c JOIN tickets t ON t.id = c.ticket_id WHERE t.channel_id = ? AND t.status != 'deleted'
    `),
    activeCount: db.prepare(`SELECT COUNT(*) AS n FROM commissions WHERE guild_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(', ')})`),
    listOpen: db.prepare(`
      SELECT c.*, t.channel_id, t.status AS ticket_status FROM commissions c JOIN tickets t ON t.id = c.ticket_id
      WHERE c.guild_id = ? AND c.status NOT IN ('completed', 'cancelled') ORDER BY c.updated_at DESC LIMIT 25
    `),
    setStatus: db.prepare(`
      UPDATE commissions SET status = @to, updated_at = @now,
        completed_at = CASE WHEN @to = 'completed' THEN @now ELSE completed_at END,
        cancelled_reason = CASE WHEN @to = 'cancelled' THEN @note ELSE cancelled_reason END
      WHERE id = @id AND status = @from
    `),
    event: db.prepare('INSERT INTO commission_events (commission_id, from_status, to_status, actor_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    events: db.prepare('SELECT * FROM commission_events WHERE commission_id = ? ORDER BY id'),

    nextQuote: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM quotes WHERE guild_id = ?'),
    supersede: db.prepare(`UPDATE quotes SET status = 'superseded' WHERE commission_id = ? AND status IN ('pending', 'changes_requested')`),
    insertQuote: db.prepare(`
      INSERT INTO quotes (guild_id, number, commission_id, amount_cents, currency, description, revisions, delivery, created_by, created_at)
      VALUES (@guildId, @number, @commissionId, @amountCents, @currency, @description, @revisions, @delivery, @createdBy, @now)
    `),
    quoteById: db.prepare('SELECT * FROM quotes WHERE id = ?'),
    quoteByNumber: db.prepare('SELECT * FROM quotes WHERE guild_id = ? AND number = ?'),
    quotesFor: db.prepare('SELECT * FROM quotes WHERE commission_id = ? ORDER BY number'),
    respondQuote: db.prepare(`UPDATE quotes SET status = @status, response_note = @note, responded_at = @now WHERE id = @id AND status = 'pending'`),
    quoteMessage: db.prepare('UPDATE quotes SET channel_id = ?, message_id = ? WHERE id = ?'),

    nextInvoice: db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM invoices WHERE guild_id = ?'),
    invoiceForQuote: db.prepare('SELECT * FROM invoices WHERE quote_id = ?'),
    insertInvoice: db.prepare(`
      INSERT INTO invoices (guild_id, number, commission_id, quote_id, amount_cents, currency, created_by, created_at)
      VALUES (@guildId, @number, @commissionId, @quoteId, @amountCents, @currency, @createdBy, @now)
    `),
    invoiceById: db.prepare('SELECT * FROM invoices WHERE id = ?'),
    invoiceByNumber: db.prepare('SELECT * FROM invoices WHERE guild_id = ? AND number = ?'),
    invoicesFor: db.prepare('SELECT * FROM invoices WHERE commission_id = ? ORDER BY number'),
    setPaid: db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_marked_by = ? WHERE id = ? AND status = 'unpaid'`),
    setUnpaid: db.prepare(`UPDATE invoices SET status = 'unpaid', paid_at = NULL, paid_marked_by = ? WHERE id = ? AND status = 'paid'`),

    insertReview: db.prepare(`
      INSERT INTO reviews (guild_id, commission_id, client_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (commission_id) DO NOTHING
    `),
    reviewFor: db.prepare('SELECT * FROM reviews WHERE commission_id = ?'),
    reviewSummary: db.prepare('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE guild_id = ?'),
    reviews: db.prepare('SELECT * FROM reviews WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),

    insertPortfolio: db.prepare(`
      INSERT INTO portfolio (guild_id, title, description, image_url, tags, created_by, created_at)
      VALUES (@guildId, @title, @description, @imageUrl, @tags, @createdBy, @now)
    `),
    portfolioById: db.prepare('SELECT * FROM portfolio WHERE id = ?'),
    removePortfolio: db.prepare('DELETE FROM portfolio WHERE guild_id = ? AND id = ?'),
    portfolioAll: db.prepare('SELECT * FROM portfolio WHERE guild_id = ? ORDER BY created_at DESC, id DESC'),
    portfolioTagged: db.prepare(`SELECT * FROM portfolio WHERE guild_id = ? AND tags LIKE '%,' || ? || ',%' ORDER BY created_at DESC, id DESC`),
  };

  const activeCount = (guildId) => q.activeCount.get(guildId, ...ACTIVE_STATUSES).n;

  /** Must be called inside a transaction. */
  function applyTransition(commission, to, actorId, note, now) {
    if (!canTransition(commission.status, to)) {
      throw new UserError(`A commission cannot move from ${statusLabel(commission.status)} to ${statusLabel(to)}.`, { title: 'Invalid status change' });
    }
    const changed = q.setStatus.run({ id: commission.id, from: commission.status, to, note, now }).changes;
    if (!changed) throw new UserError('This commission was changed by someone else. Please try again.', { title: 'Commission changed' });
    q.event.run(commission.id, commission.status, to, actorId, note, now);
  }

  function requireCommission(id) {
    const commission = q.get.get(id);
    if (!commission) throw new UserError('That commission no longer exists.', { title: 'Commission not found' });
    return commission;
  }

  return {
    activeCount,
    get: (id) => q.withTicket.get(id),
    getByChannel: (channelId) => q.byChannel.get(channelId),
    listOpen: (guildId) => q.listOpen.all(guildId),
    events: (id) => q.events.all(id),

    /** Creates the commission record. Call inside the ticket reservation transaction. */
    create({ guildId, ticketId, clientId, projectType, description, budget = null, deadline = null, references = null, now = Date.now() }) {
      const id = Number(q.insert.run({ guildId, ticketId, clientId, projectType, description, budget, deadline, references, now }).lastInsertRowid);
      q.event.run(id, null, 'requested', clientId, null, now);
      return q.get.get(id);
    },

    /** Validated status change with an audit event. */
    transition(id, to, { actorId, note = null, now = Date.now() }) {
      return db.transaction(() => {
        const commission = requireCommission(id);
        applyTransition(commission, to, actorId, note, now);
        return { from: commission.status, to, commission: q.withTicket.get(id) };
      }).immediate();
    },

    /** Sends a new quote. Older unanswered quotes are superseded; a requested commission becomes quoted. */
    createQuote({ commissionId, amountCents, currency, description, revisions = null, delivery = null, createdBy, now = Date.now() }) {
      return db.transaction(() => {
        const commission = requireCommission(commissionId);
        if (!['requested', 'quoted'].includes(commission.status)) {
          throw new UserError(`Quotes can only be sent before one is accepted. This commission is ${statusLabel(commission.status)}.`, { title: 'Cannot quote' });
        }
        q.supersede.run(commissionId);
        const number = q.nextQuote.get(commission.guild_id).n;
        const id = Number(q.insertQuote.run({
          guildId: commission.guild_id, number, commissionId, amountCents, currency, description, revisions, delivery, createdBy, now,
        }).lastInsertRowid);
        if (commission.status === 'requested') applyTransition(commission, 'quoted', createdBy, `Sent ${formatQuoteNumber(number)}`, now);
        return q.quoteById.get(id);
      }).immediate();
    },

    getQuote: (id) => q.quoteById.get(id),
    getQuoteByNumber: (guildId, number) => q.quoteByNumber.get(guildId, number),
    quotesFor: (commissionId) => q.quotesFor.all(commissionId),
    setQuoteMessage: (id, channelId, messageId) => q.quoteMessage.run(channelId, messageId, id),

    /**
     * The client's answer to a pending quote. Accepting claims a commission slot,
     * so the slot check and the status change happen in one transaction.
     * @param {'accept' | 'reject' | 'changes'} response
     */
    respondToQuote(quoteId, { userId, response, note = null, slots, now = Date.now() }) {
      const statusFor = { accept: 'accepted', reject: 'rejected', changes: 'changes_requested' };
      if (!statusFor[response]) throw new Error(`Unknown quote response: ${response}`);
      return db.transaction(() => {
        const quote = q.quoteById.get(quoteId);
        if (!quote) throw new UserError('That quote no longer exists.', { title: 'Quote not found' });
        const commission = requireCommission(quote.commission_id);
        if (commission.client_id !== userId) throw new UserError('Only the client can respond to this quote.', { title: 'Not your quote' });
        if (quote.status !== 'pending') {
          throw new UserError(`${formatQuoteNumber(quote.number)} is no longer waiting for a response.`, { title: 'Quote closed' });
        }
        if (response === 'accept') {
          if (commission.status !== 'quoted') throw new UserError(`This commission is ${statusLabel(commission.status)} and cannot accept a quote.`, { title: 'Cannot accept' });
          if (activeCount(commission.guild_id) >= slots) {
            throw new UserError('All commission slots are full right now. Lyss will let you know when a slot opens.', { title: 'No slots available' });
          }
        }
        q.respondQuote.run({ id: quoteId, status: statusFor[response], note, now });
        if (response === 'accept') applyTransition(commission, 'accepted', userId, `Accepted ${formatQuoteNumber(quote.number)}`, now);
        return { quote: q.quoteById.get(quoteId), commission: q.withTicket.get(commission.id) };
      }).immediate();
    },

    /** One invoice per accepted quote, for the quoted amount. */
    createInvoice({ guildId, quoteNumber, createdBy, now = Date.now() }) {
      return db.transaction(() => {
        const quote = q.quoteByNumber.get(guildId, quoteNumber);
        if (!quote) throw new UserError(`${formatQuoteNumber(quoteNumber)} does not exist.`, { title: 'Quote not found' });
        if (quote.status !== 'accepted') throw new UserError(`${formatQuoteNumber(quote.number)} has not been accepted by the client.`, { title: 'Quote not accepted' });
        const existing = q.invoiceForQuote.get(quote.id);
        if (existing) throw new UserError(`${formatInvoiceNumber(existing.number)} already exists for this quote.`, { title: 'Invoice exists' });
        const commission = requireCommission(quote.commission_id);
        if (commission.status === 'cancelled') throw new UserError('This commission was cancelled.', { title: 'Commission cancelled' });
        const number = q.nextInvoice.get(guildId).n;
        const id = Number(q.insertInvoice.run({
          guildId, number, commissionId: quote.commission_id, quoteId: quote.id, amountCents: quote.amount_cents, currency: quote.currency, createdBy, now,
        }).lastInsertRowid);
        return q.invoiceById.get(id);
      }).immediate();
    },

    getInvoiceByNumber: (guildId, number) => q.invoiceByNumber.get(guildId, number),
    invoicesFor: (commissionId) => q.invoicesFor.all(commissionId),
    /** Returns false when the invoice was already in the requested state. */
    setInvoicePaid(invoiceId, paid, actorId, now = Date.now()) {
      return (paid ? q.setPaid.run(now, actorId, invoiceId) : q.setUnpaid.run(actorId, invoiceId)).changes > 0;
    },

    addReview({ commissionId, clientId, rating, comment = null, now = Date.now() }) {
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new UserError('Ratings must be a whole number from 1 to 5.', { title: 'Invalid rating' });
      return db.transaction(() => {
        const commission = requireCommission(commissionId);
        if (commission.client_id !== clientId) throw new UserError('Only the client can review this commission.', { title: 'Not your commission' });
        if (commission.status !== 'completed') throw new UserError('Reviews open once the commission is completed.', { title: 'Not completed yet' });
        if (!q.insertReview.run(commission.guild_id, commissionId, clientId, rating, comment, now).changes) {
          throw new UserError('You have already reviewed this commission. Thank you!', { title: 'Already reviewed' });
        }
        return q.reviewFor.get(commissionId);
      }).immediate();
    },
    reviewFor: (commissionId) => q.reviewFor.get(commissionId),
    reviewSummary: (guildId) => q.reviewSummary.get(guildId),
    listReviews: (guildId, limit, offset = 0) => q.reviews.all(guildId, limit, offset),

    addPortfolio({ guildId, title, description = null, imageUrl = null, tags = [], createdBy, now = Date.now() }) {
      const stored = tags.length ? `,${tags.join(',')},` : ',';
      const id = Number(q.insertPortfolio.run({ guildId, title, description, imageUrl, tags: stored, createdBy, now }).lastInsertRowid);
      return q.portfolioById.get(id);
    },
    removePortfolio: (guildId, id) => q.removePortfolio.run(guildId, id).changes > 0,
    listPortfolio: (guildId, tag = null) => (tag ? q.portfolioTagged.all(guildId, tag) : q.portfolioAll.all(guildId)),
  };
}
