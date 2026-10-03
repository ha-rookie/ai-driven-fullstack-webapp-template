#!/usr/bin/env bash
set -euo pipefail

npm run db:migrate:local > /tmp/local-credential-migrate.txt

suffix="${GITHUB_RUN_ID:-local}-$$-$(date +%s)"
user_id="__local_credential_${suffix}"
identifier="local-${suffix}@example.invalid"
reset_id="__local_reset_${suffix}"
reset_hash="$(printf '%s' "reset-${suffix}" | sha256sum | awk '{print $1}')"
created_at="2097-01-01T00:00:00.000Z"
expires_at="2097-01-01T00:30:00.000Z"
password_hash='pbkdf2-sha256$600000$c2FsdC1mb3Itc2NoZW1h$dGVzdC1oYXNoLWZvci1zY2hlbWEtb25seQ'

run_sql() {
  npx wrangler d1 execute DB --local --command "$1"
}

run_sql "INSERT INTO users(id,display_name,created_at,updated_at,status)
  VALUES ('$user_id','Local Credential Test','$created_at','$created_at','active');
INSERT INTO local_credentials(user_id,identifier_normalized,password_hash,password_changed_at,created_at,updated_at)
  VALUES ('$user_id','$identifier','$password_hash','$created_at','$created_at','$created_at');
INSERT INTO password_reset_tokens(id,token_hash,user_id,expires_at,consumed_at,created_at)
  VALUES ('$reset_id','$reset_hash','$user_id','$expires_at',NULL,'$created_at');"

run_sql "SELECT COUNT(*) AS credentialCount FROM local_credentials WHERE user_id='$user_id' AND identifier_normalized='$identifier';" > /tmp/local-credential-row.txt
grep -q '"credentialCount": 1' /tmp/local-credential-row.txt

run_sql "SELECT COUNT(*) AS resetCount FROM password_reset_tokens WHERE user_id='$user_id' AND token_hash='$reset_hash' AND consumed_at IS NULL;" > /tmp/local-credential-reset.txt
grep -q '"resetCount": 1' /tmp/local-credential-reset.txt

run_sql "SELECT COUNT(*) AS schemaCount FROM sqlite_master WHERE type='table' AND name IN ('local_credentials','password_reset_tokens');" > /tmp/local-credential-schema.txt
grep -q '"schemaCount": 2' /tmp/local-credential-schema.txt

run_sql "DELETE FROM users WHERE id='$user_id';"
run_sql "SELECT COUNT(*) AS orphanCredentialCount FROM local_credentials WHERE user_id='$user_id';" > /tmp/local-credential-cascade-credential.txt
grep -q '"orphanCredentialCount": 0' /tmp/local-credential-cascade-credential.txt
run_sql "SELECT COUNT(*) AS orphanResetCount FROM password_reset_tokens WHERE user_id='$user_id';" > /tmp/local-credential-cascade-reset.txt
grep -q '"orphanResetCount": 0' /tmp/local-credential-cascade-reset.txt

echo "Local credential Local D1 contract passed"
