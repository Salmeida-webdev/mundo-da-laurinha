CREATE TABLE caregivers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE account_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  caregiver_id TEXT NOT NULL UNIQUE REFERENCES caregivers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_caregiver_idx ON sessions(caregiver_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL
);

CREATE TABLE game_progress (
  caregiver_id TEXT NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL CHECK (game_id BETWEEN 1 AND 20),
  completions INTEGER NOT NULL DEFAULT 0 CHECK (completions BETWEEN 0 AND 50000),
  last_played TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  favorite_changed_at TEXT,
  PRIMARY KEY (caregiver_id, game_id)
);
