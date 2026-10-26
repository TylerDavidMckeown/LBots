-- Lyss Guard: moderation cases, notes, message cache and anti-spam state.
-- All times are UTC milliseconds.

CREATE TABLE mod_cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT    NOT NULL,
  number          INTEGER NOT NULL CHECK (number > 0),
  action          TEXT    NOT NULL CHECK (action IN (
                    'warn', 'unwarn', 'timeout', 'untimeout', 'kick', 'ban', 'tempban', 'unban',
                    'purge', 'slowmode', 'lock', 'unlock')),
  target_id       TEXT,
  channel_id      TEXT,
  moderator_id    TEXT    NOT NULL,
  reason          TEXT,
  duration_ms     INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  expires_at      INTEGER,
  source          TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'antispam', 'escalation', 'automatic')),
  related_case_id INTEGER REFERENCES mod_cases (id),
  metadata        TEXT,
  revoked_at      INTEGER,
  revoked_by      TEXT,
  revoke_reason   TEXT,
  log_channel_id  TEXT,
  log_message_id  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER,
  UNIQUE (guild_id, number)
);
CREATE INDEX idx_mod_cases_target ON mod_cases (guild_id, target_id, action);

-- Private staff notes about a member. Never shown to the member.
CREATE TABLE mod_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  target_id  TEXT    NOT NULL,
  author_id  TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_mod_notes_target ON mod_notes (guild_id, target_id);

-- Recent message content, so edits and deletions can be logged after a restart.
-- Pruned after the configured retention period (7 days by default).
CREATE TABLE message_cache (
  message_id  TEXT    PRIMARY KEY,
  guild_id    TEXT    NOT NULL,
  channel_id  TEXT    NOT NULL,
  author_id   TEXT    NOT NULL,
  content     TEXT,
  attachments TEXT,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER
);
CREATE INDEX idx_message_cache_created ON message_cache (guild_id, created_at);

CREATE TABLE antispam_whitelist (
  guild_id   TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('role', 'channel')),
  target_id  TEXT    NOT NULL,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, kind, target_id)
);

-- Anti-spam offences, used to escalate repeat offenders across restarts.
CREATE TABLE antispam_offences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  rule       TEXT    NOT NULL,
  channel_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_antispam_offences_user ON antispam_offences (guild_id, user_id, created_at);
