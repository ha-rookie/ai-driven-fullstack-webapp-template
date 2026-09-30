PRAGMA foreign_keys = ON;

INSERT INTO users(id, display_name, created_at, updated_at) VALUES
  ('user-editor', 'Boundary Editor', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-viewer', 'Boundary Viewer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('user-scope-b', 'Boundary Scope B Editor', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO resource_scopes(id, name, created_at, updated_at) VALUES
  ('scope-a', 'Boundary Scope A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('scope-b', 'Boundary Scope B', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO scope_memberships(scope_id, user_id, role, created_at, updated_at) VALUES
  ('scope-a', 'user-editor', 'editor', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('scope-a', 'user-viewer', 'viewer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('scope-b', 'user-scope-b', 'editor', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO application_sessions(token_hash, user_id, expires_at, revoked_at, created_at, last_seen_at) VALUES
  ('BH9BdcbO7JY1rLfC6WXuZ1rYGtjpMpNZTfkkhgDvrb4', 'user-editor', '2099-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('YKju1blZRrQcYEnAQbZFVsij-aDvYlNAgyFIVarl-94', 'user-viewer', '2099-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('xMFTtmdmR1gPOTpjnodby4LK6CmJ-zbjCwSKnlCBzHg', 'user-scope-b', '2099-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO example_resources(id, name, created_at, updated_at, status, version) VALUES
  ('resource-a', 'Original Resource', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'draft', 1);

INSERT INTO example_resource_scope_bindings(resource_id, scope_id, created_at) VALUES
  ('resource-a', 'scope-a', '2026-01-01T00:00:00.000Z');
