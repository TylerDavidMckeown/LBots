-- Lyss Community, phase 5: the Lyss Coins (LC) economy.
-- Balances are integers and can never be negative. All times are UTC milliseconds.

CREATE TABLE economy_accounts (
  guild_id        TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  wallet          INTEGER NOT NULL DEFAULT 0 CHECK (wallet >= 0),
  bank            INTEGER NOT NULL DEFAULT 0 CHECK (bank >= 0),
  lifetime_earned INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent  INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  xp              INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  frozen          INTEGER NOT NULL DEFAULT 0,
  frozen_reason   TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_economy_networth ON economy_accounts (guild_id, (wallet + bank));

-- Every balance change, one row per account leg. Never deleted without a retention policy.
CREATE TABLE economy_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  account         TEXT    NOT NULL CHECK (account IN ('wallet', 'bank')),
  amount          INTEGER NOT NULL CHECK (amount != 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  type            TEXT    NOT NULL,
  counterparty_id TEXT,
  reference       TEXT,
  operation_key   TEXT,
  note            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_economy_transactions_user ON economy_transactions (guild_id, user_id, created_at);

-- Daily, weekly and monthly claims. The primary key makes a second claim for the same period impossible.
CREATE TABLE reward_claims (
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('daily', 'weekly', 'monthly')),
  period        TEXT    NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  streak        INTEGER NOT NULL DEFAULT 0,
  claimed_at    INTEGER NOT NULL,
  period_end_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, kind, period)
);
CREATE INDEX idx_reward_claims_latest ON reward_claims (guild_id, user_id, kind, claimed_at);

-- Persistent cooldowns (crime, rob, rob protection), so restarts never reset them.
CREATE TABLE economy_cooldowns (
  guild_id     TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  available_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, action)
);

CREATE TABLE economy_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  actor_id   TEXT    NOT NULL,
  target_id  TEXT,
  action     TEXT    NOT NULL,
  amount     INTEGER,
  reason     TEXT,
  details    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_economy_audit_guild ON economy_audit_log (guild_id, created_at);

-- Single-use confirmations (e.g. /pay). Survive restarts and can only be executed once.
CREATE TABLE economy_pending (
  id         TEXT    PRIMARY KEY,
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
