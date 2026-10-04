CREATE TABLE IF NOT EXISTS integration_events (
  id TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  occurred_at TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (environment, id)
);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id TEXT NOT NULL,
  environment TEXT NOT NULL,
  integration_event_id TEXT NOT NULL,
  destination_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'retry_wait', 'delivered', 'dead_letter')),
  available_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  delivered_at TEXT,
  dead_lettered_at TEXT,
  failure_code TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, id),
  UNIQUE (environment, integration_event_id, destination_key),
  FOREIGN KEY (environment, integration_event_id) REFERENCES integration_events(environment, id)
);

CREATE INDEX IF NOT EXISTS idx_integration_events_type_time
  ON integration_events(environment, event_type, occurred_at, id);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_due
  ON integration_outbox(environment, status, available_at, id);

CREATE INDEX IF NOT EXISTS idx_integration_outbox_event
  ON integration_outbox(environment, integration_event_id, destination_key);
