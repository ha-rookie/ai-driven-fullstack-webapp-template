PRAGMA foreign_keys = ON;

ALTER TABLE application_sessions
  ADD COLUMN last_seen_at TEXT;

UPDATE application_sessions
SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE last_seen_at IS NULL;
