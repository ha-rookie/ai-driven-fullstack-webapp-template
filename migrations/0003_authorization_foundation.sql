PRAGMA foreign_keys = ON;

CREATE TABLE resource_scopes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scope_memberships (
  scope_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(length(trim(role)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, user_id),
  FOREIGN KEY (scope_id) REFERENCES resource_scopes(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_scope_memberships_user
  ON scope_memberships(user_id, scope_id);

CREATE INDEX idx_scope_memberships_scope_role
  ON scope_memberships(scope_id, role);
