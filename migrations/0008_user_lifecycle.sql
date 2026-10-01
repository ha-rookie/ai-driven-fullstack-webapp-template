PRAGMA foreign_keys = ON;

ALTER TABLE users
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'disabled'));
