-- Dedicated, non-destructive Preview-only fixtures for transactionally durable Master Audit acceptance.
-- No DELETE, UPDATE, reset or Production binding. Re-running preserves prior evidence.
INSERT INTO master_items (id, environment, master_key, code, version, next_revision,
  last_mutation_id, retired_at, created_at, created_by, updated_at, updated_by)
VALUES ('workhub-office-audit-schedule', 'preview', 'workhub.office', 'AUDIT_SCHEDULE',
  2, 2, 'audit-schedule-seed', NULL, '2026-10-09T00:00:00.000Z',
  'workhub-preview-fixture', '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture')
ON CONFLICT(id) DO NOTHING;

INSERT INTO master_revisions (id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by)
VALUES ('workhub-office-audit-schedule-r1', 'preview', 'workhub-office-audit-schedule',
  1, 'Audit schedule before', 1, '2026-01-01T00:00:00.000Z', NULL, 97, NULL,
  '{}', '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture')
ON CONFLICT(id) DO NOTHING;

INSERT INTO master_items (id, environment, master_key, code, version, next_revision,
  last_mutation_id, retired_at, created_at, created_by, updated_at, updated_by)
VALUES ('workhub-office-audit-retire', 'preview', 'workhub.office', 'AUDIT_RETIRE',
  2, 2, 'audit-retire-seed', NULL, '2026-10-09T00:00:00.000Z',
  'workhub-preview-fixture', '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture')
ON CONFLICT(id) DO NOTHING;

INSERT INTO master_revisions (id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by)
VALUES ('workhub-office-audit-retire-r1', 'preview', 'workhub-office-audit-retire',
  1, 'Audit retire before', 1, '2026-01-01T00:00:00.000Z', NULL, 98, NULL,
  '{}', '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture')
ON CONFLICT(id) DO NOTHING;
