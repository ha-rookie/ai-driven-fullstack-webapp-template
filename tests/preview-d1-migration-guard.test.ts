import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Preview D1 migration is not remotely triggered by main push/PR/schedule", () => {
  const workflow = readFileSync(".github/workflows/preview-d1-migration.yml", "utf8");
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request|schedule):/mu);
  assert.match(workflow, /environment: preview/u);
  assert.match(workflow, /github\.repository_owner/u);
  assert.match(workflow, /needs: preflight/u);
  assert.match(workflow, /target_sha:/u);
  assert.match(workflow, /expected_pending_migrations:/u);
  assert.match(workflow, /confirmation:/u);
  assert.match(workflow, /--check-request/u);
  assert.match(workflow, /--check-config/u);
  assert.match(workflow, /--check-plan/u);
  assert.match(workflow, /test "\$\(git rev-parse origin\/main\)" = "\$TARGET_SHA"/u);
  assert.match(workflow, /CLOUDFLARE_D1_MIGRATION_TOKEN/u);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
  // Owner approval list validation must be in the same step immediately
  // preceding the single real remote apply. No unguarded second apply.
  const apply = "npx wrangler d1 migrations apply DB --remote --preview";
  assert.equal(workflow.split(apply).length - 1, 1);
  const applyStep = workflow.slice(workflow.indexOf("- name: Recheck pending list immediately before explicitly authorized apply"));
  assert.ok(applyStep.indexOf("--check-plan preview-d1-pending-final.txt") < applyStep.indexOf(apply));
});

test("Preview D1 guard rejects unsafe actor, event, SHA, DB and pending migration plans offline", () => {
  const output = execFileSync(process.execPath, [
    "scripts/preview-d1-migration-guard.mjs", "--self-test",
  ], { encoding: "utf8", timeout: 15_000 });
  assert.match(output, /self-test PASS/u);
  const config = execFileSync(process.execPath, [
    "scripts/preview-d1-migration-guard.mjs", "--check-config",
  ], { encoding: "utf8", timeout: 15_000 });
  assert.match(config, /pinned target confirmed/u);
});
