-- WORKHUB Reference-only time-bounded travel approval delegation.
-- This is a local migration in PR CI; no remote D1 migration is authorized.
CREATE TABLE workhub_travel_delegations (
  environment TEXT NOT NULL,
  delegator_id TEXT NOT NULL,
  delegate_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  step_key TEXT NOT NULL,
  action_scope TEXT NOT NULL CHECK (action_scope = 'approve_return'),
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (environment, delegator_id, delegate_id, resource_type, step_key),
  CHECK (valid_from < valid_until),
  CHECK (delegator_id != delegate_id)
);

CREATE INDEX idx_workhub_travel_delegate_active
  ON workhub_travel_delegations (environment, delegate_id, valid_until);
