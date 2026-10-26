import { UserError } from '@lyss/shared/errorReporter.js';
import { ITEMS, itemLabel } from './items.js';

/**
 * Stackable inventory. Like the coin ledger, quantities only change together with a
 * matching inventory_transactions row, and the CHECK constraint makes negative stock
 * impossible. Grants and uses are designed to run inside a caller's transaction, so an
 * item is never granted unless the rest of the operation commits.
 */
export function createInventoryService(db) {
  const q = {
    get: db.prepare('SELECT quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND item_key = ?'),
    list: db.prepare('SELECT item_key, quantity FROM inventory_items WHERE guild_id = ? AND user_id = ? AND quantity > 0'),
    add: db.prepare(`
      INSERT INTO inventory_items (guild_id, user_id, item_key, quantity, updated_at) VALUES (@guildId, @userId, @item, @delta, @now)
      ON CONFLICT (guild_id, user_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at
    `),
    // Removals are a plain conditional UPDATE: SQLite checks CHECK constraints on an upsert's
    // VALUES row before resolving the conflict, so a negative insert would always fail.
    remove: db.prepare(`
      UPDATE inventory_items SET quantity = quantity + @delta, updated_at = @now
      WHERE guild_id = @guildId AND user_id = @userId AND item_key = @item AND quantity + @delta >= 0
    `),
    record: db.prepare(`
      INSERT INTO inventory_transactions (guild_id, user_id, item_key, delta, quantity_after, type, reference, operation_key, created_at)
      VALUES (@guildId, @userId, @item, @delta, @after, @type, @reference, @operationKey, @now)
    `),
  };

  const quantity = (guildId, userId, item) => q.get.get(guildId, userId, item)?.quantity ?? 0;

  function change({ guildId, userId, item, delta, type, reference = null, operationKey = null, now = Date.now() }) {
    if (!ITEMS[item]) throw new Error(`Unknown item ${item}`);
    if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('Item quantities must be non-zero integers');
    if (delta > 0) q.add.run({ guildId, userId, item, delta, now });
    else if (!q.remove.run({ guildId, userId, item, delta, now }).changes) {
      throw new UserError(`You do not have enough ${itemLabel(item)}.`, { title: 'Missing item' });
    }
    const after = quantity(guildId, userId, item);
    q.record.run({ guildId, userId, item, delta, after, type, reference, operationKey, now });
    return after;
  }

  return {
    quantity,
    /** Owned items as { item, quantity }, in catalogue order. */
    list(guildId, userId, kind = null) {
      const owned = new Map(q.list.all(guildId, userId).map((row) => [row.item_key, row.quantity]));
      return Object.keys(ITEMS)
        .filter((key) => owned.has(key) && (!kind || ITEMS[key].kind === kind))
        .map((key) => ({ item: key, quantity: owned.get(key) }));
    },
    grant: ({ quantity: amount = 1, ...args }) => change({ ...args, delta: amount }),
    /** Removes items, or throws a UserError naming the missing item. */
    use: ({ quantity: amount = 1, ...args }) => change({ ...args, delta: -amount }),
    /** Throws unless every { item, quantity } is owned. */
    assertHas(guildId, userId, needs) {
      for (const { item, quantity: amount } of needs) {
        const owned = quantity(guildId, userId, item);
        if (owned < amount) throw new UserError(`You need ${itemLabel(item)} ×${amount} (you have ${owned}).`, { title: 'Missing item' });
      }
    },
  };
}
