CREATE TABLE transactional_notifications (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  recipient_principal TEXT NOT NULL,
  category TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  title_key TEXT NOT NULL,
  message_key TEXT NOT NULL,
  presentation_args_json TEXT NOT NULL DEFAULT '{}',
  action_target TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  dedupe_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  read_at TEXT,
  archived_at TEXT,
  expires_at TEXT,
  UNIQUE (environment, dedupe_key)
);

CREATE INDEX idx_transactional_notifications_recipient_time
  ON transactional_notifications (environment, recipient_principal, created_at DESC, id DESC);
CREATE INDEX idx_transactional_notifications_unread
  ON transactional_notifications (environment, recipient_principal, read_at, archived_at);
CREATE INDEX idx_transactional_notifications_source
  ON transactional_notifications (environment, source_type, source_id);
