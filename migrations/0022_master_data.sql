CREATE TABLE master_items (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  master_key TEXT NOT NULL,
  code TEXT NOT NULL,
  version INTEGER NOT NULL,
  next_revision INTEGER NOT NULL,
  last_mutation_id TEXT NOT NULL,
  retired_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (environment, master_key, code)
);

CREATE INDEX idx_master_items_key_code
  ON master_items (environment, master_key, code);

CREATE INDEX idx_master_items_key_retired
  ON master_items (environment, master_key, retired_at);

CREATE TABLE master_revisions (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  master_item_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  display_order INTEGER NOT NULL,
  parent_item_id TEXT,
  attributes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (master_item_id, revision),
  FOREIGN KEY (master_item_id) REFERENCES master_items(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_item_id) REFERENCES master_items(id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_from < effective_to),
  CHECK (parent_item_id IS NULL OR parent_item_id <> master_item_id)
);

CREATE INDEX idx_master_revisions_item_effective
  ON master_revisions (master_item_id, effective_from, effective_to);

CREATE INDEX idx_master_revisions_parent
  ON master_revisions (environment, parent_item_id, effective_from);

CREATE INDEX idx_master_revisions_selectable
  ON master_revisions (environment, enabled, effective_from, effective_to, display_order);
