import { execFileSync } from "node:child_process";

const timestamp = "2026-10-04T00:00:00.000Z";
const scopeId = "workhub-company";
const masterEnvironment = "preview";
const officeMasterKey = "workhub.office";

const personas = [
  ["workhub-demo-haru", "Haru Newcomer", "haru", "newcomer", "scrypt$32768$8$3$AAECAwQFBgcICQoLDA0ODw$cf5wGgfu3sy4cO_RvujgkwrUnyDG-RgZKMcc6oaDbgU"],
  ["workhub-demo-aoi", "Aoi Employee", "aoi", "employee", "scrypt$32768$8$3$ERITFBUWFxgZGhscHR4fIA$cZL5lyiryapApuj37FzB3GjTg2CfVCo5IwhrP1LXMGA"],
  ["workhub-demo-ren", "Ren Manager", "ren", "manager", "scrypt$32768$8$3$IiMkJSYnKCkqKywtLi8wMQ$-J2hRaX9zwHprraOCX7ZoR2gMmK1pK_kyIHQvwdIMo4"],
  ["workhub-demo-mei", "Mei Accounting", "mei", "accounting", "scrypt$32768$8$3$MzQ1Njc4OTo7PD0-P0BBQg$KkZ-LPUwavyRwwyW4kQcNn3umEAFVRQehY-6aZ0-C4g"],
  ["workhub-demo-sora", "Sora Corporate", "sora", "corporate", "scrypt$32768$8$3$REVGR0hJSktMTU5PUFFSUw$EGnY5zKzWKEUoZLDYrrpZXepbwP5_2NaetQMKRTmYNg"],
  ["workhub-demo-kai", "Kai Admin", "kai", "system_admin", "scrypt$32768$8$3$VVZXWFlaW1xdXl9gYWJjZA$tqIvcsqFd8kO066uGOU-o_10yXja3EAiQsYmPGqqHbQ"],
];

const offices = [
  ["workhub-office-nagoya", "workhub-office-nagoya-r1", "NAGOYA", "Nagoya Office", 10],
  ["workhub-office-tokyo", "workhub-office-tokyo-r1", "TOKYO", "Tokyo Office", 20],
];

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

const userSql = personas.map(([id, displayName]) => `
INSERT INTO users (id, display_name, created_at, updated_at, status)
VALUES (${quote(id)}, ${quote(displayName)}, ${quote(timestamp)}, ${quote(timestamp)}, 'active')
ON CONFLICT(id) DO UPDATE SET
  display_name = excluded.display_name,
  updated_at = excluded.updated_at,
  status = 'active';`).join("\n");

const credentialSql = personas.map(([id, , userId, , passwordHash]) => `
INSERT INTO local_credentials (
  user_id, identifier_normalized, password_hash, password_changed_at, created_at, updated_at
) VALUES (
  ${quote(id)}, ${quote(userId)}, ${quote(passwordHash)}, ${quote(timestamp)}, ${quote(timestamp)}, ${quote(timestamp)}
)
ON CONFLICT(user_id) DO UPDATE SET
  identifier_normalized = excluded.identifier_normalized,
  password_hash = excluded.password_hash,
  password_changed_at = excluded.password_changed_at,
  updated_at = excluded.updated_at;`).join("\n");

const membershipSql = personas.map(([id, , , role]) => `
INSERT INTO scope_memberships (scope_id, user_id, role, created_at, updated_at)
VALUES (${quote(scopeId)}, ${quote(id)}, ${quote(role)}, ${quote(timestamp)}, ${quote(timestamp)})
ON CONFLICT(scope_id, user_id) DO UPDATE SET
  role = excluded.role,
  updated_at = excluded.updated_at;`).join("\n");

const officeItemSql = offices.map(([itemId, , code]) => `
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  ${quote(itemId)}, ${quote(masterEnvironment)}, ${quote(officeMasterKey)}, ${quote(code)},
  2, 2, ${quote(`${itemId}-seed-r1`)}, NULL,
  ${quote(timestamp)}, 'workhub-preview-fixture', ${quote(timestamp)}, 'workhub-preview-fixture'
)
ON CONFLICT(id) DO UPDATE SET
  environment = excluded.environment,
  master_key = excluded.master_key,
  code = excluded.code,
  version = excluded.version,
  next_revision = excluded.next_revision,
  last_mutation_id = excluded.last_mutation_id,
  retired_at = NULL,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by;`).join("\n");

const officeRevisionSql = offices.map(([itemId, revisionId, , label, displayOrder]) => `
INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id,
  attributes_json, created_at, created_by
) VALUES (
  ${quote(revisionId)}, ${quote(masterEnvironment)}, ${quote(itemId)}, 1, ${quote(label)}, 1,
  '2026-01-01T00:00:00.000Z', NULL, ${Number(displayOrder)}, NULL,
  '{}', ${quote(timestamp)}, 'workhub-preview-fixture'
)
ON CONFLICT(id) DO UPDATE SET
  label = excluded.label,
  enabled = 1,
  effective_from = excluded.effective_from,
  effective_to = NULL,
  display_order = excluded.display_order,
  parent_item_id = NULL,
  attributes_json = '{}';`).join("\n");

const sql = `
PRAGMA foreign_keys = ON;

INSERT INTO operation_modes (environment, mode, version, updated_at, updated_by, reason)
VALUES ('preview', 'normal', 1, ${quote(timestamp)}, 'workhub-preview-fixture', 'WORKHUB deterministic Preview fixture')
ON CONFLICT(environment) DO UPDATE SET
  mode = 'normal',
  version = operation_modes.version + 1,
  updated_at = excluded.updated_at,
  updated_by = excluded.updated_by,
  reason = excluded.reason;

INSERT INTO resource_scopes (id, name, created_at, updated_at)
VALUES (${quote(scopeId)}, 'WORKHUB Reference Company', ${quote(timestamp)}, ${quote(timestamp)})
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  updated_at = excluded.updated_at;

${userSql}
${credentialSql}
${membershipSql}
${officeItemSql}
${officeRevisionSql}

INSERT INTO example_resources (
  id, name, status, version, created_at, created_by, updated_at, updated_by,
  deleted_at, deleted_by
) VALUES (
  'workhub-demo-deleted-resource', 'Preview deleted resource', 'active', 2,
  ${quote(timestamp)}, 'workhub-preview-fixture', ${quote(timestamp)}, 'workhub-demo-kai',
  ${quote(timestamp)}, 'workhub-demo-kai'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  status = 'active',
  version = 2,
  updated_at = excluded.updated_at,
  updated_by = 'workhub-demo-kai',
  deleted_at = excluded.deleted_at,
  deleted_by = 'workhub-demo-kai';

INSERT INTO example_resource_scope_bindings (resource_id, scope_id, created_at)
VALUES ('workhub-demo-deleted-resource', ${quote(scopeId)}, ${quote(timestamp)})
ON CONFLICT(resource_id) DO UPDATE SET
  scope_id = excluded.scope_id;

INSERT INTO reference_travel_requests (
  id, environment, requester_id, destination_office_item_id,
  destination_office_revision_id, start_date, end_date, purpose, status,
  submission_key, workflow_instance_id, submitted_at, version, created_at, updated_at
) VALUES (
  'workhub-demo-recovery-travel', 'preview', 'workhub-demo-aoi', 'workhub-office-nagoya',
  NULL, '2026-10-15', '2026-10-16', 'Preview recovery fixture', 'draft',
  NULL, NULL, NULL, 1, ${quote(timestamp)}, ${quote(timestamp)}
)
ON CONFLICT(id) DO UPDATE SET
  environment = excluded.environment,
  requester_id = excluded.requester_id,
  destination_office_item_id = excluded.destination_office_item_id,
  destination_office_revision_id = NULL,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  purpose = excluded.purpose,
  status = 'draft',
  submission_key = NULL,
  workflow_instance_id = NULL,
  submitted_at = NULL,
  version = 1,
  updated_at = excluded.updated_at;

INSERT INTO async_job_runs (
  environment, job_id, job_type, idempotency_key, payload_fingerprint,
  state, attempt, requested_at, started_at, updated_at, completed_at,
  lease_token, lease_expires_at, next_attempt_at,
  progress_percent, progress_code, failure_code
) VALUES (
  'preview', 'workhub-demo-search-recovery-job', 'search.index_projection',
  'search-index:preview:workhub.travel_request:workhub-demo-recovery-travel',
  'c4bd6af31a39fea83138bf933e04b478150a0526e2eb4450d5f2d8662bb27ac9',
  'failed', 2, ${quote(timestamp)}, ${quote(timestamp)}, ${quote(timestamp)}, ${quote(timestamp)},
  NULL, NULL, NULL, NULL, NULL, 'preview_demo_failure'
)
ON CONFLICT(environment, job_id) DO UPDATE SET
  job_type = excluded.job_type,
  idempotency_key = excluded.idempotency_key,
  payload_fingerprint = excluded.payload_fingerprint,
  state = 'failed',
  attempt = 2,
  requested_at = excluded.requested_at,
  started_at = excluded.started_at,
  updated_at = excluded.updated_at,
  completed_at = excluded.completed_at,
  lease_token = NULL,
  lease_expires_at = NULL,
  next_attempt_at = NULL,
  progress_percent = NULL,
  progress_code = NULL,
  failure_code = 'preview_demo_failure';
`;

const run = (args) => execFileSync("npx", ["wrangler", ...args], {
  stdio: "inherit",
  env: process.env,
});

// Intentionally Preview-only. The pinned Preview D1 ID, runtime environment, and explicit confirmation below must all match.
const expectedDatabaseId = "f1ce1268-2be2-4a20-ab10-a94c32feee64";
if (process.env.RUNTIME_ENVIRONMENT !== "preview") throw new Error("Preview fixture requires RUNTIME_ENVIRONMENT=preview");
if (process.env.PREVIEW_DATABASE_ID !== expectedDatabaseId) throw new Error("Pinned Preview D1 database ID mismatch");
if (process.env.CONFIRMATION !== "SEED WORKHUB PREVIEW") throw new Error("Explicit Preview fixture confirmation is required");

run(["d1", "migrations", "apply", "DB", "--remote", "--env", "preview"]);
run(["d1", "execute", "DB", "--remote", "--env", "preview", "--command", sql]);

// Read-only acceptance probe: prove the exact join used by LocalCredentialService can resolve
// every seeded persona without printing credential hashes or other secrets.
const credentialProbeSql = `
SELECT c.identifier_normalized AS identifier, u.status AS status
FROM local_credentials c
JOIN users u ON u.id = c.user_id
WHERE c.identifier_normalized IN ('haru','aoi','ren','mei','sora','kai')
ORDER BY c.identifier_normalized;
`;
run(["d1", "execute", "DB", "--remote", "--env", "preview", "--command", credentialProbeSql]);

console.log("WORKHUB Preview demo users, Office master, recoverable job/data-correction fixtures, and normal operation mode seeded and credential join probed.");
