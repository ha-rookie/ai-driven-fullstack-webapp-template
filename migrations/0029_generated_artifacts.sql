CREATE TABLE IF NOT EXISTS generated_artifacts (
  id TEXT NOT NULL,
  environment TEXT NOT NULL,
  report_key TEXT NOT NULL,
  definition_version TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  generation_intent TEXT NOT NULL CHECK (generation_intent IN ('original', 'regenerated_copy', 'reissue')),
  output_type TEXT NOT NULL CHECK (output_type IN ('html', 'pdf', 'xlsx', 'csv')),
  object_identifier TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready')),
  version INTEGER NOT NULL CHECK (version >= 1),
  PRIMARY KEY (environment, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_artifacts_original
  ON generated_artifacts(environment, report_key, resource_type, resource_id, source_snapshot_id, output_type)
  WHERE generation_intent = 'original';

CREATE INDEX IF NOT EXISTS idx_generated_artifacts_resource
  ON generated_artifacts(environment, resource_type, resource_id, generated_at DESC);
