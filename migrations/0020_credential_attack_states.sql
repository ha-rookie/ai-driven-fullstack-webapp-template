CREATE TABLE IF NOT EXISTS credential_attack_states (
  environment TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('identifier', 'network')),
  subject_hash TEXT NOT NULL,
  failure_count INTEGER NOT NULL CHECK (failure_count >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, endpoint_id, dimension, subject_hash)
);

CREATE INDEX IF NOT EXISTS idx_credential_attack_updated
  ON credential_attack_states (environment, updated_at);

CREATE INDEX IF NOT EXISTS idx_credential_attack_locked
  ON credential_attack_states (environment, locked_until)
  WHERE locked_until IS NOT NULL;
