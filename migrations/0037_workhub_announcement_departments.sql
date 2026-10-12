-- Stage4 #348: current WORKHUB department membership is stored independently of
-- business role, on the same authoritative scope/user pair. Demo fixtures are
-- inserted explicitly by seed scripts, not inferred from users' roles.
PRAGMA foreign_keys = ON;

CREATE TABLE workhub_department_memberships (
  scope_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  department_code TEXT NOT NULL
    CHECK (department_code IN ('engineering', 'finance', 'people', 'it')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_id, user_id),
  FOREIGN KEY (scope_id, user_id)
    REFERENCES scope_memberships(scope_id, user_id) ON DELETE CASCADE
);

CREATE INDEX idx_workhub_department_memberships_department
  ON workhub_department_memberships (scope_id, department_code);

ALTER TABLE workhub_announcements
  ADD COLUMN audience_department TEXT DEFAULT NULL
    CHECK (audience_department IS NULL OR audience_department IN
      ('engineering', 'finance', 'people', 'it'));

CREATE INDEX idx_workhub_announcements_department
  ON workhub_announcements (environment, audience_department, published_at DESC);
