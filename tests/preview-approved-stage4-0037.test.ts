import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/preview-approved-stage4-0037.yml", "utf8");
const seedSql = readFileSync("scripts/workhub-0037-preview-departments-only.sql", "utf8");
const approvedSha = "4e02b918ec10d68de737e4bf873dcd2ab48178c9";
const exactCommand = "/release-preview-stage4-0037 " + approvedSha + " MIGRATE SEED PREVIEW";

test("Stage4 Preview release is one-time owner command only, never push, PR or schedule", () => {
  assert.match(workflow, /^on:\s*\n\s+issue_comment:/mu);
  for (const trigger of ["push", "pull_request", "workflow_dispatch", "schedule"]) {
    assert.doesNotMatch(workflow, new RegExp("^  " + trigger + ":", "mu"));
  }
  assert.ok(workflow.includes("github.event.issue.number == 132"));
  assert.ok(workflow.includes("github.event.comment.author_association == 'OWNER'"));
  assert.ok(workflow.includes("github.actor == github.repository_owner"));
  assert.ok(workflow.includes("github.event.comment.body == '" + exactCommand + "'"));
  assert.ok(workflow.includes("environment: preview"));
  assert.ok(workflow.includes("APPROVED_APP_SHA: " + approvedSha));
  assert.ok(workflow.includes('git diff --name-only "$APPROVED_APP_SHA" HEAD'));
});

test("Stage4 Preview migration requires exact pinned target, pending SQL and readback", () => {
  assert.ok(workflow.includes("PREVIEW_DATABASE_ID: f1ce1268-2be2-4a20-ab10-a94c32feee64"));
  assert.ok(workflow.includes("EXPECTED_PENDING: 0037_workhub_announcement_departments.sql"));
  assert.ok(workflow.includes("scripts/preview-d1-migration-guard.mjs --check-config"));
  assert.equal((workflow.match(/--check-plan /gu) || []).length, 2);
  assert.ok(workflow.includes("d1 migrations apply DB --remote --preview"));
  assert.ok(workflow.includes("d1 execute DB --remote --preview --file scripts/workhub-0037-preview-departments-only.sql"));
  assert.ok(workflow.includes("0037 schema readback failed; refusing fixture writes"));
  assert.ok(workflow.includes("Expected exact six department memberships; do not deploy"));
  assert.ok(!workflow.includes("wrangler deploy"));
  assert.ok(!workflow.includes("CLOUDFLARE_ENV=preview"));
});

test("Stage4 Preview fixture only upserts six explicit existing users' department membership", () => {
  assert.ok(seedSql.includes("PRAGMA foreign_keys = ON"));
  assert.ok(seedSql.includes("INSERT INTO workhub_department_memberships"));
  assert.ok(seedSql.includes("ON CONFLICT(scope_id, user_id) DO UPDATE SET"));
  const pairs = [
    ["haru", "engineering"], ["aoi", "engineering"], ["ren", "engineering"],
    ["mei", "finance"], ["sora", "people"], ["kai", "it"],
  ];
  for (const [id, dept] of pairs) {
    assert.ok(seedSql.includes("'workhub-demo-" + id + "', '" + dept + "'"));
  }
  assert.equal((seedSql.match(/'workhub-demo-(?:haru|aoi|ren|mei|sora|kai)'/gu) || []).length, 6);
  for (const table of ["users", "local_credentials", "scope_memberships", "master_items", "operation_modes", "reference_travel_requests"]) {
    assert.doesNotMatch(seedSql, new RegExp("(?:INSERT INTO|UPDATE|DELETE FROM)\\s+" + table + "\\b", "iu"));
  }
});
