ALTER TABLE idempotency_records
  ADD COLUMN replay_status INTEGER
  CHECK(replay_status IS NULL OR replay_status BETWEEN 200 AND 299);

ALTER TABLE idempotency_records
  ADD COLUMN replay_content_type TEXT
  CHECK(replay_content_type IS NULL OR length(trim(replay_content_type)) BETWEEN 1 AND 128);

ALTER TABLE idempotency_records
  ADD COLUMN replay_body TEXT;
