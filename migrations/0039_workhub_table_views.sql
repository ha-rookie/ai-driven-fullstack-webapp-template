-- #291: isolated user/table preferences and owned personal Saved Views.
-- Do not apply remotely without a separate environment-specific Human Gate approval.
PRAGMA foreign_keys = ON;
CREATE TABLE workhub_table_preferences (
  environment TEXT NOT NULL CHECK(environment IN ('local','test','preview','production')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version >= 1),
  schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
  value_json TEXT NOT NULL CHECK(length(value_json) <= 8192),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(environment,user_id,table_id)
);
CREATE TABLE workhub_saved_views (
  id TEXT NOT NULL,environment TEXT NOT NULL CHECK(environment IN ('local','test','preview','production')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  version INTEGER NOT NULL CHECK(version >= 1),
  schema_version INTEGER NOT NULL CHECK(schema_version >= 1),
  value_json TEXT NOT NULL CHECK(length(value_json) <= 8192),
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(environment,user_id,id)
);
CREATE INDEX idx_workhub_saved_views_owner ON workhub_saved_views(environment,user_id,table_id,updated_at DESC);
