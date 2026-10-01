#!/usr/bin/env bash
set -euo pipefail

suffix="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"
user_id="__session_rotation_user_${suffix}"
old_hash="${suffix}-old"
new_hash="${suffix}-new"
stale_old_hash="${suffix}-stale-old"
stale_new_hash="${suffix}-stale-new"
created_at="2026-01-01T00:00:00.000Z"
rotated_at="2026-01-01T00:02:00.000Z"
expires_at="2026-01-01T01:00:00.000Z"

run_sql() {
  npx wrangler d1 execute DB --local --command "$1"
}

run_sql "INSERT INTO users(id,display_name,created_at,updated_at) VALUES ('$user_id','Rotation Test','$created_at','$created_at');
INSERT INTO application_sessions(token_hash,user_id,expires_at,revoked_at,created_at,last_seen_at) VALUES
  ('$old_hash','$user_id','$expires_at',NULL,'$created_at','$created_at'),
  ('$stale_old_hash','$user_id','$expires_at',NULL,'$created_at','$created_at');"

run_sql "UPDATE application_sessions
SET revoked_at='$rotated_at'
WHERE token_hash='$old_hash'
  AND user_id='$user_id'
  AND revoked_at IS NULL
  AND expires_at='$expires_at'
  AND last_seen_at='$created_at';
INSERT INTO application_sessions(token_hash,user_id,expires_at,created_at,last_seen_at)
SELECT '$new_hash','$user_id','$expires_at','$rotated_at','$rotated_at'
WHERE changes()=1;"

run_sql "SELECT COUNT(*) AS oldRevoked FROM application_sessions WHERE token_hash='$old_hash' AND revoked_at='$rotated_at';
SELECT COUNT(*) AS newActive FROM application_sessions WHERE token_hash='$new_hash' AND revoked_at IS NULL;
SELECT COUNT(*) AS sameExpiry FROM application_sessions WHERE token_hash='$new_hash' AND expires_at='$expires_at';
SELECT COUNT(*) AS refreshedActivity FROM application_sessions WHERE token_hash='$new_hash' AND last_seen_at='$rotated_at';" > /tmp/session-rotation-success.txt

grep -q '"oldRevoked": 1' /tmp/session-rotation-success.txt
grep -q '"newActive": 1' /tmp/session-rotation-success.txt
grep -q '"sameExpiry": 1' /tmp/session-rotation-success.txt
grep -q '"refreshedActivity": 1' /tmp/session-rotation-success.txt

run_sql "UPDATE application_sessions SET last_seen_at='2026-01-01T00:01:00.000Z' WHERE token_hash='$stale_old_hash';
UPDATE application_sessions
SET revoked_at='$rotated_at'
WHERE token_hash='$stale_old_hash'
  AND user_id='$user_id'
  AND revoked_at IS NULL
  AND expires_at='$expires_at'
  AND last_seen_at='$created_at';
INSERT INTO application_sessions(token_hash,user_id,expires_at,created_at,last_seen_at)
SELECT '$stale_new_hash','$user_id','$expires_at','$rotated_at','$rotated_at'
WHERE changes()=1;"

run_sql "SELECT COUNT(*) AS staleOldStillActive FROM application_sessions WHERE token_hash='$stale_old_hash' AND revoked_at IS NULL;
SELECT COUNT(*) AS staleNewAbsent FROM application_sessions WHERE token_hash='$stale_new_hash';" > /tmp/session-rotation-stale.txt

grep -q '"staleOldStillActive": 1' /tmp/session-rotation-stale.txt
grep -q '"staleNewAbsent": 0' /tmp/session-rotation-stale.txt

echo "Session rotation Local D1 contract passed"
