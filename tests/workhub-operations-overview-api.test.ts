import assert from "node:assert/strict";
import test from "node:test";
import {
  handleWorkhubOperationsOverviewApi,
  projectOperationsOverviewSources,
  type OverviewSourceResponses,
} from "../src/worker/administration/workhub-operations-overview-api";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status });

const fixtures = (): OverviewSourceResponses => ({
  jobs: json({ coverage: "environment", environment: "test",
    observedAt: "2026-10-14T00:00:00.000Z", counts: { failed: 12, deadLetter: 3 },
    leakedInternal: "must-not-return" }),
  outbox: json({ coverage: "environment", environment: "test",
    observedAt: "2026-10-14T00:00:00.000Z",
    counts: { retryWait: 5, deadLetter: 2 },
    watch: { duePending: 1, dueRetryWait: 2, processing: 3,
      oldestProcessingUpdatedAt: null },
    sampleLimit: 8,
    items: [{ outboxId: "safe-1", status: "dead_letter", attemptCount: 2,
      updatedAt: "2026-10-14T00:00:00.000Z", failureCode: "other",
      rawProviderSecret: "must-not-return" }],
    attentionItems: [{ outboxId: "safe-2", status: "pending", attemptCount: 0,
      updatedAt: "2026-10-14T00:00:00.000Z",
      availableAt: "2026-10-14T00:00:00.000Z", failureCode: "other" }],
    payload: "must-not-return" }),
  auditFailures: json({ items: [{ category: "system", action: "operation.FAIL",
    reason: "must-not-return", actorId: "must-not-return" }], nextCursor: null }),
  privileged: json({ items: [{ category: "system", action: "operation.RETRY",
    requestId: "must-not-return" }], nextCursor: "page-next" }),
  master: json({ environment: "test", asOf: "2026-10-14T00:00:00.000Z",
    items: [{ secret: "must-not-return" }] }),
  database: json({ component: "database", status: "ok" }),
});

test("#414 safely projects existing six authorized source contracts into one payload", async () => {
  const result = await projectOperationsOverviewSources(fixtures());
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scopeId, "workhub-company");
  assert.equal(result.jobs.kind, "ready");
  assert.equal(result.outbox.kind, "ready");
  assert.equal(result.auditFailures.kind, "ready");
  assert.equal(result.master.kind, "ready");
  assert.equal(result.database.kind, "ready");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("must-not-return"), "raw source fields are not re-exposed");
  assert.ok(serialized.includes("page-next"), "audit coverage remains bounded");
  assert.ok(serialized.includes('"failed":12'));
});

test("#414 source failure, denied and malformed response never become healthy zero", async () => {
  const responses = fixtures();
  const result = await projectOperationsOverviewSources({
    ...responses,
    jobs: json({ coverage: "environment", environment: "test",
      observedAt: "2026-10-14T00:00:00.000Z",
      counts: { failed: -1, deadLetter: 0 } }),
    outbox: json({ error: { code: "forbidden" } }, 403),
    auditFailures: json({ error: { code: "unavailable" } }, 503),
    privileged: json({ items: [{ category: "system", action: "operation.FAIL",
      reason: "must-not-return" }], nextCursor: 0 }),
    database: json({ component: "database", status: "unavailable" }, 503),
  });
  assert.equal(result.jobs.kind, "unknown");
  assert.equal(result.outbox.kind, "denied");
  assert.equal(result.auditFailures.kind, "unknown");
  assert.equal(result.privileged.kind, "unknown");
  assert.deepEqual(result.database, { kind: "ready",
    data: { component: "database", status: "unavailable" } });
});

test("#414 rejects outbox unsafe provider codes and source data beyond contract", async () => {
  const source = fixtures();
  const result = await projectOperationsOverviewSources({
    ...source,
    outbox: json({ coverage: "environment", environment: "test",
      observedAt: "2026-10-14T00:00:00.000Z",
      counts: { retryWait: 1, deadLetter: 0 },
      watch: { duePending: 0, dueRetryWait: 0, processing: 0,
        oldestProcessingUpdatedAt: null },
      sampleLimit: 8,
      items: [{ outboxId: "x", status: "retry_wait", attemptCount: 1,
        updatedAt: "2026-10-14T00:00:00.000Z",
        failureCode: "raw-access-token" }],
      attentionItems: [] }),
  });
  assert.equal(result.outbox.kind, "unknown");
});

const noSessionDb = {
  prepare() {
    return { bind() {
      return { first: async () => null, all: async () => ({ results: [] }) };
    } };
  },
} as unknown as D1Database;
const env = { DB: noSessionDb, RUNTIME_ENVIRONMENT: "test" };
const opts = { masterViewer: { scopeId: "workhub-company", masterKeys: ["workhub.office"] } };

test("#414 routing is GET-only, fixed-scope and authorization gated", async () => {
  const base = "https://example.test/api/admin/operations/overview";
  assert.equal(await handleWorkhubOperationsOverviewApi(
    new Request("https://example.test/api/admin/other"), env, "req-0", opts), null);
  const post = await handleWorkhubOperationsOverviewApi(
    new Request(base + "?scopeId=workhub-company", { method: "POST" }), env, "req-1", opts);
  assert.equal(post?.status, 405);
  for (const q of ["", "?scopeId=workhub-company&role=system_admin",
    "?scopeId=workhub-company&scopeId=workhub-company"]) {
    const response = await handleWorkhubOperationsOverviewApi(
      new Request(base + q), env, "req-2", opts);
    assert.equal(response?.status, 400);
  }
  const otherScope = await handleWorkhubOperationsOverviewApi(
    new Request(base + "?scopeId=another-tenant"), env, "req-3", opts);
  assert.equal(otherScope?.status, 403);
  const anonymous = await handleWorkhubOperationsOverviewApi(
    new Request(base + "?scopeId=workhub-company"), env, "req-4", opts);
  assert.equal(anonymous?.status, 401);
});
