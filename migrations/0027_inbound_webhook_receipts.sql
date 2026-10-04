CREATE TABLE IF NOT EXISTS inbound_webhook_receipts (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_event_id TEXT,
  replay_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(environment, provider_key, replay_key)
);

CREATE INDEX IF NOT EXISTS idx_inbound_webhook_receipts_provider_event
  ON inbound_webhook_receipts(environment, provider_key, provider_event_id);

CREATE INDEX IF NOT EXISTS idx_inbound_webhook_receipts_status_time
  ON inbound_webhook_receipts(environment, status, received_at);
