CREATE TABLE IF NOT EXISTS saml_assertion_replays (
  environment TEXT NOT NULL,
  provider TEXT NOT NULL,
  assertion_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  PRIMARY KEY (environment, provider, assertion_id)
);

CREATE INDEX IF NOT EXISTS idx_saml_assertion_replays_expiry
  ON saml_assertion_replays (environment, expires_at);
