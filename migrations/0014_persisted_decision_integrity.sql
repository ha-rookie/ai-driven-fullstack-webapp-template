PRAGMA foreign_keys = ON;

CREATE TABLE example_resource_decisions (
  resource_id TEXT PRIMARY KEY,
  source_snapshot TEXT NOT NULL CHECK(length(trim(source_snapshot)) BETWEEN 1 AND 4096),
  decision_value TEXT NOT NULL CHECK(length(trim(decision_value)) BETWEEN 1 AND 256),
  rule_version TEXT NOT NULL CHECK(length(trim(rule_version)) BETWEEN 1 AND 128),
  decision_version INTEGER NOT NULL DEFAULT 1 CHECK(decision_version >= 1),
  decided_at TEXT NOT NULL,
  decided_by TEXT NOT NULL CHECK(length(trim(decided_by)) BETWEEN 1 AND 128),
  FOREIGN KEY (resource_id) REFERENCES example_resources(id) ON DELETE CASCADE
);

CREATE INDEX idx_example_resource_decisions_rule
  ON example_resource_decisions(rule_version, decided_at);
