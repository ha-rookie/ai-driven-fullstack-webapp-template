/**
 * Isolated Wrangler Local D1 contract for Master cutover + durable Audit.
 * Uses the actual local workerd D1 binding and its batch() transaction, never
 * a remote binding or persistent local DB. Not a production/concurrent HTTP test.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";

const scratch = mkdtempSync(join(tmpdir(), "master-local-d1-"));
let proxy;
try {
  const compiled = join(scratch, "compiled");
  execFileSync(process.execPath, [
    resolve("node_modules/typescript/bin/tsc"),
    "src/worker/master-data/d1-store.ts",
    "src/worker/audit/durable-audit-store.ts",
    "--outDir", compiled, "--rootDir", "src", "--target", "ES2023",
    "--module", "CommonJS", "--moduleResolution", "Node",
    "--types", "node,@cloudflare/workers-types", "--strict", "--skipLibCheck",
  ], { stdio: "inherit" });
  writeFileSync(join(compiled, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const { D1MasterDataStore } = require(join(compiled, "worker/master-data/d1-store.js"));
  const { prepareDurableAuditRecord, verifyDurableAuditRecord } = require(
    join(compiled, "worker/audit/durable-audit-store.js"),
  );

  // In-memory local bindings, with remote bindings explicitly disabled.
  proxy = await getPlatformProxy({
    configPath: resolve("wrangler.jsonc"), persist: false, remoteBindings: false,
  });
  const db = proxy.env.DB;
  assert.ok(db && typeof db.batch === "function", "Wrangler local D1 batch() must be available");
  for (const migration of ["0016_durable_audit_storage", "0022_master_data"]) {
    await db.exec(readFileSync(resolve("migrations", migration + ".sql"), "utf8"));
  }
  const store = new D1MasterDataStore(db);
  const createdAt = "2026-10-10T00:00:00.000Z";
  const cutoff = "2027-04-01T00:00:00.000Z";
  const firstEffectiveFrom = "2026-01-01T00:00:00.000Z";

  const seed = async (id) => {
    await db.batch([
      db.prepare("INSERT INTO master_items (id, environment, master_key, code, version, next_revision, last_mutation_id, retired_at, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, "test", "workhub.office", id, 2, 2, "seed-r1", null,
          createdAt, "fixture", createdAt, "fixture"),
      db.prepare("INSERT INTO master_revisions (id, environment, master_item_id, revision, label, enabled, effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id + "-r1", "test", id, 1, "Before", 1, firstEffectiveFrom, null, 10,
          null, "{}", createdAt, "fixture"),
    ]);
  };
  const proof = (itemId, requestId, auditId) => prepareDurableAuditRecord({
    requestId, method: "POST", path: "/api/admin/master-operations/schedule/execute",
    category: "system", action: "operation.SCHEDULE_MASTER_REVISION",
    outcome: "success", actorId: "kai", scopeId: "workhub-company",
    resourceType: "master_item", resourceId: itemId, reason: "reason_sha256:local-d1",
  }, "test", {
    clock: { now: () => new Date(createdAt) },
    idGenerator: { generate: () => auditId },
  });
  const makeCutover = (id, suffix, durableAudit) => ({
    item: {
      id, environment: "test", masterKey: "workhub.office", code: id,
      version: 3, nextRevision: 3, retiredAt: null,
      createdAt, createdBy: "fixture", updatedAt: createdAt, updatedBy: "kai",
    },
    expectedItemVersion: 2,
    mutationId: id + "-mutation-" + suffix,
    priorRevisionId: id + "-r1",
    revision: {
      id: id + "-r2-" + suffix, environment: "test", masterItemId: id,
      revision: 2, label: "Candidate " + suffix, enabled: true,
      effectiveFrom: cutoff, effectiveTo: null, displayOrder: 10,
      parentItemId: null, attributes: {}, createdAt, createdBy: "kai",
    },
    durableAudit,
  });
  const first = async (sql, ...values) => db.prepare(sql).bind(...values).first();
  const rows = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results ?? [];

  // Two requests observe v2 before either commits. Real local D1 handles the
  // two atomic batch() calls; no harness-level mock of transaction outcomes.
  const competingId = "workhub-office-local-d1-competition";
  await seed(competingId);
  const commands = [
    makeCutover(competingId, "a", await proof(competingId, "local-req-a", "local-audit-a")),
    makeCutover(competingId, "b", await proof(competingId, "local-req-b", "local-audit-b")),
  ];
  const outcomes = await Promise.all(commands.map((command) => store.scheduleRevision(command)));
  assert.equal(outcomes.filter(Boolean).length, 1, "exactly one cutover batch may commit");
  const winner = commands[outcomes[0] ? 0 : 1];
  const loser = commands[outcomes[0] ? 1 : 0];
  const master = await first("SELECT version, next_revision, last_mutation_id FROM master_items WHERE id = ?", competingId);
  assert.equal(master.version, 3);
  assert.equal(master.next_revision, 3);
  assert.equal(master.last_mutation_id, winner.mutationId);
  const historical = await first("SELECT effective_to FROM master_revisions WHERE id = ?", competingId + "-r1");
  assert.equal(historical.effective_to, cutoff);
  const future = await rows("SELECT id, label FROM master_revisions WHERE master_item_id = ? AND revision = 2", competingId);
  assert.equal(future.length, 1);
  assert.equal(future[0].id, winner.revision.id);
  assert.equal(future[0].label, winner.revision.label);
  assert.equal(await first("SELECT id FROM master_revisions WHERE id = ?", loser.revision.id), null);
  const audits = await rows("SELECT id, request_id, record_json, record_sha256 FROM durable_audit_events WHERE resource_id = ?", competingId);
  assert.equal(audits.length, 1, "loser cannot leave a durable success audit");
  assert.equal(audits[0].id, winner.durableAudit.id);
  assert.equal(audits[0].request_id, winner.durableAudit.record.requestId);
  const verified = await verifyDurableAuditRecord(audits[0].record_json, audits[0].record_sha256);
  assert.equal(verified.resourceId, competingId);
  assert.equal(verified.action, "operation.SCHEDULE_MASTER_REVISION");

  // Make the last (audit INSERT) statement fail with an actual D1 PK violation:
  // ALL preceding item/revision mutations must roll back in the same batch.
  const rollbackId = "workhub-office-local-d1-audit-failure";
  await seed(rollbackId);
  const conflictingAudit = await proof(rollbackId, "local-req-audit-failure", winner.durableAudit.id);
  await assert.rejects(store.scheduleRevision(makeCutover(rollbackId, "bad-audit", conflictingAudit)));
  const afterFailure = await first("SELECT version, next_revision, last_mutation_id FROM master_items WHERE id = ?", rollbackId);
  assert.equal(afterFailure.version, 2);
  assert.equal(afterFailure.next_revision, 2);
  assert.equal(afterFailure.last_mutation_id, "seed-r1");
  assert.equal((await first("SELECT effective_to FROM master_revisions WHERE id = ?", rollbackId + "-r1")).effective_to, null);
  assert.equal(await first("SELECT id FROM master_revisions WHERE master_item_id = ? AND revision = 2", rollbackId), null);
  assert.equal((await rows("SELECT id FROM durable_audit_events WHERE resource_id = ?", rollbackId)).length, 0);
  assert.equal((await rows("SELECT id FROM durable_audit_events")).length, 1,
    "failed audit must not overwrite the winning audit");

  console.log("Wrangler Local D1 Master atomic batch passed: competing cutover=1 winner, audit rollback=clean");
} finally {
  if (proxy) await proxy.dispose();
  rmSync(scratch, { recursive: true, force: true });
}
