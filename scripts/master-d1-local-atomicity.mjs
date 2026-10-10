/**
 * Isolated Wrangler Local D1 contract for Master cutover + durable Audit.
 * Uses the actual local workerd D1 binding and its batch() transaction, never
 * a remote binding or persistent local DB. Not a production/concurrent HTTP test.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
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
    "src/worker/administration/master-data-viewer-api.ts",
    "src/worker/auth/application-session.ts",
    "src/worker.ts",
    "--outDir", compiled, "--rootDir", "src", "--target", "ES2023",
    "--module", "CommonJS", "--moduleResolution", "Node",
    "--types", "node,@cloudflare/workers-types", "--strict", "--skipLibCheck",
  ], { stdio: "inherit" });
  writeFileSync(join(compiled, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const { D1MasterDataStore } = require(join(compiled, "worker/master-data/d1-store.js"));
  const { handleMasterDataViewerApi } = require(join(compiled, "worker/administration/master-data-viewer-api.js"));
  const { issueApplicationSession } = require(join(compiled, "worker/auth/application-session.js"));
  const applicationWorker = require(join(compiled, "worker.js")).default;
  const { prepareDurableAuditRecord, verifyDurableAuditRecord } = require(
    join(compiled, "worker/audit/durable-audit-store.js"),
  );

  // In-memory local bindings, with remote bindings explicitly disabled.
  proxy = await getPlatformProxy({
    configPath: resolve("wrangler.jsonc"), persist: false, remoteBindings: false,
  });
  const db = proxy.env.DB;
  assert.ok(db && typeof db.batch === "function", "Wrangler local D1 batch() must be available");
  for (const migration of ["0002_auth_foundation", "0003_authorization_foundation", "0007_session_idle_timeout", "0008_user_lifecycle", "0016_durable_audit_storage", "0017_async_job_runs", "0022_master_data", "0026_integration_event_outbox"]) {
    // D1 exec() splits source text on newlines; real migration CREATE TABLE
    // statements are multiline. Execute each semicolon-delimited DDL statement.
    const source = readFileSync(resolve("migrations", migration + ".sql"), "utf8");
    for (const ddl of source.split(";").map((statement) => statement.trim()).filter(Boolean)) {
      await db.prepare(ddl).run();
    }
  }
  const store = new D1MasterDataStore(db);
  const createdAt = "2026-10-10T00:00:00.000Z";
  const cutoff = "2027-04-01T00:00:00.000Z";
  const firstEffectiveFrom = "2026-01-01T00:00:00.000Z";

  const seed = async (id, environment = "test", masterKey = "workhub.office") => {
    await db.batch([
      db.prepare("INSERT INTO master_items (id, environment, master_key, code, version, next_revision, last_mutation_id, retired_at, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, environment, masterKey, id, 2, 2, "seed-r1", null,
          createdAt, "fixture", createdAt, "fixture"),
      db.prepare("INSERT INTO master_revisions (id, environment, master_item_id, revision, label, enabled, effective_from, effective_to, display_order, parent_item_id, attributes_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id + "-r1", environment, id, 1, "Before", 1, firstEffectiveFrom, null, 10,
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
  // The store may surface a D1 uniqueness constraint as false (expected
  // conflict) or as a rejected promise; either outcome must leave no writes.
  const auditFailure = await store.scheduleRevision(
    makeCutover(rollbackId, "bad-audit", conflictingAudit),
  ).then((result) => result, (error) => error);
  assert.ok(auditFailure === false || auditFailure instanceof Error,
    "a failed durable audit write must never report a committed mutation");
  const afterFailure = await first("SELECT version, next_revision, last_mutation_id FROM master_items WHERE id = ?", rollbackId);
  assert.equal(afterFailure.version, 2);
  assert.equal(afterFailure.next_revision, 2);
  assert.equal(afterFailure.last_mutation_id, "seed-r1");
  assert.equal((await first("SELECT effective_to FROM master_revisions WHERE id = ?", rollbackId + "-r1")).effective_to, null);
  assert.equal(await first("SELECT id FROM master_revisions WHERE master_item_id = ? AND revision = 2", rollbackId), null);
  assert.equal((await rows("SELECT id FROM durable_audit_events WHERE resource_id = ?", rollbackId)).length, 0);
  assert.equal((await rows("SELECT id FROM durable_audit_events")).length, 1,
    "failed audit must not overwrite the winning audit");

  // Session and role acceptance against the real D1-backed API handler.
  const scheduleId = "local-allowed-schedule";
  const retireId = "local-allowed-retire";
  const ordinaryId = "local-read-only-item";
  const retiredId = "local-retired-item";
  const productionId = "local-production-item";
  for (const id of [scheduleId, retireId, ordinaryId, retiredId]) await seed(id);
  await seed(productionId, "production");
  await db.prepare("UPDATE master_items SET retired_at = ? WHERE id = ?")
    .bind(createdAt, retiredId).run();
  await db.batch([
    ...["admin", "observer", "outsider"].map((id) =>
      db.prepare("INSERT INTO users(id,created_at,updated_at,status) VALUES(?,?,?,?)")
        .bind(id, createdAt, createdAt, "active")),
    ...["workhub-company", "other-company"].map((id) =>
      db.prepare("INSERT INTO resource_scopes(id,name,created_at,updated_at) VALUES(?,?,?,?)")
        .bind(id, id, createdAt, createdAt)),
    ...[["workhub-company", "admin", "system_admin"], ["workhub-company", "observer", "observer"],
      ["other-company", "outsider", "system_admin"]].map(([scope, id, role]) =>
      db.prepare("INSERT INTO scope_memberships(scope_id,user_id,role,created_at,updated_at) VALUES(?,?,?,?,?)")
        .bind(scope, id, role, createdAt, createdAt)),
  ]);
  const sessions = await Promise.all(
    ["admin", "observer", "outsider"].map((id) => issueApplicationSession(db, id)),
  );
  const [admin, observer, outsider] = sessions;
  const viewerOptions = {
    scopeId: "workhub-company",
    masterKeys: ["workhub.office"],
    authorizationPolicy: { "master_data:view": ["system_admin", "observer"] },
    operations: [
      { kind: "schedule", masterKey: "workhub.office", allowedItemIds: [scheduleId, retiredId, productionId],
        action: "master_data:schedule", authorizationPolicy: { "master_data:schedule": ["system_admin"] } },
      { kind: "retire", masterKey: "workhub.office", allowedItemIds: [retireId],
        action: "master_data:retire", authorizationPolicy: { "master_data:retire": ["system_admin"] } },
    ],
  };
  // Actual production Master handler: only the options are local fixtures.
  const readMaster = (id, session, overrides = {}) => {
    const query = new URLSearchParams({
      scopeId: overrides.scopeId ?? "workhub-company",
      masterKey: overrides.masterKey ?? "workhub.office",
      itemId: id,
    });
    return handleMasterDataViewerApi(
      new Request("https://local.test/api/admin/master-data?" + query, {
        headers: session ? { cookie: "app_session=" + session.token } : {},
      }),
      { DB: db, RUNTIME_ENVIRONMENT: overrides.environment ?? "test" },
      "master-local-d1-auth", viewerOptions,
    );
  };
  const assertOperations = async (id, session, expected) => {
    const response = await readMaster(id, session);
    assert.equal(response?.status, 200, "detail must be readable");
    const data = await response.json();
    assert.equal(data.item.id, id);
    assert.deepEqual(data.allowedOperations, expected);
    assert.equal(data.revisions.length, 1);
  };
  await assertOperations(scheduleId, admin, ["schedule"]);
  await assertOperations(retireId, admin, ["retire"]);
  await assertOperations(ordinaryId, admin, []);
  await assertOperations(scheduleId, observer, []);
  await assertOperations(retireId, observer, []);
  await assertOperations(retiredId, admin, []);
  const production = await readMaster(productionId, admin, { environment: "production" });
  assert.equal(production?.status, 200);
  assert.deepEqual((await production.json()).allowedOperations, []);
  assert.equal((await readMaster(scheduleId, null))?.status, 401);
  assert.equal((await readMaster(scheduleId, outsider))?.status, 403);
  assert.equal((await readMaster(scheduleId, admin, { scopeId: "other-company" }))?.status, 403);
  assert.equal((await readMaster(scheduleId, admin, { masterKey: "other.master" }))?.status, 404);
  assert.equal((await readMaster(scheduleId, admin, { environment: "production" }))?.status, 404);
  assert.equal((await readMaster(scheduleId, admin, { environment: "untrusted" }))?.status, 503);

  // Loopback HTTP acceptance through the ACTUAL application Worker router.
  // The only bridge is Node HTTP -> Web Request/Response; Worker auth, role
  // policy, Project allowlist, routing and security headers remain unmocked.
  const projectTargets = require(join(compiled, "reference/workhub/travel-request/index.js"));
  const projectSchedule = projectTargets.WORKHUB_SCHEDULE_DEMO_ITEM_ID;
  const projectRetire = projectTargets.WORKHUB_RETIRE_DEMO_ITEM_ID;
  const projectRetired = projectTargets.WORKHUB_AVAILABILITY_DISABLE_ITEM_ID;
  const projectProduction = projectTargets.WORKHUB_ORDER_DEMO_ITEM_ID;
  const projectReadOnly = "workhub-office-tokyo";
  const expenseKey = projectTargets.WORKHUB_EXPENSE_CATEGORY_MASTER_KEY;
  const expenseSample = projectTargets.WORKHUB_REFERENCE_EXPENSE_CATEGORIES[0];
  for (const id of [projectSchedule, projectRetire, projectRetired, projectReadOnly]) await seed(id);
  await seed(expenseSample.id, "test", expenseKey);
  await seed(projectProduction, "production");

  // Reuse the existing real Worker HTTP/Local D1 harness for the authorized
  // environment-wide summary. 31 terminal jobs exceed the 20-row viewer limit;
  // production fixtures must never contaminate the test environment count.
  const jobFixtures = [
    ...Array.from({ length: 27 }, (_, n) => ["test", "failed", "f-" + n]),
    ...Array.from({ length: 4 }, (_, n) => ["test", "dead_letter", "d-" + n]),
    ...Array.from({ length: 2 }, (_, n) => ["test", "completed", "c-" + n]),
    ...Array.from({ length: 5 }, (_, n) => ["production", "failed", "p-" + n]),
  ];
  await db.batch(jobFixtures.map(([environment, state, id]) => db.prepare(
    "INSERT INTO async_job_runs(environment,job_id,job_type,idempotency_key,payload_fingerprint,state,attempt,requested_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).bind(environment, id, "test.job", environment + "-" + id,
    "a".repeat(64), state, 1, createdAt, createdAt)));

  // Read-only Outbox projection acceptance: data is environment-scoped, not Scope-scoped.
  const outboxFixtures = [
    ...Array.from({ length: 10 }, (_, n) => ["test", "retry_wait", "r-" + n]),
    ...Array.from({ length: 3 }, (_, n) => ["test", "dead_letter", "dl-" + n]),
    ["test", "delivered", "done"],
    ...Array.from({ length: 4 }, (_, n) => ["production", "dead_letter", "pd-" + n]),
  ];
  await db.batch(outboxFixtures.map(([environment, status, id]) => db.prepare(
    "INSERT INTO integration_events(id,environment,event_type,schema_version,occurred_at,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id, environment, "travel.approved", 1, createdAt, "{}", createdAt)));
  await db.batch(outboxFixtures.map(([environment, status, id]) => db.prepare(
    "INSERT INTO integration_outbox(id,environment,integration_event_id,destination_key,status,available_at,attempt_count,failure_code,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, environment, id, "test-provider", status, createdAt, 1,
    id === "r-9" ? "sensitive-provider-credential" : "provider_unavailable", 1, createdAt, createdAt)));

  await db.prepare("UPDATE master_items SET retired_at=? WHERE id=?")
    .bind(createdAt, projectRetired).run();

  let localRuntime = "test";
  const httpServer = createServer((incoming, outgoing) => {
    void (async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) headers.set(name, value.join(", "));
        else if (typeof value === "string") headers.set(name, value);
      }
      const request = new Request("http://127.0.0.1" + incoming.url, {
        method: incoming.method, headers,
      });
      const response = await applicationWorker.fetch(request, {
        DB: db, RUNTIME_ENVIRONMENT: localRuntime,
        ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
      });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error) => {
      console.error("Isolated Master Worker HTTP bridge failed", error);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    });
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  try {
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    const baseUrl = "http://127.0.0.1:" + address.port;
    const workerRead = async (itemId, session, overrides = {}) => {
      const query = new URLSearchParams({
        scopeId: overrides.scopeId ?? "workhub-company",
        masterKey: overrides.masterKey ?? "workhub.office",
        itemId,
      });
      const response = await fetch(baseUrl + "/api/admin/master-data?" + query, {
        headers: {
          "x-request-id": "local-master-http-001",
          ...(session ? { cookie: "app_session=" + session.token } : {}),
        },
      });
      return { response, body: await response.json() };
    };
    const assertWorkerRead = async (itemId, session, expected) => {
      const { response, body } = await workerRead(itemId, session);
      assert.equal(response.status, 200, "real Worker HTTP read should succeed");
      assert.deepEqual(body.allowedOperations, expected);
      assert.equal(body.item.id, itemId);
      assert.equal(body.revisions.length, 1);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-request-id"), "local-master-http-001");
    };
    const summaryUrl = baseUrl + "/api/admin/jobs/summary?scopeId=workhub-company";
    const summaryGet = async (session, url = summaryUrl, method = "GET") =>
      fetch(url, {
        method,
        headers: session ? { cookie: "app_session=" + session.token } : {},
      });
    const summaryResponse = await summaryGet(admin);
    assert.equal(summaryResponse.status, 200, "authorized single-scope summary should be available");
    assert.equal(summaryResponse.headers.get("cache-control"), "no-store");
    const summary = await summaryResponse.json();
    assert.equal(summary.coverage, "environment", "scope-specific total cannot be claimed");
    assert.equal(summary.environment, "test");
    assert.deepEqual(summary.counts, { failed: 27, deadLetter: 4 });
    assert.deepEqual(Object.keys(summary).sort(), ["counts", "coverage", "environment", "observedAt"]);
    assert.equal((await summaryGet(null)).status, 401);
    assert.equal((await summaryGet(observer)).status, 403);
    assert.equal((await summaryGet(admin, baseUrl + "/api/admin/jobs/summary?scopeId=other-company")).status, 403);
    assert.equal((await summaryGet(admin, summaryUrl + "&state=failed")).status, 400);
    assert.equal((await summaryGet(admin, summaryUrl, "POST")).status, 405);
    console.log("Wrangler Local D1 Job summary passed: exact >20 count, environment isolation, safe refusal");

    const outboxUrl = baseUrl + "/api/admin/integrations/outbox?scopeId=workhub-company";
    const outboxGet = (session, url = outboxUrl, method = "GET") => fetch(url, {
      method, headers: session ? { cookie: "app_session=" + session.token } : {},
    });
    const outboxResponse = await outboxGet(admin);
    assert.equal(outboxResponse.status, 200);
    assert.equal(outboxResponse.headers.get("cache-control"), "no-store");
    const outbox = await outboxResponse.json();
    assert.equal(outbox.coverage, "environment");
    assert.equal(outbox.environment, "test");
    assert.deepEqual(outbox.counts, { retryWait: 10, deadLetter: 3 },
      "delivery failures are distinct from async job failures and from production");
    assert.equal(outbox.sampleLimit, 8);
    assert.equal(outbox.items.length, 8);
    assert.ok(outbox.items.every((item) => !JSON.stringify(item).includes("sensitive-provider-credential")));
    assert.ok(outbox.items.every((item) => !("destinationKey" in item) && !("payload" in item)));
    assert.ok(outbox.items.some((item) => item.failureCode === "other"),
      "untrusted provider diagnostic codes must not be emitted raw");
    assert.equal((await outboxGet(null)).status, 401);
    assert.equal((await outboxGet(observer)).status, 403);
    assert.equal((await outboxGet(admin, baseUrl + "/api/admin/integrations/outbox?scopeId=other-company")).status, 403);
    assert.equal((await outboxGet(admin, outboxUrl + "&status=dead_letter")).status, 400);
    assert.equal((await outboxGet(admin, outboxUrl, "POST")).status, 405);
    console.log("Wrangler Local D1 Outbox summary passed: 13 current failures, 8 sampled, auth and environment isolation");
    const detailUrl = baseUrl + "/api/admin/integrations/outbox/dl-1?scopeId=workhub-company";
    const detail = await outboxGet(admin, detailUrl);
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    const detailBody = await detail.json();
    assert.equal(detailBody.outbox.outboxId, "dl-1");
    assert.equal(detailBody.outbox.status, "dead_letter");
    assert.equal(detailBody.outbox.version, 1);
    assert.equal(detailBody.decision.nextAction, "reconcile_external_first");
    assert.equal(detailBody.decision.providerOutcome, "unverified");
    assert.equal(detailBody.decision.manualRetryAllowed, false);
    assert.ok(!("payload" in detailBody) && !("destinationKey" in detailBody.outbox));
    const pendingDetail = await outboxGet(admin,
      baseUrl + "/api/admin/integrations/outbox/r-1?scopeId=workhub-company");
    assert.equal((await pendingDetail.json()).decision.nextAction, "await_scheduled_retry");
    const doneDetail = await outboxGet(admin,
      baseUrl + "/api/admin/integrations/outbox/done?scopeId=workhub-company");
    assert.equal((await doneDetail.json()).decision.nextAction, "none");
    const masked = await outboxGet(admin,
      baseUrl + "/api/admin/integrations/outbox/r-9?scopeId=workhub-company");
    const maskedBody = await masked.json();
    assert.equal(maskedBody.outbox.failureCode, "other");
    assert.ok(!JSON.stringify(maskedBody).includes("sensitive-provider-credential"));
    assert.equal((await outboxGet(admin, baseUrl
      + "/api/admin/integrations/outbox/pd-1?scopeId=workhub-company")).status, 404,
      "records in another environment are not addressable");
    assert.equal((await outboxGet(admin, baseUrl
      + "/api/admin/integrations/outbox/not-found?scopeId=workhub-company")).status, 404);
    assert.equal((await outboxGet(null, detailUrl)).status, 401);
    assert.equal((await outboxGet(observer, detailUrl)).status, 403);
    assert.equal((await outboxGet(admin, detailUrl + "&state=dead_letter")).status, 400);
    assert.equal((await outboxGet(admin, detailUrl, "POST")).status, 405);
    assert.equal((await outboxGet(admin, baseUrl
      + "/api/admin/integrations/outbox/%2F?scopeId=workhub-company")).status, 400);
    assert.equal((await outboxGet(admin, baseUrl
      + "/api/admin/integrations/outbox/dl-1?scopeId=other-company")).status, 403);
    assert.equal((await db.prepare("SELECT version FROM integration_outbox WHERE id='dl-1' AND environment='test'")
      .first()).version, 1, "read-only detail never modifies Outbox");
    console.log("Wrangler Local D1 Outbox detail passed: read only, reconcile guidance, mask, cross-environment denial");

    await assertWorkerRead(projectSchedule, admin, ["schedule"]);
    await assertWorkerRead(projectRetire, admin, ["retire"]);
    await assertWorkerRead(projectReadOnly, admin, []);
    await assertWorkerRead(projectRetired, admin, []);
    // Project-approved second definition must be readable but never mutable.
    // An office item under the expense key, and vice versa, are always 404.
    const expense = await workerRead(expenseSample.id, admin, { masterKey: expenseKey });
    assert.equal(expense.response.status, 200);
    assert.equal(expense.body.masterKey, expenseKey);
    assert.equal(expense.body.item.id, expenseSample.id);
    assert.deepEqual(expense.body.allowedOperations, []);
    assert.equal(expense.body.revisions.length, 1);
    const categoryList = await fetch(baseUrl + "/api/admin/master-data?" + new URLSearchParams({
      scopeId: "workhub-company", masterKey: expenseKey,
    }), { headers: { cookie: "app_session=" + admin.token } });
    assert.equal(categoryList.status, 200);
    assert.deepEqual((await categoryList.json()).items.map((item) => item.id), [expenseSample.id]);
    assert.equal((await workerRead(projectSchedule, admin, { masterKey: expenseKey })).response.status, 404);
    assert.equal((await workerRead(expenseSample.id, admin)).response.status, 404);
    assert.equal((await workerRead(expenseSample.id, observer, { masterKey: expenseKey })).response.status, 403);
    assert.equal((await workerRead(projectSchedule, observer)).response.status, 403);
    assert.equal((await workerRead(projectSchedule, outsider)).response.status, 403);
    assert.equal((await workerRead(projectSchedule, null)).response.status, 401);
    assert.equal((await workerRead(projectSchedule, admin, { scopeId: "other-company" })).response.status, 403);
    assert.equal((await workerRead(projectSchedule, admin, { masterKey: "other.master" })).response.status, 404);

    localRuntime = "production"; // Only a local test flag; no remote resource.
    const prod = await workerRead(projectProduction, admin);
    assert.equal(prod.response.status, 200);
    assert.deepEqual(prod.body.allowedOperations, []);
    localRuntime = "test";
    await db.prepare("UPDATE scope_memberships SET role=? WHERE user_id=? AND scope_id=?")
      .bind("observer", "admin", "workhub-company").run();
    assert.equal((await workerRead(projectSchedule, admin)).response.status, 403,
      "role revocation must apply to the same session over HTTP");
    assert.equal((await summaryGet(admin)).status, 403,
      "job summary must also revoke privileges on the same live session");
    assert.equal((await outboxGet(admin)).status, 403,
      "integration summary must also revoke privileges on the same live session");
    assert.equal((await outboxGet(admin, detailUrl)).status, 403,
      "integration detail must also revoke privileges on the same live session");
  } finally {
    await new Promise((resolve, reject) =>
      httpServer.close((err) => err ? reject(err) : resolve()));
  }
  console.log("Wrangler Local D1 Master Worker loopback HTTP passed: authorize, deny, retire, Production, role revoke");

  // Permission is live; a valid session never caches previously allowed links.
  await db.prepare("UPDATE scope_memberships SET role=? WHERE user_id=? AND scope_id=?")
    .bind("observer", "admin", "workhub-company").run();
  await assertOperations(scheduleId, admin, []);
  console.log("Wrangler Local D1 Master API role and target disclosure passed");

  console.log("Wrangler Local D1 Master atomic batch passed: competing cutover=1 winner, audit rollback=clean");
} finally {
  if (proxy) await proxy.dispose();
  rmSync(scratch, { recursive: true, force: true });
}
