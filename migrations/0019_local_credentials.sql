PRAGMA foreign_keys = ON;

CREATE TABLE local_credentials (
  user_id TEXT PRIMARY KEY,
  identifier_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_local_credentials_identifier
  ON local_credentials(identifier_normalized);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_password_reset_tokens_user_state
  ON password_reset_tokens(user_id, consumed_at, expires_at);

CREATE INDEX idx_password_reset_tokens_expiry
  ON password_reset_tokens(expires_at);
