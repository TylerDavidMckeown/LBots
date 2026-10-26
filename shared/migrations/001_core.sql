-- Core tables present in every Lyss Tools database.

-- Server-specific settings. Values are JSON encoded and override config.js defaults.
CREATE TABLE guild_config (
  guild_id   TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, key)
);

-- Database-backed scheduler. Jobs survive restarts; dedupe_key prevents the
-- same logical job from being queued twice.
CREATE TABLE scheduled_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL,
  run_at       INTEGER NOT NULL,
  payload      TEXT    NOT NULL DEFAULT '{}',
  dedupe_key   TEXT    UNIQUE,
  status       TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  last_error   TEXT,
  locked_at    INTEGER,
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_scheduled_tasks_due ON scheduled_tasks (status, run_at);

-- Sanitised error records. Users only ever see the reference ID.
CREATE TABLE error_log (
  id         TEXT    PRIMARY KEY,
  bot        TEXT    NOT NULL,
  source     TEXT    NOT NULL,
  guild_id   TEXT,
  channel_id TEXT,
  user_id    TEXT,
  message    TEXT    NOT NULL,
  stack      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_error_log_created ON error_log (created_at);

-- Idempotency ledger. An operation key can be applied exactly once; the
-- stored result is returned to any later attempt with the same key.
CREATE TABLE processed_operations (
  key        TEXT    PRIMARY KEY,
  result     TEXT,
  created_at INTEGER NOT NULL
);
