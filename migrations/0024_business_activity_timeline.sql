CREATE TABLE business_activities (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  actor_ref TEXT,
  actor_display_snapshot TEXT,
  subject_ref TEXT,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_sequence INTEGER NOT NULL DEFAULT 0 CHECK (source_sequence >= 0),
  visibility_scope TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (environment, source_type, source_id)
);

CREATE INDEX idx_business_activities_resource_order
  ON business_activities (
    environment,
    resource_type,
    resource_id,
    occurred_at DESC,
    source_sequence DESC,
    id DESC
  );

CREATE INDEX idx_business_activities_resource_type
  ON business_activities (environment, resource_type, resource_id, activity_type, occurred_at DESC);
