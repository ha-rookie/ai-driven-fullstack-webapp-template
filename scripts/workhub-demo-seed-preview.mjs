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

console.log("WORKHUB Preview demo users, Office master, and normal operation mode seeded and credential join probed.");
