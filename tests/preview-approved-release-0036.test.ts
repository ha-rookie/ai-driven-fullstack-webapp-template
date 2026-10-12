import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("one-off approved 0036 Preview release is bound to an exact owner command and no push/PR dispatch", () => {
  const yml = readFileSync(".github/workflows/preview-approved-release-0036.yml", "utf8");
  assert.match(yml, /^on:\s*\n\s+issue_comment:\s*\n\s+types: \[created\]/mu);
  assert.doesNotMatch(yml, /^\s{2}(push|pull_request|schedule|workflow_dispatch):/mu);
  for (const requirement of [
    "github.event.issue.number == 132",
    "github.event.comment.author_association == 'OWNER'",
    "github.actor == github.repository_owner",
    "/release-preview-0036 38866f4f8abe803a226f8266971c0be6ab75ebcc MIGRATE PREVIEW D1 DEPLOY PREVIEW",
    "environment: preview",
    "ref: 38866f4f8abe803a226f8266971c0be6ab75ebcc",
    "EXPECTED_PENDING: 0036_workhub_announcement_delivery.sql",
    "PREVIEW_DATABASE_ID: f1ce1268-2be2-4a20-ab10-a94c32feee64",
    "CLOUDFLARE_D1_MIGRATION_TOKEN",
    "node scripts/preview-d1-migration-guard.mjs --check-config",
    "node scripts/preview-d1-migration-guard.mjs --check-plan",
    "CLOUDFLARE_ENV=preview npm run build",
    "target.name !== 'ai-driven-fullstack-webapp-template-preview'",
    "wrangler d1 execute DB --remote --preview --json",
  ]) {
    assert.ok(yml.includes(requirement), `Missing one-time execution safety contract: ${requirement}`);
  }
  const migrationApply = "npx wrangler d1 migrations apply DB --remote --preview";
  const deploy = "npx wrangler deploy";
  assert.equal(yml.split(migrationApply).length - 1, 1);
  assert.equal(yml.split(deploy).length - 1, 1);
  assert.ok(yml.indexOf("--check-plan /tmp/preview-pending-0036-final.txt") < yml.indexOf(migrationApply));
  assert.ok(yml.indexOf(migrationApply) < yml.indexOf("Read back exactly four new columns"));
  assert.ok(yml.indexOf("Read back exactly four new columns") < yml.indexOf(deploy));
  assert.ok(yml.indexOf("Generated Cloudflare deployment config is strictly Preview") < yml.indexOf(deploy));
  assert.ok(yml.indexOf("gh issue comment 132") > yml.indexOf(deploy));
  assert.doesNotMatch(yml, /--env production|CLOUDFLARE_ENV=production|d1 migrations apply DB --remote --env production/u);
});
