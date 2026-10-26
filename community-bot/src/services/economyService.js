import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { NO_ACTIVITY } from './activity.js';
import {
  formatCoins, nextDailyStreak, REWARD_KINDS, rewardAmount, rewardPeriod, rollCrime, rollRob,
} from './economyRules.js';

/**
 * Lyss Coins ledger. Every public operation runs in a single SQLite transaction:
 * balances change only with a matching transaction record, a failed step rolls
 * everything back, and the database CHECK constraints make negative balances impossible.
 */

const LEADERBOARD_METRICS = Object.freeze({
  networth: '(wallet + bank)',
  wallet: 'wallet',
  bank: 'bank',
  earned: 'lifetime_earned',
});

export const LEADERBOARD_CHOICES = Object.freeze([
  { name: 'Net worth', value: 'networth' },
  { name: 'Wallet', value: 'wallet' },
  { name: 'Bank', value: 'bank' },
  { name: 'Lifetime earnings', value: 'earned' },
]);

const EMPTY_ACCOUNT = Object.freeze({ wallet: 0, bank: 0, lifetime_earned: 0, lifetime_spent: 0, xp: 0, frozen: 0, frozen_reason: null });

export function createEconomyService(db, { activity = NO_ACTIVITY } = {}) {
  const q = {
    get: db.prepare('SELECT * FROM economy_accounts WHERE guild_id = ? AND user_id = ?'),
    create: db.prepare('INSERT INTO economy_accounts (guild_id, user_id, wallet, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING'),
    change: db.prepare(`
      UPDATE economy_accounts SET wallet = wallet + @wallet, bank = bank + @bank,
        lifetime_earned = lifetime_earned + @earned, lifetime_spent = lifetime_spent + @spent, xp = xp + @xp, updated_at = @now
      WHERE guild_id = @guildId AND user_id = @userId AND wallet + @wallet >= 0 AND bank + @bank >= 0
    `),
    record: db.prepare(`
      INSERT INTO economy_transactions (guild_id, user_id, account, amount, balance_after, type, counterparty_id, reference, operation_key, note, created_at)
      VALUES (@guildId, @userId, @account, @amount, @balanceAfter, @type, @counterpartyId, @reference, @operationKey, @note, @now)
    `),
    freeze: db.prepare('UPDATE economy_accounts SET frozen = ?, frozen_reason = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?'),
    lastClaim: db.prepare('SELECT * FROM reward_claims WHERE guild_id = ? AND user_id = ? AND kind = ? ORDER BY claimed_at DESC LIMIT 1'),
    insertClaim: db.prepare(`
      INSERT INTO reward_claims (guild_id, user_id, kind, period, amount, streak, claimed_at, period_end_at)
      VALUES (@guildId, @userId, @kind, @period, @amount, @streak, @now, @endAt)
    `),
    cooldown: db.prepare('SELECT available_at FROM economy_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?'),
    setCooldown: db.prepare(`
      INSERT INTO economy_cooldowns (guild_id, user_id, action, available_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id, action) DO UPDATE SET available_at = excluded.available_at
    `),
    audit: db.prepare('INSERT INTO economy_audit_log (guild_id, actor_id, target_id, action, amount, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    auditLog: db.prepare('SELECT * FROM economy_audit_log WHERE guild_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
    auditCount: db.prepare('SELECT COUNT(*) AS n FROM economy_audit_log WHERE guild_id = ?'),
    transactions: db.prepare('SELECT * FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'),
    transactionCount: db.prepare('SELECT COUNT(*) AS n FROM economy_transactions WHERE guild_id = ? AND user_id = ?'),
    rank: db.prepare('SELECT COUNT(*) + 1 AS n FROM economy_accounts WHERE guild_id = ? AND (wallet + bank) > ?'),
    insertPending: db.prepare('INSERT INTO economy_pending (id, guild_id, user_id, kind, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    pending: db.prepare('SELECT * FROM economy_pending WHERE id = ?'),
    setPending: db.prepare(`UPDATE economy_pending SET status = ? WHERE id = ? AND status = 'pending'`),
    prunePending: db.prepare('DELETE FROM economy_pending WHERE expires_at < ?'),
  };
  const leaderboardStatements = Object.fromEntries(Object.entries(LEADERBOARD_METRICS).map(([key, expr]) => [key, {
    page: db.prepare(`SELECT *, ${expr} AS metric FROM economy_accounts WHERE guild_id = ? AND ${expr} > 0 ORDER BY metric DESC, user_id LIMIT ? OFFSET ?`),
    count: db.prepare(`SELECT COUNT(*) AS n FROM economy_accounts WHERE guild_id = ? AND ${expr} > 0`),
  }]));

  function ensure(guildId, userId, now, startingBalance = 0) {
    if (q.create.run(guildId, userId, startingBalance, now, now).changes && startingBalance > 0) {
      q.record.run({
        guildId, userId, account: 'wallet', amount: startingBalance, balanceAfter: startingBalance, type: 'starting_balance',
        counterpartyId: null, reference: null, operationKey: null, note: null, now,
      });
    }
    return q.get.get(guildId, userId);
  }

  function assertActive(account, self = true) {
    if (account.frozen) {
      throw new UserError(self ? 'Your economy account is frozen. Please contact a server admin.' : `<@${account.user_id}>'s economy account is frozen.`, { title: 'Account frozen' });
    }
  }

  /**
   * Applies balance deltas and records one transaction per changed account.
   * Must run inside a transaction. Throws UserError when funds are insufficient.
   */
  function apply(guildId, userId, deltas, meta) {
    const { wallet = 0, bank = 0, earned = 0, spent = 0, xp = 0 } = deltas;
    for (const value of [wallet, bank, earned, spent, xp]) {
      if (!Number.isSafeInteger(value)) throw new Error('Economy amounts must be safe integers');
    }
    const before = ensure(guildId, userId, meta.now, meta.startingBalance ?? 0);
    if (meta.maxWallet > 0 && wallet > 0 && before.wallet + wallet > meta.maxWallet) {
      throw new UserError(`That would take ${meta.self === false ? `<@${userId}>'s` : 'your'} wallet above the ${formatCoins(meta.maxWallet)} limit.`, { title: 'Wallet limit reached' });
    }
    if (!q.change.run({ guildId, userId, wallet, bank, earned, spent, xp, now: meta.now }).changes) {
      throw new UserError(meta.insufficient ?? 'You do not have enough Lyss Coins for that.', { title: 'Insufficient funds' });
    }
    const after = q.get.get(guildId, userId);
    const row = {
      guildId, userId, type: meta.type, counterpartyId: meta.counterpartyId ?? null, reference: meta.reference ?? null,
      operationKey: meta.operationKey ?? null, note: meta.note ?? null, now: meta.now,
    };
    if (wallet) q.record.run({ ...row, account: 'wallet', amount: wallet, balanceAfter: after.wallet });
    if (bank) q.record.run({ ...row, account: 'bank', amount: bank, balanceAfter: after.bank });
    return after;
  }

  function assertAmount(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new UserError('Amounts must be a positive whole number of Lyss Coins.', { title: 'Invalid amount' });
  }

  function transferInner({ guildId, fromId, toId, amount, note = null, now, settings, operationKey = null }) {
    assertAmount(amount);
    if (fromId === toId) throw new UserError('You cannot pay yourself.', { title: 'Invalid recipient' });
    if (amount > settings.payMax) throw new UserError(`The largest single payment is ${formatCoins(settings.payMax)}.`, { title: 'Payment too large' });
    const base = { now, startingBalance: settings.startingBalance };
    const sender = ensure(guildId, fromId, now, settings.startingBalance);
    assertActive(sender);
    assertActive(ensure(guildId, toId, now, settings.startingBalance), false);
    const from = apply(guildId, fromId, { wallet: -amount }, {
      ...base, type: 'transfer_out', counterpartyId: toId, note, operationKey, insufficient: `You only have ${formatCoins(sender.wallet)} in your wallet.`,
    });
    const to = apply(guildId, toId, { wallet: amount }, {
      ...base, type: 'transfer_in', counterpartyId: fromId, note, operationKey, maxWallet: settings.maxWallet, self: false,
    });
    return { from, to, amount };
  }

  const tx = (fn) => db.transaction(fn).immediate();

  return {
    /** Read-only view. Accounts are created on first activity, so missing ones read as empty. */
    account(guildId, userId) {
      return q.get.get(guildId, userId) ?? { ...EMPTY_ACCOUNT, guild_id: guildId, user_id: userId };
    },
    rank(guildId, userId) {
      const account = q.get.get(guildId, userId);
      return account && account.wallet + account.bank > 0 ? q.rank.get(guildId, account.wallet + account.bank).n : null;
    },

    /** Adds coins to a wallet (rewards, boosts, events). Counts towards lifetime earnings. */
    credit({ guildId, userId, amount, type, reference = null, note = null, operationKey = null, xp = 0, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => {
        assertActive(ensure(guildId, userId, now, settings.startingBalance));
        return apply(guildId, userId, { wallet: amount, earned: amount, xp }, {
          now, type, reference, note, operationKey, maxWallet: settings.maxWallet, startingBalance: settings.startingBalance,
        });
      });
    },

    /**
     * Pays a reward into the bank (level and collection rewards). The wallet limit does not
     * apply to banks, so this cannot fail and roll back the activity that earned it.
     */
    payReward({ guildId, userId, amount, type, reference = null, operationKey = null, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => apply(guildId, userId, { bank: amount, earned: amount }, {
        now, type, reference, operationKey, startingBalance: settings.startingBalance,
      }));
    },

    /** Spends wallet coins on a purchase (adoptions, evolutions). Counts towards lifetime spending. */
    debit({ guildId, userId, amount, type, reference = null, operationKey = null, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => {
        const account = ensure(guildId, userId, now, settings.startingBalance);
        assertActive(account);
        return apply(guildId, userId, { wallet: -amount, spent: amount }, {
          now, type, reference, operationKey, insufficient: `That costs ${formatCoins(amount)}, but you only have ${formatCoins(account.wallet)} in your wallet.`,
        });
      });
    },

    transfer: (args) => tx(() => transferInner({ now: Date.now(), ...args })),

    deposit({ guildId, userId, amount, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => {
        const account = ensure(guildId, userId, now, settings.startingBalance);
        assertActive(account);
        return apply(guildId, userId, { wallet: -amount, bank: amount }, {
          now, type: 'deposit', insufficient: `You only have ${formatCoins(account.wallet)} in your wallet.`,
        });
      });
    },

    withdraw({ guildId, userId, amount, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => {
        const account = ensure(guildId, userId, now, settings.startingBalance);
        assertActive(account);
        return apply(guildId, userId, { wallet: amount, bank: -amount }, {
          now, type: 'withdraw', maxWallet: settings.maxWallet, insufficient: `You only have ${formatCoins(account.bank)} in your bank.`,
        });
      });
    },

    /** Whether a reward can be claimed now, and how much it would pay. */
    rewardStatus({ guildId, userId, kind, now = Date.now(), settings }) {
      const last = q.lastClaim.get(guildId, userId, kind);
      const available = !last || now >= last.period_end_at;
      const streak = kind === 'daily' ? (available ? nextDailyStreak(last, now) : last.streak) : 0;
      return { available, nextAt: available ? null : last.period_end_at, streak, last, ...rewardAmount(kind, streak, settings) };
    },

    /**
     * Claims a daily, weekly or monthly reward once per period. The period end is stored,
     * so the next claim is never available early, even if the server timezone changes.
     */
    claimReward({ guildId, userId, kind, now = Date.now(), zone, settings }) {
      if (!REWARD_KINDS[kind]) throw new Error(`Unknown reward ${kind}`);
      return tx(() => {
        assertActive(ensure(guildId, userId, now, settings.startingBalance));
        const last = q.lastClaim.get(guildId, userId, kind);
        if (last && now < last.period_end_at) {
          throw new UserError(`You already claimed your ${kind} reward. Come back ${discordTimestamp(last.period_end_at, 'R')}.`, { title: 'Already claimed' });
        }
        const { period, endAt } = rewardPeriod(kind, now, zone);
        const streak = kind === 'daily' ? nextDailyStreak(last, now) : 0;
        const { base, bonus, total } = rewardAmount(kind, streak, settings);
        q.insertClaim.run({ guildId, userId, kind, period, amount: total, streak, now, endAt });
        const account = total > 0
          ? apply(guildId, userId, { wallet: total, earned: total, xp: REWARD_KINDS[kind].xp }, {
            now, type: `${kind}_reward`, reference: period, maxWallet: settings.maxWallet,
          })
          : q.get.get(guildId, userId);
        const reported = activity.emit({ guildId, userId, activity: 'reward_claimed', variant: kind, operationKey: `reward:${kind}:${period}`, now, settings });
        return { amount: total, base, bonus, streak, nextAt: endAt, account, progression: reported.progression ?? null };
      });
    },

    cooldown: (guildId, userId, action) => q.cooldown.get(guildId, userId, action)?.available_at ?? 0,
    setCooldown: (guildId, userId, action, availableAt) => q.setCooldown.run(guildId, userId, action, availableAt),

    /** Takes a game stake out of the wallet into escrow (see gameService). */
    holdStake({ guildId, userId, amount, reference = null, operationKey = null, now = Date.now(), settings }) {
      assertAmount(amount);
      return tx(() => {
        const account = ensure(guildId, userId, now, settings.startingBalance);
        assertActive(account);
        return apply(guildId, userId, { wallet: -amount }, {
          now, type: 'game_stake', reference, operationKey, insufficient: `You only have ${formatCoins(account.wallet)} in your wallet.`,
        });
      });
    },

    /**
     * Pays out a game: returns `payout` coins (stake included) and books the net result as
     * earned or spent. Never blocked by a frozen account or the wallet limit, so held stakes
     * can always be settled or refunded.
     */
    settleStake({ guildId, userId, stake, payout, xp = 0, type, reference = null, operationKey = null, now = Date.now(), settings }) {
      if (![stake, payout, xp].every((v) => Number.isSafeInteger(v) && v >= 0)) throw new Error('Game settlement amounts must be non-negative integers');
      return tx(() => {
        ensure(guildId, userId, now, settings.startingBalance);
        return apply(guildId, userId, { wallet: payout, earned: Math.max(0, payout - stake), spent: Math.max(0, stake - payout), xp }, {
          now, type, reference, operationKey,
        });
      });
    },

    /** A fictional crime with a persistent cooldown. Fines never exceed the wallet. */
    crime({ guildId, userId, now = Date.now(), settings, rng = Math.random }) {
      if (!settings.crimeEnabled) throw new UserError('Crime is disabled in this server.', { title: 'Disabled' });
      return tx(() => {
        assertActive(ensure(guildId, userId, now, settings.startingBalance));
        const readyAt = q.cooldown.get(guildId, userId, 'crime')?.available_at ?? 0;
        if (readyAt > now) throw new UserError(`You are laying low. Try again ${discordTimestamp(readyAt, 'R')}.`, { title: 'On cooldown' });
        const outcome = rollCrime(rng, settings);
        let account = q.get.get(guildId, userId);
        let amount = outcome.amount;
        if (outcome.success && amount > 0) {
          account = apply(guildId, userId, { wallet: amount, earned: amount }, { now, type: 'crime_reward', maxWallet: settings.maxWallet });
        } else if (!outcome.success) {
          amount = Math.min(amount, account.wallet);
          if (amount > 0) account = apply(guildId, userId, { wallet: -amount, spent: amount }, { now, type: 'crime_fine' });
        }
        q.setCooldown.run(guildId, userId, 'crime', now + settings.crimeCooldown);
        return { ...outcome, amount, account, nextAt: now + settings.crimeCooldown };
      });
    },

    /** A robbery attempt. Only wallets can be robbed; banks are always safe. */
    rob({ guildId, robberId, victimId, now = Date.now(), settings, rng = Math.random }) {
      if (!settings.robEnabled) throw new UserError('Robbery is disabled in this server.', { title: 'Disabled' });
      if (robberId === victimId) throw new UserError('You cannot rob yourself.', { title: 'Invalid target' });
      return tx(() => {
        const robber = ensure(guildId, robberId, now, settings.startingBalance);
        assertActive(robber);
        const victim = q.get.get(guildId, victimId);
        if (!victim || victim.wallet < settings.robMinVictimWallet) {
          throw new UserError(`<@${victimId}> needs at least ${formatCoins(settings.robMinVictimWallet)} in their wallet to be worth robbing.`, { title: 'Not worth it' });
        }
        assertActive(victim, false);
        const readyAt = q.cooldown.get(guildId, robberId, 'rob')?.available_at ?? 0;
        if (readyAt > now) throw new UserError(`You can attempt another robbery ${discordTimestamp(readyAt, 'R')}.`, { title: 'On cooldown' });
        const protectedUntil = q.cooldown.get(guildId, victimId, 'rob_protection')?.available_at ?? 0;
        if (protectedUntil > now) throw new UserError(`<@${victimId}> was robbed recently and is protected until ${discordTimestamp(protectedUntil, 't')}.`, { title: 'Protected' });
        if (robber.wallet < settings.robMinRobberWallet) {
          throw new UserError(`You need at least ${formatCoins(settings.robMinRobberWallet)} in your wallet to risk a robbery.`, { title: 'Too risky' });
        }

        const outcome = rollRob(rng, settings, victim.wallet, robber.wallet);
        let result;
        if (outcome.success) {
          const victimAfter = apply(guildId, victimId, { wallet: -outcome.amount }, { now, type: 'robbed', counterpartyId: robberId });
          const robberAfter = apply(guildId, robberId, { wallet: outcome.amount, earned: outcome.amount }, { now, type: 'rob_success', counterpartyId: victimId, maxWallet: settings.maxWallet });
          q.setCooldown.run(guildId, victimId, 'rob_protection', now + settings.robProtection);
          result = { ...outcome, robber: robberAfter, victim: victimAfter };
        } else if (outcome.amount > 0) {
          // The fine is paid to the intended victim as compensation.
          const robberAfter = apply(guildId, robberId, { wallet: -outcome.amount, spent: outcome.amount }, { now, type: 'rob_fine', counterpartyId: victimId });
          const victimAfter = apply(guildId, victimId, { wallet: outcome.amount }, { now, type: 'rob_compensation', counterpartyId: robberId });
          result = { ...outcome, robber: robberAfter, victim: victimAfter };
        } else {
          result = { ...outcome, robber, victim };
        }
        q.setCooldown.run(guildId, robberId, 'rob', now + settings.robCooldown);
        return { ...result, nextAt: now + settings.robCooldown };
      });
    },

    /** Stores a single-use confirmation, e.g. for /pay. */
    createPending({ id, guildId, userId, kind, payload, now = Date.now(), ttlMs = 120_000 }) {
      q.insertPending.run(id, guildId, userId, kind, JSON.stringify(payload), now, now + ttlMs);
    },

    /** Executes a confirmed payment exactly once. A failed transfer leaves the confirmation usable until it expires. */
    confirmPayment({ pendingId, userId, now = Date.now(), settings }) {
      return tx(() => {
        const pending = q.pending.get(pendingId);
        if (!pending || pending.user_id !== userId || pending.kind !== 'pay') throw new UserError('This confirmation is not yours or no longer exists.', { title: 'This has expired' });
        if (pending.status !== 'pending') throw new UserError('This payment was already handled.', { title: 'Already handled' });
        if (pending.expires_at <= now) {
          q.setPending.run('expired', pendingId);
          throw new UserError('This confirmation expired. Run /pay again.', { title: 'This has expired' });
        }
        q.setPending.run('done', pendingId);
        const payload = JSON.parse(pending.payload);
        return transferInner({ guildId: pending.guild_id, fromId: userId, toId: payload.toId, amount: payload.amount, note: payload.note, now, settings, operationKey: `pay:${pendingId}` });
      });
    },

    /**
     * Marks a single-use confirmation as used and returns its payload. Call it inside the
     * operation's transaction: if the operation fails, the confirmation stays usable.
     */
    consumePending({ pendingId, userId, kind, now = Date.now() }) {
      return tx(() => {
        const pending = q.pending.get(pendingId);
        if (!pending || pending.user_id !== userId || pending.kind !== kind) throw new UserError('This confirmation is not yours or no longer exists.', { title: 'This has expired' });
        if (pending.status !== 'pending') throw new UserError('This was already handled.', { title: 'Already handled' });
        if (pending.expires_at <= now) throw new UserError('This confirmation expired. Please run the command again.', { title: 'This has expired' });
        q.setPending.run('done', pendingId);
        return { guildId: pending.guild_id, ...JSON.parse(pending.payload) };
      });
    },

    cancelPending(pendingId, userId) {
      const pending = q.pending.get(pendingId);
      if (!pending || pending.user_id !== userId) return false;
      return q.setPending.run('cancelled', pendingId).changes > 0;
    },
    prunePending: (now = Date.now()) => q.prunePending.run(now - 86_400_000).changes,

    /** Admin add / remove / set on a wallet or bank. A reason is mandatory and every change is audited. */
    adminAdjust({ guildId, actorId, targetId, action, amount, account = 'wallet', reason, now = Date.now(), settings }) {
      if (!reason?.trim()) throw new UserError('Administrative changes need a reason.', { title: 'Reason required' });
      if (!['wallet', 'bank'].includes(account)) throw new Error('Invalid account');
      if (action === 'set' ? !(Number.isSafeInteger(amount) && amount >= 0) : !(Number.isSafeInteger(amount) && amount > 0)) {
        throw new UserError('Enter a valid whole number of Lyss Coins.', { title: 'Invalid amount' });
      }
      return tx(() => {
        const before = ensure(guildId, targetId, now, settings.startingBalance);
        const current = before[account];
        if (action === 'remove' && amount > current) {
          throw new UserError(`<@${targetId}> only has ${formatCoins(current)} in their ${account}.`, { title: 'Insufficient funds' });
        }
        const delta = action === 'add' ? amount : action === 'remove' ? -amount : amount - current;
        if (delta === 0) throw new UserError(`<@${targetId}>'s ${account} is already ${formatCoins(current)}.`, { title: 'No change' });
        const after = apply(guildId, targetId, { [account]: delta }, { now, type: `admin_${action}`, counterpartyId: actorId, note: reason });
        q.audit.run(guildId, actorId, targetId, `${action}_${account}`, delta, reason, JSON.stringify({ before: current, after: after[account] }), now);
        return { before, after, delta };
      });
    },

    /** Empties a member's wallet and bank. Transaction history is kept. */
    adminReset({ guildId, actorId, targetId, reason, now = Date.now(), settings }) {
      if (!reason?.trim()) throw new UserError('Administrative changes need a reason.', { title: 'Reason required' });
      return tx(() => {
        const before = ensure(guildId, targetId, now, settings.startingBalance);
        const after = before.wallet || before.bank
          ? apply(guildId, targetId, { wallet: -before.wallet, bank: -before.bank }, { now, type: 'admin_reset', counterpartyId: actorId, note: reason })
          : before;
        q.audit.run(guildId, actorId, targetId, 'reset', -(before.wallet + before.bank), reason, JSON.stringify({ wallet: before.wallet, bank: before.bank }), now);
        return { before, after };
      });
    },

    setFrozen({ guildId, actorId, targetId, frozen, reason = null, now = Date.now(), settings }) {
      if (frozen && !reason?.trim()) throw new UserError('Freezing an account needs a reason.', { title: 'Reason required' });
      return tx(() => {
        const account = ensure(guildId, targetId, now, settings.startingBalance);
        if (Boolean(account.frozen) === frozen) throw new UserError(`<@${targetId}>'s account is already ${frozen ? 'frozen' : 'active'}.`, { title: 'No change' });
        q.freeze.run(frozen ? 1 : 0, frozen ? reason : null, now, guildId, targetId);
        q.audit.run(guildId, actorId, targetId, frozen ? 'freeze' : 'unfreeze', null, reason, null, now);
        return q.get.get(guildId, targetId);
      });
    },

    logConfigChange({ guildId, actorId, key, before, after, now = Date.now() }) {
      q.audit.run(guildId, actorId, null, 'config', null, key, JSON.stringify({ before, after }), now);
    },
    auditLog: (guildId, limit = 10, offset = 0) => q.auditLog.all(guildId, limit, offset),
    auditCount: (guildId) => q.auditCount.get(guildId).n,

    leaderboard(guildId, metric = 'networth', limit = 10, offset = 0) {
      const statements = leaderboardStatements[metric];
      if (!statements) throw new Error(`Unknown leaderboard metric ${metric}`);
      return statements.page.all(guildId, limit, offset);
    },
    leaderboardCount: (guildId, metric = 'networth') => leaderboardStatements[metric].count.get(guildId).n,
    transactions: (guildId, userId, limit = 10, offset = 0) => q.transactions.all(guildId, userId, limit, offset),
    transactionCount: (guildId, userId) => q.transactionCount.get(guildId, userId).n,
  };
}
