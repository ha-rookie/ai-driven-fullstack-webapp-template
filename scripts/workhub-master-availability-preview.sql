-- Isolated Preview-only availability lifecycle fixtures; never overwrite or reset real history.
-- These values are NOT referenced by any WORKHUB business request.
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  'workhub-office-availability-disable', 'preview', 'workhub.office', 'AVAIL_DISABLE',
  2, 2, 'availability-disable-seed', NULL,
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture',
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
) ON CONFLICT(id) DO NOTHING;

INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by
) VALUES (
  'workhub-office-availability-disable-r1', 'preview', 'workhub-office-availability-disable', 1,
  'Availability demo A', 1, '2026-01-01T00:00:00.000Z', NULL,
  101, NULL, '{}', '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
) ON CONFLICT(id) DO NOTHING;

INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  'workhub-office-availability-enable', 'preview', 'workhub.office', 'AVAIL_ENABLE',
  2, 2, 'availability-enable-seed', NULL,
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture',
  '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
) ON CONFLICT(id) DO NOTHING;

INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by
) VALUES (
  'workhub-office-availability-enable-r1', 'preview', 'workhub-office-availability-enable', 1,
  'Availability demo B', 0, '2026-01-01T00:00:00.000Z', NULL,
  102, NULL, '{}', '2026-10-04T00:00:00.000Z', 'workhub-preview-fixture'
) ON CONFLICT(id) DO NOTHING;
