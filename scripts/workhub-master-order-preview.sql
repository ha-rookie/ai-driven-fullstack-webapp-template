-- Preview-only, non-destructive display-order acceptance fixture.
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  'workhub-office-order', 'preview', 'workhub.office', 'ORDER_DEMO',
  2, 2, 'order-demo-seed', NULL,
  '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture',
  '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO NOTHING;

INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled, effective_from,
  effective_to, display_order, parent_item_id, attributes_json, created_at, created_by
) VALUES (
  'workhub-office-order-r1', 'preview', 'workhub-office-order', 1,
  'Order demo unchanged', 1, '2026-01-01T00:00:00.000Z',
  NULL, 95, NULL, '{"role":"demo"}',
  '2026-10-09T00:00:00.000Z', 'workhub-preview-fixture'
)
ON CONFLICT(id) DO NOTHING;
