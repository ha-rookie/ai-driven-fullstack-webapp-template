ALTER TABLE generated_artifacts ADD COLUMN expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_generated_artifacts_expiry
  ON generated_artifacts(environment, expires_at)
  WHERE expires_at IS NOT NULL;
