/** Message cache and anti-spam persistence. */

export function createMessageCache(db) {
  const q = {
    upsert: db.prepare(`
      INSERT INTO message_cache (message_id, guild_id, channel_id, author_id, content, attachments, created_at)
      VALUES (@messageId, @guildId, @channelId, @authorId, @content, @attachments, @createdAt)
      ON CONFLICT (message_id) DO UPDATE SET content = excluded.content, attachments = excluded.attachments
    `),
    get: db.prepare('SELECT * FROM message_cache WHERE message_id = ?'),
    edit: db.prepare('UPDATE message_cache SET content = ?, edited_at = ? WHERE message_id = ?'),
    remove: db.prepare('DELETE FROM message_cache WHERE message_id = ?'),
    prune: db.prepare('DELETE FROM message_cache WHERE guild_id = ? AND created_at < ?'),
  };
  const parse = (row) => (row ? { ...row, attachments: row.attachments ? JSON.parse(row.attachments) : [] } : row);

  return {
    add({ messageId, guildId, channelId, authorId, content, attachments = [], createdAt = Date.now() }) {
      q.upsert.run({ messageId, guildId, channelId, authorId, content: content || null, attachments: attachments.length ? JSON.stringify(attachments) : null, createdAt });
    },
    get: (messageId) => parse(q.get.get(messageId)),
    getMany(ids) {
      return ids.map((id) => parse(q.get.get(id))).filter(Boolean).sort((a, b) => a.created_at - b.created_at);
    },
    edit: (messageId, content, at = Date.now()) => q.edit.run(content, at, messageId).changes > 0,
    remove: (messageId) => q.remove.run(messageId),
    removeMany: db.transaction((ids) => { for (const id of ids) q.remove.run(id); }),
    prune: (guildId, before) => q.prune.run(guildId, before).changes,
  };
}

export function createAntispamStore(db) {
  const q = {
    record: db.prepare('INSERT INTO antispam_offences (guild_id, user_id, rule, channel_id, created_at) VALUES (?, ?, ?, ?, ?)'),
    countSince: db.prepare('SELECT COUNT(*) AS n FROM antispam_offences WHERE guild_id = ? AND user_id = ? AND created_at >= ?'),
    guildSince: db.prepare('SELECT rule, COUNT(*) AS n FROM antispam_offences WHERE guild_id = ? AND created_at >= ? GROUP BY rule'),
    prune: db.prepare('DELETE FROM antispam_offences WHERE created_at < ?'),
    add: db.prepare(`INSERT INTO antispam_whitelist (guild_id, kind, target_id, added_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`),
    remove: db.prepare('DELETE FROM antispam_whitelist WHERE guild_id = ? AND kind = ? AND target_id = ?'),
    list: db.prepare('SELECT * FROM antispam_whitelist WHERE guild_id = ? ORDER BY kind, created_at'),
  };

  return {
    /** Records an offence and returns how many the member has in the window (including this one). */
    recordOffence({ guildId, userId, rule, channelId, now = Date.now(), windowMs }) {
      return db.transaction(() => {
        q.record.run(guildId, userId, rule, channelId, now);
        return q.countSince.get(guildId, userId, now - windowMs).n;
      })();
    },
    offenceSummary: (guildId, since) => q.guildSince.all(guildId, since),
    prune: (before) => q.prune.run(before).changes,
    whitelist: (guildId, kind, targetId, addedBy, now = Date.now()) => q.add.run(guildId, kind, targetId, addedBy, now).changes > 0,
    unwhitelist: (guildId, kind, targetId) => q.remove.run(guildId, kind, targetId).changes > 0,
    listWhitelist: (guildId) => q.list.all(guildId),
    /** True when any of the channel IDs or role IDs is whitelisted. */
    isWhitelisted(guildId, { channelIds = [], roleIds = [] }) {
      return q.list.all(guildId).some((row) => (row.kind === 'channel' ? channelIds : roleIds).includes(row.target_id));
    },
  };
}
