-- Lyss Tickets: tickets, panels, blacklist, ratings, commissions, quotes, invoices, portfolio, reviews.
-- All times are UTC milliseconds. Money is stored as integer minor units (cents).

CREATE TABLE tickets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  number           INTEGER NOT NULL CHECK (number > 0),
  type             TEXT    NOT NULL CHECK (type IN ('support', 'contact', 'commissions')),
  opener_id        TEXT    NOT NULL,
  channel_id       TEXT    UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'deleted')),
  claimed_by       TEXT,
  subject          TEXT,
  created_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  reminded_at      INTEGER,
  closed_at        INTEGER,
  closed_by        TEXT,
  close_reason     TEXT,
  transcript_path  TEXT,
  transcript_url   TEXT,
  deleted_at       INTEGER,
  reopened_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (guild_id, number)
);
-- One open ticket per member per type. Enforced by the database, not just application code.
CREATE UNIQUE INDEX idx_tickets_one_open ON tickets (guild_id, opener_id, type) WHERE status = 'open';
CREATE INDEX idx_tickets_status ON tickets (guild_id, status);

-- Extra members added to a ticket with /ticket add.
CREATE TABLE ticket_members (
  ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  user_id   TEXT    NOT NULL,
  added_by  TEXT    NOT NULL,
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE ticket_blacklist (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  reason     TEXT,
  added_by   TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- One satisfaction rating per ticket, from the opener.
CREATE TABLE ticket_ratings (
  ticket_id  INTEGER PRIMARY KEY REFERENCES tickets (id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL
);

-- The most recently posted panel of each type, so it can be edited and its live counter refreshed.
CREATE TABLE panels (
  guild_id     TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('support', 'contact', 'commissions')),
  channel_id   TEXT    NOT NULL,
  message_id   TEXT    NOT NULL,
  title        TEXT,
  description  TEXT,
  button_label TEXT,
  updated_by   TEXT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, type)
);

CREATE TABLE commissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  ticket_id        INTEGER NOT NULL UNIQUE REFERENCES tickets (id) ON DELETE CASCADE,
  client_id        TEXT    NOT NULL,
  project_type     TEXT    NOT NULL,
  description      TEXT    NOT NULL,
  budget           TEXT,
  deadline         TEXT,
  reference_links  TEXT,
  status           TEXT    NOT NULL DEFAULT 'requested'
                   CHECK (status IN ('requested', 'quoted', 'accepted', 'in_progress', 'revisions', 'delivered', 'completed', 'cancelled')),
  cancelled_reason TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX idx_commissions_status ON commissions (guild_id, status);

-- Audit trail of every commission status change.
CREATE TABLE commission_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  commission_id INTEGER NOT NULL REFERENCES commissions (id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT    NOT NULL,
  actor_id      TEXT    NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE quotes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  number        INTEGER NOT NULL CHECK (number > 0),
  commission_id INTEGER NOT NULL REFERENCES commissions (id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  currency      TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  revisions     INTEGER CHECK (revisions IS NULL OR revisions >= 0),
  delivery      TEXT,
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'changes_requested', 'superseded')),
  response_note TEXT,
  created_by    TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  responded_at  INTEGER,
  channel_id    TEXT,
  message_id    TEXT,
  UNIQUE (guild_id, number)
);
CREATE UNIQUE INDEX idx_quotes_one_accepted ON quotes (commission_id) WHERE status = 'accepted';

CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  number         INTEGER NOT NULL CHECK (number > 0),
  commission_id  INTEGER NOT NULL REFERENCES commissions (id) ON DELETE CASCADE,
  quote_id       INTEGER NOT NULL UNIQUE REFERENCES quotes (id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  currency       TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  created_by     TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  paid_at        INTEGER,
  paid_marked_by TEXT,
  UNIQUE (guild_id, number)
);

CREATE TABLE portfolio (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT,
  image_url   TEXT,
  -- Stored as ",tag-one,tag-two," so a tag can be matched exactly with LIKE.
  tags        TEXT    NOT NULL DEFAULT ',',
  created_by  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

-- One review per completed commission, from its client.
CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  commission_id INTEGER NOT NULL UNIQUE REFERENCES commissions (id) ON DELETE CASCADE,
  client_id     TEXT    NOT NULL,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    INTEGER NOT NULL
);
