-- #288: user-owned preferences with environment isolation and atomic version checks.
-- Separate from identity/session tables; no existing user row is overwritten.
PRAGMA foreign_keys = ON;

CREATE TABLE user_preferences (
  environment TEXT NOT NULL CHECK (environment IN ('local', 'test', 'preview', 'production')),
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  locale TEXT,
  timezone TEXT,
  theme TEXT CHECK (theme IS NULL OR theme IN ('light', 'dark', 'system')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
