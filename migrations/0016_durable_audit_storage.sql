CREATE TABLE durable_audit_events (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('local', 'test', 'preview', 'production')),
  occurred_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('authentication', 'authorization', 'mutation', 'system')),
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  actor_id TEXT,
  scope_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  record_json TEXT NOT NULL,
  record_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_durable_audit_environment_time
  ON durable_audit_events (environment, occurred_at DESC, id DESC);

CREATE INDEX idx_durable_audit_actor_time
  ON durable_audit_events (environment, actor_id, occurred_at DESC, id DESC);

CREATE INDEX idx_durable_audit_scope_time
  ON durable_audit_events (environment, scope_id, occurred_at DESC, id DESC);

CREATE INDEX idx_durable_audit_resource_time
  ON durable_audit_events (environment, resource_type, resource_id, occurred_at DESC, id DESC);
