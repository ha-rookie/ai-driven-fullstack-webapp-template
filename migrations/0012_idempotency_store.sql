PRAGMA foreign_keys = ON;

CREATE TABLE idempotency_records (
  idempotency_key TEXT NOT NULL CHECK(length(trim(idempotency_key)) BETWEEN 1 AND 128),
  actor_id TEXT NOT NULL CHECK(length(trim(actor_id)) BETWEEN 1 AND 128),
  scope_id TEXT NOT NULL CHECK(length(trim(scope_id)) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK(length(trim(action)) BETWEEN 1 AND 128),
  fingerprint TEXT NOT NULL CHECK(length(trim(fingerprint)) BETWEEN 1 AND 256),
  state TEXT NOT NULL CHECK(state IN ('in_progress', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (idempotency_key, actor_id, scope_id, action)
);

CREATE INDEX idx_idempotency_records_expiry
  ON idempotency_records(expires_at, state);
