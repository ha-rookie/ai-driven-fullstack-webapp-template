CREATE INDEX idx_example_resources_status_updated
  ON example_resources(status, updated_at DESC, id DESC);
