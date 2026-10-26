/**
 * Per-guild configuration store. Database values override the defaults
 * declared in the bot's config.js.
 */
export function createGuildConfig(db, defaults = {}) {
  const getStmt = db.prepare('SELECT value FROM guild_config WHERE guild_id = ? AND key = ?');
  const allStmt = db.prepare('SELECT key, value, updated_by, updated_at FROM guild_config WHERE guild_id = ?');
  const setStmt = db.prepare(`
    INSERT INTO guild_config (guild_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `);
  const delStmt = db.prepare('DELETE FROM guild_config WHERE guild_id = ? AND key = ?');

  return {
    /** Returns the configured value, else the default, else `fallback`. */
    get(guildId, key, fallback = undefined) {
      if (guildId) {
        const row = getStmt.get(guildId, key);
        if (row) return JSON.parse(row.value);
      }
      return key in defaults ? defaults[key] : fallback;
    },
    /** True only when the guild has an explicit value stored. */
    isSet(guildId, key) {
      return Boolean(guildId && getStmt.get(guildId, key));
    },
    set(guildId, key, value, updatedBy = null) {
      if (value === undefined) throw new Error(`Cannot store undefined for ${key}`);
      setStmt.run(guildId, key, JSON.stringify(value), updatedBy, Date.now());
    },
    unset(guildId, key) {
      return delStmt.run(guildId, key).changes > 0;
    },
    all(guildId) {
      return Object.fromEntries(allStmt.all(guildId).map((row) => [row.key, JSON.parse(row.value)]));
    },
  };
}
