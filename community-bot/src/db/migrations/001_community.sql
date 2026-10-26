-- Lyss Community, phase 4: community management features.
-- All times are UTC milliseconds.

CREATE TABLE autoroles (
  guild_id    TEXT    NOT NULL,
  role_id     TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  emoji       TEXT,
  description TEXT,
  added_by    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, role_id)
);

-- Posted role panels, refreshed when the role list changes.
CREATE TABLE autorole_panels (
  message_id  TEXT    PRIMARY KEY,
  guild_id    TEXT    NOT NULL,
  channel_id  TEXT    NOT NULL,
  title       TEXT,
  description TEXT,
  created_by  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE boost_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('start', 'stop')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_boost_events_guild ON boost_events (guild_id, created_at);

CREATE TABLE suggestions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  number         INTEGER NOT NULL CHECK (number > 0),
  author_id      TEXT    NOT NULL,
  content        TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'considered', 'approved', 'denied', 'implemented', 'deleted')),
  channel_id     TEXT,
  message_id     TEXT,
  thread_id      TEXT,
  staff_id       TEXT,
  staff_response TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (guild_id, number)
);

-- One current vote per member per suggestion.
CREATE TABLE suggestion_votes (
  suggestion_id INTEGER NOT NULL REFERENCES suggestions (id) ON DELETE CASCADE,
  user_id       TEXT    NOT NULL,
  vote          INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, user_id)
);

CREATE TABLE giveaways (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT    NOT NULL,
  channel_id       TEXT    NOT NULL,
  message_id       TEXT,
  host_id          TEXT    NOT NULL,
  prize            TEXT    NOT NULL,
  winner_count     INTEGER NOT NULL CHECK (winner_count BETWEEN 1 AND 20),
  required_role_id TEXT,
  ends_at          INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled')),
  winners          TEXT    NOT NULL DEFAULT '[]',
  announced_at     INTEGER,
  created_at       INTEGER NOT NULL,
  ended_at         INTEGER
);
CREATE INDEX idx_giveaways_status ON giveaways (guild_id, status);

CREATE TABLE giveaway_entries (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE polls (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT    NOT NULL,
  channel_id TEXT    NOT NULL,
  message_id TEXT,
  author_id  TEXT    NOT NULL,
  question   TEXT    NOT NULL,
  options    TEXT    NOT NULL,
  multiple   INTEGER NOT NULL DEFAULT 0,
  anonymous  INTEGER NOT NULL DEFAULT 0,
  ends_at    INTEGER,
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  closed_at  INTEGER
);

CREATE TABLE poll_votes (
  poll_id      INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  user_id      TEXT    NOT NULL,
  option_index INTEGER NOT NULL CHECK (option_index BETWEEN 0 AND 9),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id, option_index)
);

CREATE TABLE starboard_entries (
  message_id           TEXT    PRIMARY KEY,
  guild_id             TEXT    NOT NULL,
  channel_id           TEXT    NOT NULL,
  author_id            TEXT    NOT NULL,
  starboard_message_id TEXT,
  stars                INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE birthdays (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  year       INTEGER CHECK (year IS NULL OR year BETWEEN 1900 AND 2100),
  show_age   INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 1,
  set_by     TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- One announcement per guild per local date, so restarts never announce twice.
CREATE TABLE birthday_announcements (
  guild_id   TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  claimed_at INTEGER NOT NULL,
  posted_at  INTEGER,
  PRIMARY KEY (guild_id, date)
);

CREATE TABLE embed_templates (
  guild_id   TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  data       TEXT    NOT NULL,
  created_by TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

-- Work-in-progress embeds from the builder. Expire after an hour.
CREATE TABLE embed_drafts (
  id              TEXT    PRIMARY KEY,
  guild_id        TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  data            TEXT    NOT NULL,
  channel_id      TEXT,
  edit_channel_id TEXT,
  edit_message_id TEXT,
  expires_at      INTEGER NOT NULL
);
