/**
 * Isolated Wrangler Local D1 contract for Master cutover + durable Audit.
 * Uses the actual local workerd D1 binding and its batch() transaction, never
 * a remote binding or persistent local DB. Not a production/concurrent HTTP test.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    "--module", "CommonJS", "--moduleResolution", "Node", "--esModuleInterop",
    "--types", "node,@cloudflare/workers-types", "--strict", "--skipLibCheck",
  ], { stdio: "inherit" });
  writeFileSync(join(compiled, "package.json"), '{"type":"commonjs"}');
  // Compiled Worker imports shared reporting dependencies. Node resolves them
  // relative to /tmp/.../compiled, not from this harness in the repo root.
  // Reuse npm ci dependencies; keep the local D1 test isolated and offline.
  symlinkSync(resolve("node_modules"), join(compiled, "node_modules"), "dir");
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
  for (const migration of ["0002_auth_foundation", "0003_authorization_foundation", "0007_session_idle_timeout", "0008_user_lifecycle", "0016_durable_audit_storage", "0017_async_job_runs", "0022_master_data", "0026_integration_event_outbox", "0027_inbound_webhook_receipts"]) {
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
    ...Array.from({ length: 3 }, (_, n) => ["test", "pending", "pending-due-" + n]),
    ...Array.from({ length: 2 }, (_, n) => ["test", "pending", "pending-future-" + n]),
    ...Array.from({ length: 2 }, (_, n) => ["test", "processing", "processing-" + n]),
    ["test", "delivered", "done"],
    ...Array.from({ length: 4 }, (_, n) => ["production", "dead_letter", "pd-" + n]),
  ];
  await db.batch(outboxFixtures.map(([environment, status, id]) => db.prepare(
    "INSERT INTO integration_events(id,environment,event_type,schema_version,occurred_at,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
  ).bind(id, environment, "travel.approved", 1, createdAt, "{}", createdAt)));
  await db.batch(outboxFixtures.map(([environment, status, id]) => db.prepare(
    "INSERT INTO integration_outbox(id,environment,integration_event_id,destination_key,status,available_at,attempt_count,failure_code,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(id, environment, id, "test-provider", status,
    id.startsWith("pending-future-") ? "2099-01-01T00:00:00.000Z" : createdAt, 1,
    id === "r-9" ? "sensitive-provider-credential" : "provider_unavailable", 1, createdAt, createdAt)));

  // A provider exception may mean accepted-but-response-lost. Keep the existing
  // dead-letter record for manual reconciliation; never claim retry eligibility.
  await db.prepare(
    "UPDATE integration_outbox SET failure_code = ? WHERE environment = ? AND id = ?",
  ).bind("delivery_outcome_unknown", "test", "dl-1").run();

  // Existing #304 inbound receipt persistence: no new schema or live Provider.
  // 22 current failures exceed one page, while processed/other Environment
  // records must never appear. Tokens/event identity are not read by the API.
  const inboundFixtures = [
    ...Array.from({ length: 21 }, (_, n) => ["test", "failed", "ib-" + n, n]),
    ["test", "dead_letter", "ib-dead", 21],
    ["test", "processed", "ib-ok", 22],
    ["production", "failed", "ib-prod", 23],
  ];
  await db.batch(inboundFixtures.map(([environment, status, id, n]) => {
    const timestamp = new Date(Date.parse(createdAt) + Number(n) * 1000).toISOString();
    return db.prepare(
      "INSERT INTO inbound_webhook_receipts(id,environment,provider_key,replay_key,event_type,received_at,status,attempt_count,failure_code,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(id, environment, "demo.webhook", "private-replay-token-" + id,
      "private.business.event", timestamp, status, 2,
      id === "ib-dead" ? "sensitive-provider-credential" : "business_processing_failed",
      3, timestamp, timestamp);
  }));

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
    assert.deepEqual(outbox.watch, {
      duePending: 3, dueRetryWait: 10, processing: 2,
      oldestProcessingUpdatedAt: createdAt,
    }, "due != failure; processing is a candidate for inspection, not a proven stuck job");
    assert.equal(outbox.attentionItems.length, 8, "candidate rows remain bounded");
    assert.ok(outbox.attentionItems.every((item) =>
      ["pending", "processing", "retry_wait"].includes(item.status)
      && !item.outboxId.startsWith("pending-future-")
      && !item.outboxId.startsWith("pd-")));
    assert.ok(outbox.attentionItems.some((item) => item.status === "pending"));
    assert.ok(outbox.attentionItems.some((item) => item.status === "processing"));
    assert.ok(outbox.attentionItems.every((item) => !("payload" in item)
      && !("destinationKey" in item) && item.failureCode !== "sensitive-provider-credential"));
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
    console.log("Wrangler Local D1 Outbox summary passed: failures + due-eligible/processing candidates, environment and auth isolation");
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
    assert.deepEqual(detailBody.decision.operationGate, {
      operationId: "DELIVERY_RETRY", risk: "CONTROLLED_CHANGE",
      policyDecision: "DENY", policyVersion: "operations-policy-v1",
      blocker: "provider_receipt_unverified", executionAllowed: false,
    }, "shared Operations Core denies the unverified retry before any provider action");
    assert.ok(!("payload" in detailBody) && !("destinationKey" in detailBody.outbox));
    const pendingDetail = await outboxGet(admin,
      baseUrl + "/api/admin/integrations/outbox/r-1?scopeId=workhub-company");
    const pendingBody = await pendingDetail.json();
    assert.equal(pendingBody.decision.nextAction, "await_scheduled_retry");
    assert.equal(pendingBody.decision.operationGate.policyDecision, "DENY",
      "scheduled retry must not authorize a manual retry");
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
    const unknownDeliveryDetail = await outboxGet(admin,
      baseUrl + "/api/admin/integrations/outbox/dl-1?scopeId=workhub-company");
    assert.equal(unknownDeliveryDetail.status, 200);
    const unknownDeliveryBody = await unknownDeliveryDetail.json();
    assert.equal(unknownDeliveryBody.outbox.status, "dead_letter");
    assert.equal(unknownDeliveryBody.outbox.failureCode, "delivery_outcome_unknown");
    assert.equal(unknownDeliveryBody.decision.nextAction, "reconcile_external_first");
    assert.equal(unknownDeliveryBody.decision.manualRetryAllowed, false);
    assert.equal(unknownDeliveryBody.decision.operationGate.policyDecision, "DENY");
    assert.equal(unknownDeliveryBody.decision.operationGate.blocker, "provider_receipt_unverified");
    assert.equal((await db.prepare(
      "SELECT version FROM integration_outbox WHERE id = ? AND environment = ?",
    ).bind("dl-1", "test").first()).version, 1);
    console.log("Wrangler Local D1 Outbox detail passed: read only, reconcile guidance, mask, cross-environment denial");

    // Actual Worker HTTP + real isolated D1 inbound webhook failure drilldown.
    const inboundUrl = baseUrl + "/api/admin/integrations/inbound/_failures?scopeId=workhub-company";
    const inboundGet = (session, url = inboundUrl, method = "GET") => fetch(url, {
      method, headers: session ? { cookie: "app_session=" + session.token } : {},
    });
    const inboundPageResponse = await inboundGet(admin);
    assert.equal(inboundPageResponse.status, 200);
    assert.equal(inboundPageResponse.headers.get("cache-control"), "no-store");
    const inboundPage = await inboundPageResponse.json();
    assert.equal(inboundPage.coverage, "environment");
    assert.equal(inboundPage.source, "local_inbound_receipt");
    assert.equal(inboundPage.environment, "test");
    assert.equal(inboundPage.replayAvailable, false);
    assert.equal(inboundPage.pageLimit, 20);
    assert.equal(inboundPage.items.length, 20, "inbound receipts paginate 20 records at most");
    assert.ok(inboundPage.items.every((item) =>
      ["failed", "dead_letter"].includes(item.status)
      && item.providerKey === "demo.webhook"
      && ["business_processing_failed", "other"].includes(item.failureCode)
      && !item.receiptId.startsWith("ib-prod") && item.receiptId !== "ib-ok"));
    assert.ok(inboundPage.items.some(item => item.receiptId === "ib-dead"
      && item.failureCode === "other"), "untrusted provider failure code must be masked");
    assert.ok(inboundPage.nextCursor);
    assert.ok(!JSON.stringify(inboundPage).includes("private-replay-token")
      && !JSON.stringify(inboundPage).includes("sensitive-provider-credential")
      && !JSON.stringify(inboundPage).includes("private.business.event"));
    const inboundPage2Response = await inboundGet(admin,
      inboundUrl + "&cursor=" + encodeURIComponent(inboundPage.nextCursor));
    assert.equal(inboundPage2Response.status, 200);
    const inboundPage2 = await inboundPage2Response.json();
    assert.equal(inboundPage2.items.length, 2);
    assert.equal(inboundPage2.nextCursor, null);
    assert.ok(inboundPage2.items.every(item => !inboundPage.items.some(
      previous => previous.receiptId === item.receiptId)));

    const inboundDetailUrl = baseUrl + "/api/admin/integrations/inbound/ib-dead?scopeId=workhub-company";
    const inboundDetailResponse = await inboundGet(admin, inboundDetailUrl);
    assert.equal(inboundDetailResponse.status, 200);
    assert.equal(inboundDetailResponse.headers.get("cache-control"), "no-store");
    const inboundDetail = await inboundDetailResponse.json();
    assert.deepEqual(inboundDetail.receipt, {
      receiptId: "ib-dead", providerKey: "demo.webhook",
      status: "dead_letter", attemptCount: 2,
      receivedAt: new Date(Date.parse(createdAt) + 21000).toISOString(),
      updatedAt: new Date(Date.parse(createdAt) + 21000).toISOString(),
      version: 3, failureCode: "other",
    });
    assert.deepEqual(inboundDetail.decision, {
      nextAction: "inspect_processing_failure", manualRetryAllowed: false,
      replayAvailable: false,
      rationale: "Verified receipt metadata cannot safely replay a provider event.",
    });
    assert.ok(!JSON.stringify(inboundDetail).includes("private-replay-token")
      && !JSON.stringify(inboundDetail).includes("sensitive-provider-credential")
      && !JSON.stringify(inboundDetail).includes("private.business.event"));
    assert.equal((await inboundGet(admin,
      baseUrl + "/api/admin/integrations/inbound/ib-ok?scopeId=workhub-company")).status, 404);
    assert.equal((await inboundGet(admin,
      baseUrl + "/api/admin/integrations/inbound/ib-prod?scopeId=workhub-company")).status, 404);
    assert.equal((await inboundGet(admin,
      baseUrl + "/api/admin/integrations/inbound/not-found?scopeId=workhub-company")).status, 404);
    assert.equal((await inboundGet(null, inboundDetailUrl)).status, 401);
    assert.equal((await inboundGet(observer, inboundUrl)).status, 403);
    assert.equal((await inboundGet(observer, inboundDetailUrl)).status, 403);
    assert.equal((await inboundGet(admin,
      baseUrl + "/api/admin/integrations/inbound/ib-dead?scopeId=other-company")).status, 403);
    assert.equal((await inboundGet(admin, inboundUrl + "&cursor=bad!")).status, 400);
    assert.equal((await inboundGet(admin, inboundDetailUrl + "&cursor=bad")).status, 400);
    assert.equal((await inboundGet(admin, inboundUrl + "&status=failed")).status, 400);
    assert.equal((await inboundGet(admin, inboundDetailUrl, "POST")).status, 405);
    assert.equal((await inboundGet(admin,
      baseUrl + "/api/admin/integrations/inbound/%2F?scopeId=workhub-company")).status, 400);
    const inboundRowAfter = await db.prepare(
      "SELECT version,status,attempt_count FROM inbound_webhook_receipts WHERE id='ib-dead' AND environment='test'",
    ).first();
    assert.deepEqual(inboundRowAfter, { version: 3, status: "dead_letter", attempt_count: 2 },
      "inbound listing/detail must not mutate receipt or retry processing");
    console.log("Wrangler Local D1 inbound webhook failure list/detail passed: 22 paged, auth, scope/environment, masked and read-only");

    // #419: true merged observation over 22 inbound + 13 outbound CURRENT failures.
    // Records share timestamps across sources: preserve composite keyset ordering.
    const queueUrl = baseUrl + "/api/admin/integrations/failures?scopeId=workhub-company";
    const queueGet = (session, url = queueUrl, method = "GET") => fetch(url, {
      method, headers: session ? { cookie: "app_session=" + session.token } : {},
    });
    const queueFirstResponse = await queueGet(admin);
    assert.equal(queueFirstResponse.status, 200);
    assert.equal(queueFirstResponse.headers.get("cache-control"), "no-store");
    const queueFirst = await queueFirstResponse.json();
    assert.deepEqual(queueFirst.sources, ["outbound_delivery", "inbound_webhook"]);
    assert.equal(queueFirst.source, "local_failure_queue");
    assert.equal(queueFirst.coverage, "environment");
    assert.equal(queueFirst.environment, "test");
    assert.equal(queueFirst.manualRetryAllowed, false);
    assert.equal(queueFirst.providerReceipt, "unverified");
    assert.equal(queueFirst.pageLimit, 20);
    assert.equal(queueFirst.items.length, 20);
    assert.equal(queueFirst.items[0].id, "ib-dead");
    assert.ok(queueFirst.nextCursor);
    const queueSecondResponse = await queueGet(admin,
      queueUrl + "&cursor=" + encodeURIComponent(queueFirst.nextCursor));
    assert.equal(queueSecondResponse.status, 200);
    const queueSecond = await queueSecondResponse.json();
    assert.equal(queueSecond.items.length, 15, "second page includes both existing transports");
    assert.equal(queueSecond.nextCursor, null);
    const queueItems = [...queueFirst.items, ...queueSecond.items];
    assert.equal(queueItems.length, 35, "the whole local failure queue has 22 inbound + 13 outbound");
    assert.equal(new Set(queueItems.map(row => row.source + ":" + row.id)).size, 35);
    assert.equal(queueItems.filter(row => row.source === "inbound_webhook").length, 22);
    assert.equal(queueItems.filter(row => row.source === "outbound_delivery").length, 13);
    assert.ok(queueItems.some(row =>
      row.source === "outbound_delivery" && row.id === "r-9" && row.failureCode === "other"));
    assert.ok(queueItems.some(row =>
      row.source === "inbound_webhook" && row.id === "ib-dead" && row.failureCode === "other"));
    assert.ok(!queueItems.some(row => ["pd-0", "ib-prod", "ib-ok", "done"].includes(row.id)));
    assert.ok(queueItems.every(row => !("payload" in row) && !("replayKey" in row)
      && !("destinationKey" in row) && !("providerEventId" in row)));
    assert.ok(!JSON.stringify(queueItems).includes("sensitive-provider-credential")
      && !JSON.stringify(queueItems).includes("private-replay-token")
      && !JSON.stringify(queueItems).includes("private.business.event"));
    const orderKey = row => [row.updatedAt, row.source, row.id];
    for (let i = 1; i < queueItems.length; i++) {
      const before = orderKey(queueItems[i - 1]);
      const after = orderKey(queueItems[i]);
      assert.ok(before[0] > after[0]
        || (before[0] === after[0] && (before[1] > after[1]
          || (before[1] === after[1] && before[2] > after[2]))),
      "composite keyset must remain globally sorted across equal timestamps and channels");
    }
    assert.equal((await queueGet(null)).status, 401);
    assert.equal((await queueGet(observer)).status, 403);
    assert.equal((await queueGet(admin, queueUrl + "&cursor=bad!")).status, 400);
    assert.equal((await queueGet(admin, queueUrl + "&cursor=YWJj")).status, 400);
    assert.equal((await queueGet(admin, queueUrl + "&cursor=a&cursor=b")).status, 400);
    assert.equal((await queueGet(admin, queueUrl + "&status=failed")).status, 400);
    assert.equal((await queueGet(admin,
      baseUrl + "/api/admin/integrations/failures?scopeId=other-company")).status, 403);
    assert.equal((await queueGet(admin, queueUrl, "POST")).status, 405);
    const sourceAfterQueue = await db.prepare(
      "SELECT version,status FROM integration_outbox WHERE id='dl-1' AND environment='test'",
    ).first();
    assert.deepEqual(sourceAfterQueue, { version: 1, status: "dead_letter" });
    const inboundAfterQueue = await db.prepare(
      "SELECT version,status FROM inbound_webhook_receipts WHERE id='ib-dead' AND environment='test'",
    ).first();
    assert.deepEqual(inboundAfterQueue, { version: 3, status: "dead_letter" });
    console.log("Wrangler Local D1 unified integration failure queue passed: 35 merged / 2 pages / same timestamp / auth / masking / no mutations");

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
    assert.equal((await inboundGet(admin, inboundUrl)).status, 403,
      "inbound failure list must revoke privileges on the same live session");
    assert.equal((await inboundGet(admin, inboundDetailUrl)).status, 403,
      "inbound failure detail must revoke privileges on the same live session");
    assert.equal((await queueGet(admin)).status, 403,
      "cross-channel failure queue must revoke privileges on the same live session");
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
