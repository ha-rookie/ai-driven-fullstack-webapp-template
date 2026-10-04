CREATE TABLE workflow_instances (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  definition_key TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  requester_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'awaiting_resubmission', 'completed', 'rejected', 'withdrawn')),
  current_step_key TEXT,
  returned_step_key TEXT,
  version INTEGER NOT NULL,
  next_work_item_sequence INTEGER NOT NULL,
  next_transition_sequence INTEGER NOT NULL,
  submission_key TEXT NOT NULL,
  last_mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (environment, submission_key)
);

CREATE INDEX idx_workflow_instances_resource
  ON workflow_instances (environment, resource_type, resource_id, created_at DESC);

CREATE INDEX idx_workflow_instances_requester_state
  ON workflow_instances (environment, requester_id, state, updated_at DESC);

CREATE TABLE workflow_work_items (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  assignee_principal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'approved', 'returned', 'rejected', 'cancelled')),
  sequence INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  due_at TEXT,
  completed_at TEXT,
  completed_by TEXT,
  UNIQUE (workflow_instance_id, sequence),
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_workflow_work_items_one_open
  ON workflow_work_items (workflow_instance_id)
  WHERE status = 'open';

CREATE INDEX idx_workflow_work_items_assignee_open
  ON workflow_work_items (environment, assignee_principal, status, created_at DESC);

CREATE TABLE workflow_transitions (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  workflow_instance_id TEXT NOT NULL,
  work_item_id TEXT,
  sequence INTEGER NOT NULL,
  transition TEXT NOT NULL CHECK (transition IN ('submit', 'approve', 'return', 'resubmit', 'reject', 'withdraw')),
  actor_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  from_step_key TEXT,
  to_step_key TEXT,
  definition_version INTEGER NOT NULL,
  reason_code TEXT,
  comment TEXT,
  request_id TEXT,
  correlation_id TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE (workflow_instance_id, sequence),
  FOREIGN KEY (workflow_instance_id) REFERENCES workflow_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (work_item_id) REFERENCES workflow_work_items(id) ON DELETE SET NULL
);

CREATE INDEX idx_workflow_transitions_instance_sequence
  ON workflow_transitions (workflow_instance_id, sequence DESC);
