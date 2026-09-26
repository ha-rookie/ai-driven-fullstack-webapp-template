PRAGMA foreign_keys = ON;

ALTER TABLE example_resources
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'active', 'finalized'));

ALTER TABLE example_resources
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1
  CHECK (version >= 1);

CREATE TABLE example_resource_changes (
  resource_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 2),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('rename', 'status_transition')),
  from_status TEXT,
  to_status TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (resource_id, version),
  FOREIGN KEY (resource_id) REFERENCES example_resources(id) ON DELETE CASCADE,
  CHECK (
    (change_kind = 'rename' AND from_status IS NULL AND to_status IS NULL)
    OR
    (
      change_kind = 'status_transition'
      AND from_status IN ('draft', 'active')
      AND to_status IN ('active', 'finalized')
      AND from_status <> to_status
    )
  )
);

CREATE INDEX idx_example_resource_changes_resource
  ON example_resource_changes(resource_id, version);
