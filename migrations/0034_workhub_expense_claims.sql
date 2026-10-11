-- WORKHUB reference: compact expense reports (up to five JSON-encoded
-- validated detail lines). Amounts are integer JPY, totaled on the Worker.
-- Intentionally independent from travel request records and payroll/GL.
CREATE TABLE workhub_expense_claims (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  travel_request_id TEXT,
  lines_json TEXT NOT NULL CHECK (json_valid(lines_json)),
  total_yen INTEGER NOT NULL CHECK (total_yen BETWEEN 1 AND 2000000),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'returned', 'approved')),
  return_reason TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_workhub_expense_owner_recent
  ON workhub_expense_claims (environment, requester_id, updated_at DESC, id DESC);
CREATE INDEX idx_workhub_expense_review_recent
  ON workhub_expense_claims (environment, status, updated_at DESC, id DESC);
