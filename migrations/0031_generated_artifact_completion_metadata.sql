ALTER TABLE generated_artifacts ADD COLUMN requested_at TEXT;

UPDATE generated_artifacts
SET requested_at = generated_at
WHERE requested_at IS NULL;

CREATE TABLE generated_artifacts_lifecycle_next (
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
  content_type TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
  requested_at TEXT NOT NULL,
  generated_at TEXT,
  generated_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  failure_code TEXT,
  CHECK (
    (status = 'ready' AND content_type IS NOT NULL AND byte_length IS NOT NULL AND generated_at IS NOT NULL)
    OR status <> 'ready'
  ),
  PRIMARY KEY (environment, id)
);

INSERT INTO generated_artifacts_lifecycle_next (
  id, environment, report_key, definition_version, template_key, template_version,
  resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
  object_identifier, content_type, byte_length, requested_at, generated_at, generated_by,
  status, version, failure_code
)
SELECT id, environment, report_key, definition_version, template_key, template_version,
       resource_type, resource_id, source_snapshot_id, generation_intent, output_type,
       object_identifier,
       CASE WHEN status = 'ready' THEN content_type ELSE NULL END,
       CASE WHEN status = 'ready' THEN byte_length ELSE NULL END,
       requested_at,
       CASE WHEN status = 'ready' THEN generated_at ELSE NULL END,
       generated_by, status, version, failure_code
FROM generated_artifacts;

DROP TABLE generated_artifacts;
ALTER TABLE generated_artifacts_lifecycle_next RENAME TO generated_artifacts;

CREATE UNIQUE INDEX idx_generated_artifacts_original
  ON generated_artifacts(environment, report_key, resource_type, resource_id, source_snapshot_id, output_type)
  WHERE generation_intent = 'original';

CREATE INDEX idx_generated_artifacts_resource
  ON generated_artifacts(environment, resource_type, resource_id, requested_at DESC);
