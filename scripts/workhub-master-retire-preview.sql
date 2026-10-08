-- WORKHUB Preview-only acceptance fixture for #418.
-- This is a dedicated master item not referenced by the travel request scenario.
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  'workhub-office-legacy', 'preview', 'workhub.office', 'LEGACY', 2, 2, 'workhub-office-legacy-seed',
  NULL, '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture',
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO UPDATE SET
  version = 2, next_revision = 2, last_mutation_id = 'workhub-office-legacy-seed',
  retired_at = NULL, updated_at = '2026-10-04T00:00:00.000Z',
  updated_by = 'workhub-preview-fixture'
WHERE environment = 'preview' AND master_key = 'workhub.office' AND code = 'LEGACY';

INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id,
  attributes_json, created_at, created_by
) VALUES (
  'workhub-office-legacy-r1', 'preview', 'workhub-office-legacy', 1,
  'Retire demo office', 1, '2026-01-01T00:00:00.000Z', NULL,
  90, NULL, '{}', '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO UPDATE SET
  label = 'Retire demo office', enabled = 1,
  effective_from = '2026-01-01T00:00:00.000Z', effective_to = NULL,
  display_order = 90, parent_item_id = NULL, attributes_json = '{}'
WHERE environment = 'preview' AND master_item_id = 'workhub-office-legacy';
