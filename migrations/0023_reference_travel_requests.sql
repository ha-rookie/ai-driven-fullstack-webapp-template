CREATE TABLE reference_travel_requests (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  destination_office_item_id TEXT NOT NULL,
  destination_office_revision_id TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitting', 'submitted')),
  submission_key TEXT UNIQUE,
  workflow_instance_id TEXT UNIQUE,
  submitted_at TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (destination_office_item_id) REFERENCES master_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_office_revision_id) REFERENCES master_revisions(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id) ON DELETE RESTRICT,
  CHECK (start_date <= end_date),
  CHECK (
    (status = 'draft'
      AND destination_office_revision_id IS NULL
      AND submission_key IS NULL
      AND workflow_instance_id IS NULL
      AND submitted_at IS NULL)
    OR
    (status = 'submitting'
      AND destination_office_revision_id IS NOT NULL
      AND submission_key IS NOT NULL
      AND workflow_instance_id IS NULL
      AND submitted_at IS NULL)
    OR
    (status = 'submitted'
      AND destination_office_revision_id IS NOT NULL
      AND submission_key IS NOT NULL
      AND workflow_instance_id IS NOT NULL
      AND submitted_at IS NOT NULL)
  )
);

CREATE INDEX idx_reference_travel_requests_requester_status
  ON reference_travel_requests (environment, requester_id, status, updated_at);

CREATE INDEX idx_reference_travel_requests_destination
  ON reference_travel_requests (environment, destination_office_item_id, start_date);
