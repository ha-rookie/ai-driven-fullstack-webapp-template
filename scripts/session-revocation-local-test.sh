#!/usr/bin/env bash
set -euo pipefail

npm run db:migrate:local > /tmp/session-revocation-migrate.txt

suffix="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"
user_all="__session_revocation_all_${suffix}"
user_others="__session_revocation_others_${suffix}"
other_user="__session_revocation_unrelated_${suffix}"
revoked_at="2098-01-01T00:00:00.000Z"
second_revoked_at="2098-01-01T00:01:00.000Z"
created_at="2097-01-01T00:00:00.000Z"
future_expiry="2099-01-01T00:00:00.000Z"
expired_expiry="2097-01-01T00:00:00.000Z"

run_sql() {
  npx wrangler d1 execute DB --local --command "$1"
}

run_sql "INSERT INTO users(id,display_name,created_at,updated_at) VALUES
  ('$user_all','Revocation All Test','$created_at','$created_at'),
  ('$user_others','Revocation Others Test','$created_at','$created_at'),
  ('$other_user','Revocation Unrelated Test','$created_at','$created_at');
INSERT INTO application_sessions(token_hash,user_id,expires_at,revoked_at,created_at,last_seen_at) VALUES
  ('${suffix}-all-active','$user_all','$future_expiry',NULL,'$created_at','$created_at'),
  ('${suffix}-all-expired','$user_all','$expired_expiry',NULL,'$created_at','$created_at'),
  ('${suffix}-all-prerevoked','$user_all','$future_expiry','$created_at','$created_at','$created_at'),
  ('${suffix}-unrelated','$other_user','$future_expiry',NULL,'$created_at','$created_at'),
  ('${suffix}-current','$user_others','$future_expiry',NULL,'$created_at','$created_at'),
  ('${suffix}-other-a','$user_others','$future_expiry',NULL,'$created_at','$created_at'),
  ('${suffix}-other-b','$user_others','$expired_expiry',NULL,'$created_at','$created_at');"

run_sql "UPDATE application_sessions SET revoked_at='$revoked_at' WHERE user_id='$user_all' AND revoked_at IS NULL;"
run_sql "SELECT COUNT(*) AS allRevokedCount FROM application_sessions WHERE user_id='$user_all' AND revoked_at='$revoked_at';" > /tmp/session-revocation-all.txt
grep -q '"allRevokedCount": 2' /tmp/session-revocation-all.txt

run_sql "SELECT COUNT(*) AS unrelatedRevokedCount FROM application_sessions WHERE user_id='$other_user' AND revoked_at IS NOT NULL;" > /tmp/session-revocation-unrelated.txt
grep -q '"unrelatedRevokedCount": 0' /tmp/session-revocation-unrelated.txt

run_sql "UPDATE application_sessions SET revoked_at='$second_revoked_at' WHERE user_id='$user_all' AND revoked_at IS NULL;"
run_sql "SELECT COUNT(*) AS repeatedRevokedCount FROM application_sessions WHERE user_id='$user_all' AND revoked_at='$second_revoked_at';" > /tmp/session-revocation-repeat.txt
grep -q '"repeatedRevokedCount": 0' /tmp/session-revocation-repeat.txt

run_sql "UPDATE application_sessions SET revoked_at='$revoked_at' WHERE user_id='$user_others' AND revoked_at IS NULL AND token_hash<>'${suffix}-current';"
run_sql "SELECT COUNT(*) AS currentPreservedCount FROM application_sessions WHERE token_hash='${suffix}-current' AND revoked_at IS NULL;" > /tmp/session-revocation-current.txt
grep -q '"currentPreservedCount": 1' /tmp/session-revocation-current.txt

run_sql "SELECT COUNT(*) AS othersRevokedCount FROM application_sessions WHERE user_id='$user_others' AND token_hash<>'${suffix}-current' AND revoked_at='$revoked_at';" > /tmp/session-revocation-others.txt
grep -q '"othersRevokedCount": 2' /tmp/session-revocation-others.txt

echo "Session revocation Local D1 contract passed"
