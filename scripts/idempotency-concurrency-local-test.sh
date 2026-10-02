#!/usr/bin/env bash
set -euo pipefail

npm run db:migrate:local > /tmp/idempotency-concurrency-migrate.txt

suffix="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"
key="__idempotency_concurrency_${suffix}"
actor="__idempotency_actor_${suffix}"
scope="__idempotency_scope_${suffix}"
action="resource.create"
fingerprint_a="sha256:first-${suffix}"
fingerprint_b="sha256:second-${suffix}"
resource_a="__idempotency_effect_a_${suffix}"
resource_b="__idempotency_effect_b_${suffix}"
created_at="2098-01-01T00:00:00.000Z"
expires_at="2099-01-01T00:00:00.000Z"

run_sql() {
  npx wrangler d1 execute DB --local --command "$1"
}

cleanup() {
  run_sql "DELETE FROM example_resources WHERE id IN ('$resource_a','$resource_b');
DELETE FROM idempotency_records WHERE idempotency_key='$key' AND actor_id='$actor' AND scope_id='$scope' AND action='$action';" >/dev/null || true
}
trap cleanup EXIT

# The TypeScript boundary test drives truly concurrent Promise arrivals deterministically.
# This Local D1 contract verifies the database primitive both arrivals rely on:
# only the first unique context insert may gate a business side effect.
run_sql "INSERT OR IGNORE INTO idempotency_records(
  idempotency_key, actor_id, scope_id, action, fingerprint,
  state, created_at, updated_at, expires_at
) VALUES(
  '$key','$actor','$scope','$action','$fingerprint_a',
  'in_progress','$created_at','$created_at','$expires_at'
);
INSERT INTO example_resources(id,name,created_at,updated_at)
SELECT '$resource_a','Idempotency effect A','$created_at','$created_at'
WHERE changes()=1;" >/tmp/idempotency-concurrency-first.txt

run_sql "INSERT OR IGNORE INTO idempotency_records(
  idempotency_key, actor_id, scope_id, action, fingerprint,
  state, created_at, updated_at, expires_at
) VALUES(
  '$key','$actor','$scope','$action','$fingerprint_b',
  'in_progress','$created_at','$created_at','$expires_at'
);
INSERT INTO example_resources(id,name,created_at,updated_at)
SELECT '$resource_b','Idempotency effect B','$created_at','$created_at'
WHERE changes()=1;" >/tmp/idempotency-concurrency-second.txt

run_sql "SELECT COUNT(*) AS recordCount
FROM idempotency_records
WHERE idempotency_key='$key' AND actor_id='$actor' AND scope_id='$scope' AND action='$action';
SELECT fingerprint AS storedFingerprint, state AS storedState
FROM idempotency_records
WHERE idempotency_key='$key' AND actor_id='$actor' AND scope_id='$scope' AND action='$action';
SELECT COUNT(*) AS effectCount
FROM example_resources
WHERE id IN ('$resource_a','$resource_b');
SELECT COUNT(*) AS losingEffectCount
FROM example_resources
WHERE id='$resource_b';" >/tmp/idempotency-concurrency-result.txt

grep -q '"recordCount": 1' /tmp/idempotency-concurrency-result.txt
grep -q "\"storedFingerprint\": \"$fingerprint_a\"" /tmp/idempotency-concurrency-result.txt
grep -q '"storedState": "in_progress"' /tmp/idempotency-concurrency-result.txt
grep -q '"effectCount": 1' /tmp/idempotency-concurrency-result.txt
grep -q '"losingEffectCount": 0' /tmp/idempotency-concurrency-result.txt

echo "Idempotency concurrency Local D1 contract passed"
