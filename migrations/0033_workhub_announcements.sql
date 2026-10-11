-- WORKHUB reference app only: company announcements are a separate
-- source from individual workflow notifications and social posts.
CREATE TABLE workhub_announcements (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author_id TEXT NOT NULL,
  published_at TEXT NOT NULL
);
CREATE INDEX idx_workhub_announcements_recent
  ON workhub_announcements (environment, published_at DESC, id DESC);
