-- Lyss Community, phase 6: interactive /work jobs.
-- All times are UTC milliseconds.

-- Per-member, per-job progression. Each job levels independently.
CREATE TABLE job_progress (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  job          TEXT    NOT NULL,
  xp           INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
  failed       INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  total_earned INTEGER NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  best_score   INTEGER NOT NULL DEFAULT 0 CHECK (best_score BETWEEN 0 AND 100),
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, job)
);

-- One row per job attempt. The state (including the answers) never leaves the server.
CREATE TABLE job_sessions (
  id          TEXT    PRIMARY KEY,
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  job         TEXT    NOT NULL,
  difficulty  TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  rare        INTEGER NOT NULL DEFAULT 0,
  state       TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'expired', 'abandoned')),
  mistakes    INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  finished_at INTEGER,
  score       INTEGER,
  reward      INTEGER,
  xp          INTEGER
);
-- A member can only have one job in progress at a time.
CREATE UNIQUE INDEX idx_job_sessions_one_active ON job_sessions (guild_id, user_id) WHERE status = 'active';
CREATE INDEX idx_job_sessions_status ON job_sessions (status, expires_at);
