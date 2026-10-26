-- Lyss Community, phase 8: inventory, member progression and pets.
-- All times are UTC milliseconds. Quantities and XP can never be negative.

-- ── Inventory ───────────────────────────────────────────────────────────────

-- Stackable items (food, materials, eggs, accessories). Item definitions live in services/items.js.
CREATE TABLE inventory_items (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  item_key   TEXT    NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, item_key)
);

-- Every quantity change, like economy_transactions for coins.
CREATE TABLE inventory_transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT    NOT NULL,
  user_id        TEXT    NOT NULL,
  item_key       TEXT    NOT NULL,
  delta          INTEGER NOT NULL CHECK (delta != 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  type           TEXT    NOT NULL,
  reference      TEXT,
  operation_key  TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_inventory_transactions_user ON inventory_transactions (guild_id, user_id, created_at);

-- ── Member progression ──────────────────────────────────────────────────────

CREATE TABLE member_progression (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level      INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX idx_member_progression_xp ON member_progression (guild_id, xp);

-- Every XP award. The unique key means one activity can never award XP twice.
CREATE TABLE xp_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT    NOT NULL,
  user_id       TEXT    NOT NULL,
  source        TEXT    NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  operation_key TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, user_id, operation_key)
);
CREATE INDEX idx_xp_transactions_source ON xp_transactions (guild_id, user_id, source, created_at);

-- Level rewards, granted once per level.
CREATE TABLE level_rewards (
  guild_id   TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  level      INTEGER NOT NULL,
  rewards    TEXT    NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, level)
);

-- Titles and badges a member has unlocked (shown on profiles).
CREATE TABLE member_unlocks (
  guild_id    TEXT    NOT NULL,
  user_id     TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('title', 'badge')),
  unlock_key  TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, kind, unlock_key)
);

-- ── Pets ────────────────────────────────────────────────────────────────────

-- Released pets are kept (status 'released') so collection history survives.
-- happiness and energy are stored as of needs_at; services/pets/rules.js brings them up to date.
CREATE TABLE pets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT    NOT NULL,
  owner_id        TEXT    NOT NULL,
  species         TEXT    NOT NULL,
  variant         TEXT    NOT NULL,
  name            TEXT,
  stage           INTEGER NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 3),
  xp              INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  happiness       INTEGER NOT NULL CHECK (happiness BETWEEN 0 AND 100),
  energy          INTEGER NOT NULL CHECK (energy BETWEEN 0 AND 100),
  needs_at        INTEGER NOT NULL,
  traits          TEXT    NOT NULL DEFAULT '[]',
  training        TEXT    NOT NULL DEFAULT '{}',
  status          TEXT    NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'sleeping', 'expedition', 'battle', 'released')),
  busy_until      INTEGER,
  active          INTEGER NOT NULL DEFAULT 0,
  source          TEXT    NOT NULL,
  fed_at          INTEGER,
  played_at       INTEGER,
  trained_at      INTEGER,
  explored_at     INTEGER,
  times_trained   INTEGER NOT NULL DEFAULT 0,
  expeditions     INTEGER NOT NULL DEFAULT 0,
  battles_won     INTEGER NOT NULL DEFAULT 0,
  battles_lost    INTEGER NOT NULL DEFAULT 0,
  adopted_at      INTEGER NOT NULL,
  evolved_at      INTEGER,
  released_at     INTEGER
);
CREATE INDEX idx_pets_owner ON pets (guild_id, owner_id, status);
CREATE INDEX idx_pets_xp ON pets (guild_id, xp);
-- One active (equipped) pet per member.
CREATE UNIQUE INDEX idx_pets_one_active ON pets (guild_id, owner_id) WHERE active = 1;

-- Accessories worn by a pet, one per slot. Taking one off returns it to the inventory.
CREATE TABLE pet_cosmetics (
  pet_id      INTEGER NOT NULL REFERENCES pets (id) ON DELETE CASCADE,
  slot        TEXT    NOT NULL,
  item_key    TEXT    NOT NULL,
  equipped_at INTEGER NOT NULL,
  PRIMARY KEY (pet_id, slot)
);

-- Timed trips. Rewards are rolled and granted when claimed, exactly once.
CREATE TABLE pet_expeditions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT    NOT NULL,
  owner_id    TEXT    NOT NULL,
  pet_id      INTEGER NOT NULL REFERENCES pets (id),
  destination TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'claimed', 'recalled')),
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  finished_at INTEGER,
  rewards     TEXT,
  channel_id  TEXT,
  message_id  TEXT
);
CREATE UNIQUE INDEX idx_pet_expeditions_one_per_pet ON pet_expeditions (pet_id) WHERE status = 'active';
CREATE INDEX idx_pet_expeditions_owner ON pet_expeditions (guild_id, owner_id, status);

-- Turn-based pet battles. Both pets are snapshotted into the state when the battle starts.
-- open: waiting for the opponent (the challenger's pet is reserved) · active: in play.
CREATE TABLE pet_battles (
  id              TEXT    PRIMARY KEY,
  guild_id        TEXT    NOT NULL,
  host_id         TEXT    NOT NULL,
  opponent_id     TEXT    NOT NULL,
  host_pet_id     INTEGER NOT NULL REFERENCES pets (id),
  opponent_pet_id INTEGER REFERENCES pets (id),
  state           TEXT,
  status          TEXT    NOT NULL CHECK (status IN ('open', 'active', 'finished', 'cancelled', 'expired')),
  winner_id       TEXT,
  rewarded        INTEGER NOT NULL DEFAULT 0,
  channel_id      TEXT,
  message_id      TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  expires_at      INTEGER NOT NULL,
  finished_at     INTEGER
);
CREATE UNIQUE INDEX idx_pet_battles_one_per_host ON pet_battles (guild_id, host_id) WHERE status IN ('open', 'active');
CREATE INDEX idx_pet_battles_due ON pet_battles (status, expires_at);
CREATE INDEX idx_pet_battles_finished ON pet_battles (guild_id, finished_at);
