CREATE TABLE IF NOT EXISTS search_index_documents (
  environment TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  search_text TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  source_version TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  tombstoned_at TEXT,
  PRIMARY KEY (environment, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_search_index_documents_lookup
  ON search_index_documents(environment, tombstoned_at, category, source_updated_at DESC);
