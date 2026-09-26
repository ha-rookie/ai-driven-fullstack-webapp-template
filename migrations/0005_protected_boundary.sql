PRAGMA foreign_keys = ON;

CREATE TABLE example_resource_scope_bindings (
  resource_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES example_resources(id) ON DELETE CASCADE,
  FOREIGN KEY (scope_id) REFERENCES resource_scopes(id) ON DELETE CASCADE
);

CREATE INDEX idx_example_resource_scope_bindings_scope
  ON example_resource_scope_bindings(scope_id, resource_id);
