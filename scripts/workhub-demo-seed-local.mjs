import { execFileSync } from "node:child_process";

const timestamp = "2026-10-04T00:00:00.000Z";
const scopeId = "workhub-company";

const personas = [
  ["workhub-demo-haru", "Haru Newcomer", "haru", "newcomer", "pbkdf2-sha256$600000$AAECAwQFBgcICQoLDA0ODw$2qf6FK7jEQTVZbkzylYMcO3hg0xcIxrbbQjsjIZ57QA"],
  ["workhub-demo-aoi", "Aoi Employee", "aoi", "employee", "pbkdf2-sha256$600000$ERITFBUWFxgZGhscHR4fIA$2F8Ub-L3Z0Se2aUTdFI8wj1hLM71dwScLyY_KynwBU0"],
  ["workhub-demo-ren", "Ren Manager", "ren", "manager", "pbkdf2-sha256$600000$IiMkJSYnKCkqKywtLi8wMQ$hqYYWhjzEL_ldEhxj5xP8PhRvBrB1ncPJgnnMalaFbI"],
  ["workhub-demo-mei", "Mei Accounting", "mei", "accounting", "pbkdf2-sha256$600000$MzQ1Njc4OTo7PD0-P0BBQg$RaiPMXeuvwX3Bgr2vuwoMFXnE9eJK5AL3l869C1YSq8"],
  ["workhub-demo-sora", "Sora Corporate", "sora", "corporate", "pbkdf2-sha256$600000$REVGR0hJSktMTU5PUFFSUw$QqGOY1EwCwJ6YTv5t1sZQlT7n6-_6U4fsGG-F3eF41Y"],
  ["workhub-demo-kai", "Kai Admin", "kai", "system_admin", "pbkdf2-sha256$600000$VVZXWFlaW1xdXl9gYWJjZA$C2Wlgxq7z39m7ltAWq7bhGHTNGYnA5P4Z6xsdvluoSY"],
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
`;

const run = (args) => execFileSync("npx", ["wrangler", ...args], {
  stdio: "inherit",
  env: process.env,
});

// Intentionally local-only. Do not add --remote or a Production database identifier here.
run(["d1", "migrations", "apply", "DB", "--local"]);
run(["d1", "execute", "DB", "--local", "--command", sql]);

console.log("WORKHUB local demo users seeded. Demo password: Workhub-Demo-2026!");
