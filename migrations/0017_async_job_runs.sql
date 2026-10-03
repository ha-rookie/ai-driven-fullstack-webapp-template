CREATE TABLE IF NOT EXISTS async_job_runs (
  environment TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'retrying', 'completed', 'failed', 'dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  progress_percent INTEGER CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)),
  progress_code TEXT,
  failure_code TEXT,
  PRIMARY KEY (environment, job_id),
  UNIQUE (environment, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_async_job_runs_state_due
  ON async_job_runs (environment, state, next_attempt_at, lease_expires_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_async_job_runs_type_updated
  ON async_job_runs (environment, job_type, updated_at DESC);
