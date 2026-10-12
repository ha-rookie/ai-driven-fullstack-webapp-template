-- Temporary, explicit Preview-only fixture for WORKHUB Stage4 #348.
-- Six existing demo identities only. Do not modify users, credentials, roles,
-- operation modes, master data, or other WORKHUB business records.
PRAGMA foreign_keys = ON;

INSERT INTO workhub_department_memberships (scope_id, user_id, department_code, updated_at)
VALUES
  ('workhub-company', 'workhub-demo-haru', 'engineering', '2026-10-13T00:00:00.000Z'),
  ('workhub-company', 'workhub-demo-aoi', 'engineering', '2026-10-13T00:00:00.000Z'),
  ('workhub-company', 'workhub-demo-ren', 'engineering', '2026-10-13T00:00:00.000Z'),
  ('workhub-company', 'workhub-demo-mei', 'finance', '2026-10-13T00:00:00.000Z'),
  ('workhub-company', 'workhub-demo-sora', 'people', '2026-10-13T00:00:00.000Z'),
  ('workhub-company', 'workhub-demo-kai', 'it', '2026-10-13T00:00:00.000Z')
ON CONFLICT(scope_id, user_id) DO UPDATE SET
  department_code = excluded.department_code,
  updated_at = excluded.updated_at;
