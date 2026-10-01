PRAGMA foreign_keys = ON;

CREATE TABLE scope_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scope_id TEXT NOT NULL,
  invitee_identifier TEXT,
  intended_role TEXT NOT NULL CHECK(length(trim(intended_role)) > 0),
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES resource_scopes(id) ON DELETE CASCADE
);

CREATE INDEX idx_scope_invitations_scope_state
  ON scope_invitations(scope_id, revoked_at, redeemed_at, expires_at);

CREATE INDEX idx_scope_invitations_invitee
  ON scope_invitations(scope_id, invitee_identifier, intended_role);
