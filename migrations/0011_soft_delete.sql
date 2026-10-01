PRAGMA foreign_keys = ON;

ALTER TABLE example_resources
  ADD COLUMN deleted_at TEXT;

ALTER TABLE example_resources
  ADD COLUMN deleted_by TEXT;

CREATE INDEX idx_example_resources_active_created_at
  ON example_resources(deleted_at, created_at, id);
