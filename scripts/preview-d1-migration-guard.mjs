/**
 * #632 — Fail-closed Preview D1 migration request + pending-plan gate.
 * Local validation only. This script never makes network calls or writes D1.
 */
import { readFileSync } from "node:fs";

export const PREVIEW_DATABASE_ID = "f1ce1268-2be2-4a20-ab10-a94c32feee64";
export const PREVIEW_DATABASE_NAME = "ai-driven-webapp-template-preview";
const MIGRATION_NAME = /^[0-9]{4}_[A-Za-z0-9_-]+\.sql$/u;
const SHA = /^[0-9a-f]{40}$/u;

const deny = reason => { throw new Error("Preview D1 migration denied: " + reason); };

export const parseExpectedMigrations = input => {
  if (typeof input !== "string" || input.length > 2048 || !input.trim()) {
    return deny("explicit nonempty pending migration names required");
  }
  const names = input.split(",").map(name => name.trim());
  if (names.length > 20 || names.some(name => !MIGRATION_NAME.test(name))
      || new Set(names).size !== names.length) {
    return deny("invalid/duplicate pending migration names");
  }
  return names;
};

export const validateDispatch = ({
  eventName, actor, repositoryOwner, ref, targetSha, confirmation, expectedPending,
}) => {
  if (eventName !== "workflow_dispatch") deny("manual workflow_dispatch only");
  if (!repositoryOwner || actor !== repositoryOwner) deny("repository owner must dispatch");
  if (ref !== "refs/heads/main") deny("workflow must be dispatched on main");
  if (!SHA.test(targetSha ?? "")) deny("exact 40-character lowercase target SHA required");
  if (confirmation !== "MIGRATE PREVIEW D1") deny("explicit migration confirmation required");
  return parseExpectedMigrations(expectedPending);
};

export const validatePreviewConfig = configText => {
  let config;
  try { config = JSON.parse(configText); } catch { return deny("wrangler.jsonc must parse without ambiguity"); }
  const preview = config?.env?.preview;
  const targets = preview?.d1_databases;
  if (preview?.vars?.RUNTIME_ENVIRONMENT !== "preview"
    || !Array.isArray(targets) || targets.length !== 1
    || targets[0]?.binding !== "DB"
    || targets[0]?.database_name !== PREVIEW_DATABASE_NAME
    || targets[0]?.database_id !== PREVIEW_DATABASE_ID) {
    deny("named Preview environment D1 database does not match pinned name, ID or binding");
  }
  const previewAlias = config?.d1_databases?.find(entry => entry.binding === "DB");
  if (config?.d1_databases?.length !== 1
      || previewAlias?.preview_database_id !== PREVIEW_DATABASE_ID
      || config?.previews?.d1_databases?.length !== 1
      || config.previews.d1_databases[0]?.database_id !== PREVIEW_DATABASE_ID) {
    deny("Wrangler --preview must resolve to the pinned Preview D1 database ID");
  }
  return true;
};

/** Wrangler list's table (not the apply output) is the only authoritative input. */
export const parsePendingList = raw => {
  if (typeof raw !== "string" || raw.length > 200_000) deny("invalid Wrangler migration list output");
  const plain = raw.replace(/\u001b\[[0-9;]*m/gu, "");
  const heading = plain.lastIndexOf("Migrations to be applied:");
  if (heading < 0) deny("unrecognized Wrangler pending migration table");
  const lines = plain.slice(heading).split(/\r?\n/u).slice(1);
  const names = [];
  let sawTable = false;
  for (const line of lines) {
    if (line.includes("┌") || line.includes("┬")) sawTable = true;
    if (!line.includes(".sql")) continue;
    // An unexpected SQL-looking table row is a hard error, not something to skip.
    const row = line.match(/^[^│|]*[│|]\s*([^│|\s]+\.sql)\s*[│|]\s*$/u);
    if (!row || !MIGRATION_NAME.test(row[1])) deny("unrecognized pending migration row");
    names.push(row[1]);
  }
  if (!sawTable || names.length === 0 || names.length > 20 || new Set(names).size !== names.length) {
    deny("missing/ambiguous/duplicate pending migrations");
  }
  return names;
};

export const requireExactPlan = (output, expectedInput) => {
  const expected = parseExpectedMigrations(expectedInput);
  const observed = parsePendingList(output);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    deny("pending migration list differs from owner's explicitly approved exact order");
  }
  return observed;
};

const assert = (condition, message) => { if (!condition) throw new Error("self-test: " + message); };
const mustDeny = fn => {
  try { fn(); } catch (e) {
    if (String(e).includes("Preview D1 migration denied:")) return;
    throw e;
  }
  throw new Error("self-test: unsafe request was not rejected");
};
export const selfTest = () => {
  const names = ["0035_example.sql", "0036_preview_ref.sql"];
  const good = { eventName: "workflow_dispatch", actor: "repo-owner", repositoryOwner: "repo-owner",
    ref: "refs/heads/main", targetSha: "a".repeat(40), confirmation: "MIGRATE PREVIEW D1",
    expectedPending: names.join(",") };
  assert(validateDispatch(good).length === 2, "valid manual request rejected");
  for (const patch of [
    { eventName: "push" }, { eventName: "pull_request" }, { actor: "other-user" },
    { ref: "refs/heads/feature" }, { targetSha: "a".repeat(39) }, { confirmation: "DEPLOY PREVIEW" },
    { expectedPending: "" }, { expectedPending: "../unsafe.sql" },
  ]) mustDeny(() => validateDispatch({ ...good, ...patch }));
  mustDeny(() => parseExpectedMigrations("0035_x.sql,0035_x.sql"));
  const table = "Migrations to be applied:\n┌──────────────┐\n│ Name │\n├──────────────┤\n│ 0035_example.sql │\n│ 0036_preview_ref.sql │\n└──────────────┘";
  assert(requireExactPlan(table, names.join(",")).length === 2, "matching plan rejected");
  for (const expected of ["0035_example.sql", "0036_preview_ref.sql,0035_example.sql", "0035_other.sql"]) {
    mustDeny(() => requireExactPlan(table, expected));
  }
  mustDeny(() => requireExactPlan("No migrations to apply!", names.join(",")));
  mustDeny(() => requireExactPlan("Migrations to be applied:\n│ ../../unsafe.sql │", names.join(",")));
  const validConfig = JSON.stringify({
    d1_databases: [{ binding: "DB", preview_database_id: PREVIEW_DATABASE_ID }],
    env: { preview: { vars: { RUNTIME_ENVIRONMENT: "preview" }, d1_databases: [
      { binding: "DB", database_name: PREVIEW_DATABASE_NAME, database_id: PREVIEW_DATABASE_ID },
    ] } },
    previews: { d1_databases: [{ binding: "DB", database_id: PREVIEW_DATABASE_ID }] },
  });
  assert(validatePreviewConfig(validConfig), "pinned DB rejected");
  mustDeny(() => validatePreviewConfig(validConfig.replace(PREVIEW_DATABASE_ID, "00000000-0000-0000-0000-000000000000")));
  const workflow = readFileSync(".github/workflows/preview-d1-migration.yml", "utf8");
  assert(/^on:\s*\n\s+workflow_dispatch:/mu.test(workflow), "manual-only trigger missing");
  for (const type of ["push", "pull_request", "schedule"]) {
    assert(!new RegExp("^\\s{2}" + type + ":", "mu").test(workflow), "automatic trigger present: " + type);
  }
  assert(workflow.includes("environment: preview") && workflow.includes("github.repository_owner"),
    "owner and environment boundary must remain explicit");
  assert(workflow.includes("requireExactPlan") || workflow.includes("--check-plan"), "plan validation must be called");
};

if (process.argv[1]?.endsWith("/preview-d1-migration-guard.mjs")) {
  const mode = process.argv[2];
  try {
    if (mode === "--self-test") {
      selfTest();
      console.log("Preview D1 migration guard: offline self-test PASS");
    } else if (mode === "--check-request") {
      validateDispatch({
        eventName: process.env.GITHUB_EVENT_NAME, actor: process.env.GITHUB_ACTOR,
        repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER, ref: process.env.GITHUB_REF,
        targetSha: process.env.TARGET_SHA, confirmation: process.env.CONFIRMATION,
        expectedPending: process.env.EXPECTED_PENDING,
      });
      console.log("Preview D1 migration request: owner/manual/target/plan declaration accepted");
    } else if (mode === "--check-config") {
      validatePreviewConfig(readFileSync("wrangler.jsonc", "utf8"));
      console.log("Preview D1 configuration: pinned target confirmed");
    } else if (mode === "--check-plan" && process.argv.length === 4) {
      const plan = requireExactPlan(readFileSync(process.argv[3], "utf8"), process.env.EXPECTED_PENDING);
      console.log("Preview D1 migrations: exact approved plan match (" + plan.length + " pending)");
    } else {
      deny("unknown guard mode");
    }
  } catch (e) {
    console.error(String(e));
    process.exitCode = 1;
  }
}
