import assert from "node:assert/strict";
import test from "node:test";

import { createFixedClock } from "../src/shared/runtime";
import {
  D1DurableAuditStore,
  DurableAuditIntegrityError,
  DurableAuditWriteError,
  sha256Text,
  verifyDurableAuditRecord,
  writeDurableAudit,
  type AuditEvent,
  type DurableAuditSink,
} from "../src/worker/audit";

interface CapturedCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface FakeAuditRow {
  readonly id: string;
  readonly environment: "local" | "test" | "preview" | "production";
  readonly occurred_at: string;
  readonly record_json: string;
  readonly record_sha256: string;
}

class FakeD1 {
  readonly calls: CapturedCall[] = [];
  rows: FakeAuditRow[] = [];
  changes = 0;

  readonly db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        this.calls.push({ sql, values });
        return {
          run: async () => ({ meta: { changes: this.changes } }),
          all: async () => ({ results: this.rows }),
        };
      },
    }),
  } as unknown as D1Database;
}

const event: AuditEvent = {
  requestId: "request-123",
  method: "PATCH",
  path: "/api/scopes/scope-1/resources/resource-1",
  category: "mutation",
  action: "example_resource_update",
  outcome: "success",
  actorId: "user-1",
  scopeId: "scope-1",
  resourceType: "example_resource",
  resourceId: "resource-1",
  reason: "status_transition",
};

const createStore = (fake: FakeD1, environment: "preview" | "production" = "preview") =>
  new D1DurableAuditStore({
    db: fake.db,
    environment,
    clock: createFixedClock("2026-10-03T00:00:00.000Z"),
    idGenerator: { generate: () => "audit-1" },
  });

test("append persists an allowlisted record with environment and SHA-256 integrity evidence", async () => {
  const fake = new FakeD1();
  const store = createStore(fake);
  const eventWithExtra = { ...event, token: "must-not-be-persisted" } as AuditEvent;

  await store.append(eventWithExtra);

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.match(call.sql, /INSERT INTO durable_audit_events/);
  assert.equal(call.values[0], "audit-1");
  assert.equal(call.values[1], "preview");
  assert.equal(call.values[2], "2026-10-03T00:00:00.000Z");
  assert.equal(call.values[3], "request-123");
  assert.equal(call.values[4], "mutation");
  assert.equal(call.values[5], "example_resource_update");
  assert.equal(call.values[6], "success");

  const recordJson = String(call.values[11]);
  const recordSha256 = String(call.values[12]);
  assert.equal(recordJson.includes("must-not-be-persisted"), false);
  assert.equal(recordJson.includes("token"), false);
  assert.equal(await sha256Text(recordJson), recordSha256);

  const record = await verifyDurableAuditRecord(recordJson, recordSha256);
  assert.equal(record.actorId, "user-1");
  assert.equal(record.scopeId, "scope-1");
});

test("search always scopes by environment and binds allowlisted filters", async () => {
  const fake = new FakeD1();
  const store = createStore(fake, "production");

  await store.search({
    startAt: "2026-10-01T00:00:00.000Z",
    endAt: "2026-10-03T00:00:00.000Z",
    category: "authorization",
    outcome: "failure",
    action: "membership_update",
    actorId: "user-7",
    scopeId: "scope-2",
    resourceType: "scope_membership",
    resourceId: "membership-9",
    cursor: {
      occurredAt: "2026-10-02T12:00:00.000Z",
      id: "audit-cursor",
    },
    limit: 25,
  });

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.match(call.sql, /WHERE environment = \?/);
  assert.match(call.sql, /ORDER BY occurred_at DESC, id DESC/);
  assert.equal(call.sql.includes("user-7"), false);
  assert.equal(call.sql.includes("membership_update"), false);
  assert.deepEqual(call.values, [
    "production",
    "2026-10-01T00:00:00.000Z",
    "2026-10-03T00:00:00.000Z",
    "authorization",
    "failure",
    "membership_update",
    "user-7",
    "scope-2",
    "scope_membership",
    "membership-9",
    "2026-10-02T12:00:00.000Z",
    "2026-10-02T12:00:00.000Z",
    "audit-cursor",
    25,
  ]);
});

test("search rejects unsafe limits, timestamps, and control characters", async () => {
  const fake = new FakeD1();
  const store = createStore(fake);

  await assert.rejects(() => store.search({ limit: 101 }), /limit must be between 1 and 100/);
  await assert.rejects(() => store.search({ startAt: "yesterday" }), /ISO-8601/);
  await assert.rejects(() => store.search({ actorId: "user\n1" }), /bounded non-control/);
  assert.equal(fake.calls.length, 0);
});

test("search fails closed when a row belongs to another environment", async () => {
  const fake = new FakeD1();
  const store = createStore(fake, "preview");
  const recordJson = JSON.stringify({
    kind: "audit",
    timestamp: "2026-10-03T00:00:00.000Z",
    requestId: "request-1",
    method: "POST",
    path: "/api/example",
    category: "mutation",
    action: "write",
    outcome: "success",
  });
  fake.rows = [{
    id: "audit-x",
    environment: "production",
    occurred_at: "2026-10-03T00:00:00.000Z",
    record_json: recordJson,
    record_sha256: await sha256Text(recordJson),
  }];

  await assert.rejects(() => store.search(), DurableAuditIntegrityError);
});

test("record hash mismatch is detected before returning audit content", async () => {
  const recordJson = JSON.stringify({
    kind: "audit",
    timestamp: "2026-10-03T00:00:00.000Z",
    requestId: "request-1",
    method: "POST",
    path: "/api/example",
    category: "mutation",
    action: "write",
    outcome: "success",
  });

  await assert.rejects(
    () => verifyDurableAuditRecord(recordJson, "0".repeat(64)),
    DurableAuditIntegrityError,
  );
});

test("retention purge is environment-scoped, bounded, and uses the injected clock", async () => {
  const fake = new FakeD1();
  fake.changes = 17;
  const store = createStore(fake, "preview");

  const deleted = await store.purgeExpired({ retentionDays: 30, purgeBatchSize: 100 });

  assert.equal(deleted, 17);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].sql, /DELETE FROM durable_audit_events/);
  assert.deepEqual(fake.calls[0].values, [
    "preview",
    "2026-09-03T00:00:00.000Z",
    100,
  ]);

  await assert.rejects(
    () => store.purgeExpired({ retentionDays: 0 }),
    /retentionDays must be a positive safe integer/,
  );
});

test("best-effort and required durable write modes are explicit", async () => {
  const failingSink: DurableAuditSink = {
    append: async () => {
      throw new Error("storage unavailable");
    },
  };
  const failures: string[] = [];

  const bestEffort = await writeDurableAudit(failingSink, event, {
    environment: "preview",
    mode: "best_effort",
    onFailure: (context) => failures.push(`${context.environment}:${context.action}`),
  });
  assert.equal(bestEffort, false);
  assert.deepEqual(failures, ["preview:example_resource_update"]);

  await assert.rejects(
    () => writeDurableAudit(failingSink, event, {
      environment: "preview",
      mode: "required",
    }),
    DurableAuditWriteError,
  );
});
