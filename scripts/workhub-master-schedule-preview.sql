-- Preview-only isolated future master revision cutover acceptance.
-- Never run against Production.
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  'workhub-office-schedule', 'preview', 'workhub.office', 'SCHEDULE_DEMO',
  2, 2, 'workhub-office-schedule-seed', NULL,
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture',
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO NOTHING;

-- Reset only this dedicated demo revision to its known pre-cutover state.
INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id,
  attributes_json, created_at, created_by
) VALUES (
  'workhub-office-schedule-r1', 'preview', 'workhub-office-schedule', 1,
  'Scheduled Office Original', 1, '2026-01-01T00:00:00.000Z', NULL,
  95, NULL, '{}', '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO NOTHING;

-- Intentionally no reset or DELETE: repeat seeds preserve Revision history and operation evidence.
