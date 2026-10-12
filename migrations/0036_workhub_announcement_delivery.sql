-- Stage4 #348 Reference company announcement delivery metadata.
-- Existing company announcements stay visible to all current WORKHUB members
-- as NORMAL until explicitly replaced. This is a local-schema code change;
-- remote Preview/Production D1 apply remains a separate Human Gate.
ALTER TABLE workhub_announcements
  ADD COLUMN importance TEXT NOT NULL DEFAULT 'normal'
    CHECK (importance IN ('normal', 'important', 'critical'));
ALTER TABLE workhub_announcements
  ADD COLUMN audience_role TEXT DEFAULT NULL
    CHECK (audience_role IS NULL OR audience_role IN
      ('newcomer', 'employee', 'manager', 'accounting', 'corporate', 'system_admin'));
ALTER TABLE workhub_announcements
  ADD COLUMN visible_from TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
ALTER TABLE workhub_announcements
  ADD COLUMN visible_until TEXT DEFAULT NULL;
CREATE INDEX idx_workhub_announcements_delivery
  ON workhub_announcements (environment, audience_role, visible_from, visible_until, published_at DESC);
