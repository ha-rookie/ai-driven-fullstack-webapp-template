#!/usr/bin/env bash
set -euo pipefail

npm run db:migrate:local > /tmp/credential-attack-migrate.txt

suffix="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"
endpoint="auth.login.${suffix}"
subject_hash="$(printf '%s' "identifier-${suffix}" | sha256sum | awk '{print $1}')"
environment="test"
window_start="2097-01-01T00:00:00.000Z"
now="2097-01-01T00:01:00.000Z"
cutoff="2096-12-31T23:56:00.000Z"
lock_until="2097-01-01T00:03:00.000Z"
after_lock="2097-01-01T00:03:01.000Z"
after_lock_cutoff="2096-12-31T23:58:01.000Z"
new_lock_until="2097-01-01T00:05:01.000Z"

run_sql() {
  npx wrangler d1 execute DB --local --command "$1"
}

cleanup() {
  run_sql "DELETE FROM credential_attack_states WHERE environment='$environment' AND endpoint_id='$endpoint';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_sql "INSERT INTO credential_attack_states(
  environment,endpoint_id,dimension,subject_hash,failure_count,window_started_at,locked_until,updated_at
) VALUES ('$environment','$endpoint','identifier','$subject_hash',2,'$window_start',NULL,'$window_start');"

upsert_failure() {
  local event_now="$1"
  local event_cutoff="$2"
  local event_lock_until="$3"
  run_sql "INSERT INTO credential_attack_states (
    environment, endpoint_id, dimension, subject_hash,
    failure_count, window_started_at, locked_until, updated_at
  ) VALUES ('$environment', '$endpoint', 'identifier', '$subject_hash', 1, '$event_now', NULL, '$event_now')
  ON CONFLICT(environment, endpoint_id, dimension, subject_hash) DO UPDATE SET
    failure_count = CASE
      WHEN credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until > '$event_now'
        THEN credential_attack_states.failure_count
      WHEN (credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until <= '$event_now')
        OR credential_attack_states.window_started_at <= '$event_cutoff'
        THEN 1
      ELSE MIN(credential_attack_states.failure_count + 1, 3)
    END,
    window_started_at = CASE
      WHEN credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until > '$event_now'
        THEN credential_attack_states.window_started_at
      WHEN (credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until <= '$event_now')
        OR credential_attack_states.window_started_at <= '$event_cutoff'
        THEN '$event_now'
      ELSE credential_attack_states.window_started_at
    END,
    locked_until = CASE
      WHEN credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until > '$event_now'
        THEN credential_attack_states.locked_until
      WHEN (
        CASE
          WHEN (credential_attack_states.locked_until IS NOT NULL AND credential_attack_states.locked_until <= '$event_now')
            OR credential_attack_states.window_started_at <= '$event_cutoff'
            THEN 1
          ELSE credential_attack_states.failure_count + 1
        END
      ) >= 3 THEN '$event_lock_until'
      ELSE NULL
    END,
    updated_at = '$event_now';"
}

upsert_failure "$now" "$cutoff" "$lock_until"
run_sql "SELECT failure_count AS failureCount, locked_until AS lockedUntil
  FROM credential_attack_states
  WHERE environment='$environment' AND endpoint_id='$endpoint' AND dimension='identifier' AND subject_hash='$subject_hash';" > /tmp/credential-attack-locked.txt
grep -q '"failureCount": 3' /tmp/credential-attack-locked.txt
grep -q "\"lockedUntil\": \"$lock_until\"" /tmp/credential-attack-locked.txt

upsert_failure "2097-01-01T00:01:30.000Z" "$cutoff" "2097-01-01T00:03:30.000Z"
run_sql "SELECT failure_count AS failureCount, locked_until AS lockedUntil
  FROM credential_attack_states
  WHERE environment='$environment' AND endpoint_id='$endpoint';" > /tmp/credential-attack-still-locked.txt
grep -q '"failureCount": 3' /tmp/credential-attack-still-locked.txt
grep -q "\"lockedUntil\": \"$lock_until\"" /tmp/credential-attack-still-locked.txt

upsert_failure "$after_lock" "$after_lock_cutoff" "$new_lock_until"
run_sql "SELECT failure_count AS failureCount, locked_until AS lockedUntil
  FROM credential_attack_states
  WHERE environment='$environment' AND endpoint_id='$endpoint';" > /tmp/credential-attack-restarted.txt
grep -q '"failureCount": 1' /tmp/credential-attack-restarted.txt
grep -q '"lockedUntil": null' /tmp/credential-attack-restarted.txt

echo "Credential attack Local D1 contract passed"
