import { execFileSync } from "node:child_process";

const timestamp = "2026-10-04T00:00:00.000Z";
const scopeId = "workhub-company";
const masterEnvironment = "local";
const officeMasterKey = "workhub.office";
const expenseCategoryMasterKey = "workhub.expense_category";

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

// These are read-only demonstration categories, NOT part of travel-request logic.
const referenceMasters = [
  ...offices.map(([id, revisionId, code, label, order]) =>
    [id, revisionId, officeMasterKey, code, label, order]),
  ["workhub-expense-transport", "workhub-expense-transport-r1",
    expenseCategoryMasterKey, "TRANSPORT", "Transport", 10],
  ["workhub-expense-lodging", "workhub-expense-lodging-r1",
    expenseCategoryMasterKey, "LODGING", "Lodging", 20],
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

const officeItemSql = referenceMasters.map(([itemId, , masterKey, code]) => `
INSERT INTO master_items (
  id, environment, master_key, code, version, next_revision, last_mutation_id,
  retired_at, created_at, created_by, updated_at, updated_by
) VALUES (
  ${quote(itemId)}, ${quote(masterEnvironment)}, ${quote(masterKey)}, ${quote(code)},
  2, 2, ${quote(`${itemId}-seed-r1`)}, NULL,
  ${quote(timestamp)}, 'workhub-local-fixture', ${quote(timestamp)}, 'workhub-local-fixture'
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

const officeRevisionSql = referenceMasters.map(([itemId, revisionId, , , label, displayOrder]) => `
INSERT INTO master_revisions (
  id, environment, master_item_id, revision, label, enabled,
  effective_from, effective_to, display_order, parent_item_id,
  attributes_json, created_at, created_by
) VALUES (
  ${quote(revisionId)}, ${quote(masterEnvironment)}, ${quote(itemId)}, 1, ${quote(label)}, 1,
  '2026-01-01T00:00:00.000Z', NULL, ${Number(displayOrder)}, NULL,
  '{}', ${quote(timestamp)}, 'workhub-local-fixture'
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
VALUES ('local', 'normal', 1, ${quote(timestamp)}, 'workhub-local-fixture', 'WORKHUB deterministic local fixture')
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

// Intentionally local-only. Do not add --remote or a Production database identifier here.
run(["d1", "migrations", "apply", "DB", "--local"]);
run(["d1", "execute", "DB", "--local", "--command", sql]);

console.log("WORKHUB local demo users, Office and read-only Expense Category masters, and normal operation mode seeded. Demo password: Workhub-Demo-2026!");
