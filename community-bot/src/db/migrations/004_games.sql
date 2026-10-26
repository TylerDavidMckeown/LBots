-- Lyss Community, phase 7: mini-games. All times are UTC milliseconds.

-- One row per game. State (including hidden answers and decks) never leaves the server.
-- pending: a confirmation card, nothing taken yet · open: a duel challenge, the challenger's stake held
-- active: in play, stakes held · settled / cancelled / expired: finished.
CREATE TABLE game_sessions (
  id          TEXT    PRIMARY KEY,
  guild_id    TEXT    NOT NULL,
  game        TEXT    NOT NULL,
  host_id     TEXT    NOT NULL,
  opponent_id TEXT,
  stake       INTEGER NOT NULL DEFAULT 0 CHECK (stake >= 0),
  options     TEXT    NOT NULL DEFAULT '{}',
  state       TEXT,
  status      TEXT    NOT NULL CHECK (status IN ('pending', 'open', 'active', 'settled', 'cancelled', 'expired')),
  channel_id  TEXT,
  message_id  TEXT,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  expires_at  INTEGER NOT NULL,
  finished_at INTEGER,
  outcome     TEXT
);
-- One solo game in progress per member, and one open or running duel per challenger.
CREATE UNIQUE INDEX idx_game_sessions_one_solo ON game_sessions (guild_id, host_id) WHERE status = 'active' AND opponent_id IS NULL;
CREATE UNIQUE INDEX idx_game_sessions_one_duel ON game_sessions (guild_id, host_id) WHERE status IN ('open', 'active') AND opponent_id IS NOT NULL;
CREATE INDEX idx_game_sessions_due ON game_sessions (status, expires_at);

-- Coins held in escrow for a game. Each stake is settled or refunded exactly once.
CREATE TABLE game_stakes (
  session_id  TEXT    NOT NULL REFERENCES game_sessions (id) ON DELETE CASCADE,
  user_id     TEXT    NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  status      TEXT    NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'settled', 'refunded')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  PRIMARY KEY (session_id, user_id)
);

-- Completed games, one row per player. The unique key makes double settlement impossible.
CREATE TABLE game_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  game        TEXT    NOT NULL,
  opponent_id TEXT,
  stake       INTEGER NOT NULL CHECK (stake >= 0),
  payout      INTEGER NOT NULL CHECK (payout >= 0),
  free        INTEGER NOT NULL DEFAULT 0,
  result      TEXT    NOT NULL CHECK (result IN ('win', 'loss', 'push')),
  created_at  INTEGER NOT NULL,
  UNIQUE (session_id, user_id)
);
CREATE INDEX idx_game_results_user ON game_results (guild_id, user_id, created_at);

-- Lifetime totals per member and game. xp is per-game progression (e.g. fishing level).
CREATE TABLE game_statistics (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  game        TEXT    NOT NULL,
  played      INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  pushes      INTEGER NOT NULL DEFAULT 0,
  wagered     INTEGER NOT NULL DEFAULT 0,
  returned    INTEGER NOT NULL DEFAULT 0,
  biggest_win INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, game)
);

-- Once-per-period games (the daily spin). Like reward_claims, each claim stores when its period ends.
CREATE TABLE game_claims (
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  game          TEXT    NOT NULL,
  period        TEXT    NOT NULL,
  reward        TEXT    NOT NULL,
  claimed_at    INTEGER NOT NULL,
  period_end_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, game, period)
);
CREATE INDEX idx_game_claims_latest ON game_claims (guild_id, user_id, game, claimed_at);

-- Questions each member has seen, so trivia avoids repeats.
CREATE TABLE trivia_history (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  question_id TEXT    NOT NULL,
  asked_at    INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, question_id)
);
