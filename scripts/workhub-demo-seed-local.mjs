import { execFileSync } from "node:child_process";

const timestamp = "2026-10-04T00:00:00.000Z";
const scopeId = "workhub-company";
const masterEnvironment = "local";
const officeMasterKey = "workhub.office";

const personas = [
  ["workhub-demo-haru", "Haru Newcomer", "haru", "newcomer", "pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$2qf6FK7jEQTVZbkzylYMcO3hg0xcIxrbbQjsjIZ57QA"],
  ["workhub-demo-aoi", "Aoi Employee", "aoi", "employee", "pbkdf2-sha256$600000$ERITFBUWFxgZGhscHR4fIA$2F8Ub-L3Z0Se2aUTdFI8wj1hLM71dwScLyY_KynwBU0"],
  ["workhub-demo-ren", "Ren Manager", "ren", "manager", "pbkdf2-sha256$600000$IiMkJSYnKCkqKywtLi8wMQ$hqYYWhjzEL_ldEhxj5xP8PhRvBrB1ncPJgnnMalaFbI"],
  ["workhub-demo-mei", "Mei Accounting", "mei", "accounting", "pbkdf2-sha256$600000$MzQ1Njc4OTo7PD0-P0BBQg$RaiPMXeuvwX3Bgr2vuwoMFXnE9eJK5AL3l869C1YSq8"],
  ["workhub-demo-sora", "Sora Corporate", "sora", "corporate", "pbkdf2-sha256$600000$REVGR0hJSktMTU5PUFFSUw$QqGOY1EwCwJ6YTv5t1sZQlT7n6-_6U4fsGG-F3eF41Y"],
  ["workhub-demo-kai", "Kai Admin", "kai", "system_admin", "pbkdf2-sha256$600000$VVZXWFlaW1xdXl9gYWJjZA$C2Wlgxq7z39m7ltAWq7bhGHTNGYnA5P4Z6xsdvluoSY"],
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

const officeRevisionSql = offices.map(([itemId, revisionId, , label, displayOrder]) => `
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

console.log("WORKHUB local demo users and Office master seeded. Demo password: Workhub-Demo-2026!");
