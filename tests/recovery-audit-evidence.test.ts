import assert from "node:assert/strict";
import test from "node:test";
import { readRecoveryAuditEvidence } from "../src/worker/administration/recovery-audit-evidence";
import { sha256Text, toStructuredAuditRecord } from "../src/worker/audit";

const NOW = "2026-10-18T06:00:00.000Z";
const observed = "2026-10-18T05:58:00.000Z";

const row = async (options: {
  readonly scopeId?: string;
  readonly resourceType?: string;
  readonly environment?: "preview" | "production";
  readonly timestamp?: string;
  readonly badHash?: boolean;
} = {}) => {
  const record = toStructuredAuditRecord({
    requestId: "recovery-req-123", method: "POST", path: "/internal/recovery",
    category: "system", action: "recovery.operator_review", outcome: "failure",
    scopeId: options.scopeId ?? "workhub-company",
    resourceType: options.resourceType ?? "recovery", resourceId: "opaque-event-reference",
    actorId: "operator-1",
  }, options.timestamp ?? observed);
  const recordJson = JSON.stringify(record);
  return {
    id: "opaque-audit-entry", environment: options.environment ?? "production",
    occurred_at: record.timestamp, record_json: recordJson,
    record_sha256: options.badHash ? "0".repeat(64) : await sha256Text(recordJson),
  };
};
type Row = Awaited<ReturnType<typeof row>>;
const fakeDb = (rows: Row[]) => {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          calls.push({ sql, values });
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
};

test("#431 real existing D1 audit read uses environment and business scope parameters", async () => {
  const fake = fakeDb([await row()]);
  const evidence = await readRecoveryAuditEvidence(fake.db, "production", NOW);
  assert.deepEqual(evidence, {
    source: "durable-d1-audit", status: "RECORDED",
    recordsChecked: 1, latestAuditAt: observed, hasMore: false,
    provesRecoverability: false,
  });
  assert.equal(fake.calls.length, 1);
  const sql = fake.calls[0]!.sql;
  assert.match(sql, /FROM durable_audit_events/u);
  assert.match(sql, /environment = \?/u);
  assert.match(sql, /scope_id = \?/u);
  assert.match(sql, /resource_type = \?/u);
  assert.match(sql, /ORDER BY occurred_at DESC, id DESC/u);
  assert.equal(sql.includes("workhub-company"), false, "scope must be SQL-bound");
  assert.deepEqual(fake.calls[0]!.values, ["production", "workhub-company", "recovery", 20]);
  assert.doesNotMatch(JSON.stringify(evidence), /actorId|resourceId|requestId|opaque-event-reference/u);
});

test("#431 empty actual D1 audit read is NONE, not success or recovery verified", async () => {
  const { db } = fakeDb([]);
  const evidence = await readRecoveryAuditEvidence(db, "test", NOW);
  assert.equal(evidence.status, "NONE");
  assert.equal(evidence.recordsChecked, 0);
  assert.equal(evidence.latestAuditAt, null);
  assert.equal(evidence.provesRecoverability, false);
});

test("#430 D1 query failure, bad digest, and environment/scope mismatch never become 0 healthy records", async () => {
  const unsafeRows = [
    [await row({ badHash: true })],
    [await row({ environment: "preview" })],
    [await row({ scopeId: "other-company" })],
    [await row({ resourceType: "not-recovery" })],
    [await row({ timestamp: "2099-01-01T00:00:00.000Z" })],
    [await row({ timestamp: "not-a-time" })],
  ];
  for (const rows of unsafeRows) {
    const evidence = await readRecoveryAuditEvidence(fakeDb(rows).db, "production", NOW);
    assert.equal(evidence.status, "UNAVAILABLE");
    assert.equal(evidence.recordsChecked, null);
    assert.equal(evidence.latestAuditAt, null);
    assert.equal(evidence.hasMore, null);
    assert.equal(evidence.provesRecoverability, false);
  }
  const broken = { prepare() { throw new Error("credentials-must-not-leak"); } } as unknown as D1Database;
  const result = await readRecoveryAuditEvidence(broken, "production", NOW);
  assert.equal(result.status, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /credentials-must-not-leak/u);
});

test("#430 read is never evidence of backup success or approval to execute restore", async () => {
  const r = fakeDb([await row()]);
  const e = await readRecoveryAuditEvidence(r.db, "production", NOW);
  assert.equal(e.status, "RECORDED");
  assert.equal(e.provesRecoverability, false);
  const recordJson = JSON.stringify(e);
  assert.doesNotMatch(recordJson, /\bREADY\b|\bALLOW\b|\bVERIFIED\b|authorization|secret/iu);
});
