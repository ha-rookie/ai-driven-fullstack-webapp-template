import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  D1MasterDataStore, type MasterItemRecord, type MasterRevisionRecord,
} from "../src/worker/master-data";
import {
  prepareDurableAuditRecord, verifyDurableAuditRecord,
} from "../src/worker/audit";

const createdAt = "2026-10-09T00:00:00.000Z";
const cutoff = "2027-04-01T00:00:00.000Z";
const itemId = "workhub-office-atomic-fixture";

const createDatabase = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE master_items (
      id TEXT PRIMARY KEY, environment TEXT NOT NULL, master_key TEXT NOT NULL,
      code TEXT NOT NULL, version INTEGER NOT NULL, next_revision INTEGER NOT NULL,
      last_mutation_id TEXT NOT NULL, retired_at TEXT, created_at TEXT NOT NULL,
      created_by TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
    );
    CREATE TABLE master_revisions (
      id TEXT PRIMARY KEY, environment TEXT NOT NULL, master_item_id TEXT NOT NULL,
      revision INTEGER NOT NULL, label TEXT NOT NULL, enabled INTEGER NOT NULL,
      effective_from TEXT NOT NULL, effective_to TEXT, display_order INTEGER NOT NULL,
      parent_item_id TEXT, attributes_json TEXT NOT NULL,
      created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE (master_item_id, revision),
      CHECK (effective_to IS NULL OR effective_from < effective_to)
    );
    CREATE TABLE durable_audit_events (
      id TEXT PRIMARY KEY, environment TEXT NOT NULL, occurred_at TEXT NOT NULL,
      request_id TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
      outcome TEXT NOT NULL, actor_id TEXT, scope_id TEXT,
      resource_type TEXT, resource_id TEXT,
      record_json TEXT NOT NULL, record_sha256 TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  sqlite.prepare(`
    INSERT INTO master_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, "test", "workhub.office", "CUTOVER", 2, 2, "seed-r1",
    null, createdAt, "fixture", createdAt, "fixture");
  sqlite.prepare(`
    INSERT INTO master_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("cutover-r1", "test", itemId, 1, "Before", 1,
    "2026-01-01T00:00:00.000Z", null, 10, null, "{}", createdAt, "fixture");

  const statement = (sql: string, params: unknown[]) => {
    const bound = params as (string | number | null)[];
    const prepared = sqlite.prepare(sql);
    return prepared.run(...bound);
  };
  type Bound = { execute(): { changes: number | bigint } };
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() { const result = statement(sql, params); return { meta: { changes: Number(result.changes) } }; },
            async first<T>() { return (sqlite.prepare(sql).get(...params as (string | number | null)[]) ?? null) as T | null; },
            execute: () => statement(sql, params),
          };
        },
      };
    },
    async batch(commands: Bound[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = commands.map((command) => ({
          meta: { changes: Number(command.execute().changes) },
        }));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  return { sqlite, store: new D1MasterDataStore(d1) };
};

const audit = (action: string) => prepareDurableAuditRecord({
  requestId: "req-test-atomic-1", method: "POST", path: "/api/admin/master-operations",
  category: "system", action, outcome: "success",
  actorId: "kai", scopeId: "workhub-company",
  resourceType: "master_item", resourceId: itemId, reason: "reason_sha256:test",
}, "test", {
  clock: { now: () => new Date(createdAt) },
  idGenerator: { generate: () => "audit-atomic-test-1" },
});

const item = (version: number, nextRevision: number, retiredAt: string | null = null): MasterItemRecord => ({
  id: itemId, environment: "test", masterKey: "workhub.office", code: "CUTOVER",
  version, nextRevision, retiredAt, createdAt, createdBy: "fixture",
  updatedAt: createdAt, updatedBy: "kai",
});
const revision: MasterRevisionRecord = {
  id: "cutover-r2", environment: "test", masterItemId: itemId, revision: 2,
  label: "After", enabled: true, effectiveFrom: cutoff, effectiveTo: null,
  displayOrder: 10, parentItemId: null, attributes: {},
  createdAt, createdBy: "kai",
};

test("D1 batch commits future revision and hashed durable audit as one transaction", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  const proof = await audit("operation.SCHEDULE_MASTER_REVISION");
  assert.equal(await store.scheduleRevision({
    item: item(3, 3), revision, mutationId: "mutation-atomic-1",
    priorRevisionId: "cutover-r1", expectedItemVersion: 2, durableAudit: proof,
  }), true);
  const actual = sqlite.prepare("SELECT version, next_revision FROM master_items WHERE id = ?").get(itemId) as Record<string, number>;
  assert.equal(actual.version, 3);
  assert.equal(actual.next_revision, 3);
  assert.equal((sqlite.prepare("SELECT effective_to FROM master_revisions WHERE id = 'cutover-r1'").get() as { effective_to: string }).effective_to, cutoff);
  assert.equal((sqlite.prepare("SELECT effective_from FROM master_revisions WHERE id = 'cutover-r2'").get() as { effective_from: string }).effective_from, cutoff);
  const stored = sqlite.prepare("SELECT record_json, record_sha256 FROM durable_audit_events").get() as {
    record_json: string; record_sha256: string;
  };
  const validated = await verifyDurableAuditRecord(stored.record_json, stored.record_sha256);
  assert.equal(validated.action, "operation.SCHEDULE_MASTER_REVISION");
  assert.equal(validated.resourceId, itemId);
});

test("audit table failure rolls back item version and BOTH effective periods", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  const proof = await audit("operation.SCHEDULE_MASTER_REVISION");
  sqlite.exec("DROP TABLE durable_audit_events");
  await assert.rejects(() => store.scheduleRevision({
    item: item(3, 3), revision, mutationId: "mutation-audit-fail",
    priorRevisionId: "cutover-r1", expectedItemVersion: 2, durableAudit: proof,
  }));
  assert.equal((sqlite.prepare("SELECT version FROM master_items").get() as { version: number }).version, 2);
  assert.equal((sqlite.prepare("SELECT effective_to FROM master_revisions WHERE id = 'cutover-r1'").get() as { effective_to: string | null }).effective_to, null);
  assert.equal(sqlite.prepare("SELECT id FROM master_revisions WHERE id = 'cutover-r2'").get(), undefined);
});

test("intermediate close failure rolls back preceding Item update and leaves no audit", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  const proof = await audit("operation.SCHEDULE_MASTER_REVISION");
  sqlite.exec(`CREATE TRIGGER reject_cutover BEFORE UPDATE OF effective_to ON master_revisions
     BEGIN SELECT RAISE(ABORT, 'injected cutover failure'); END;`);
  await assert.rejects(() => store.scheduleRevision({
    item: item(3, 3), revision, mutationId: "mutation-close-fail",
    priorRevisionId: "cutover-r1", expectedItemVersion: 2, durableAudit: proof,
  }));
  assert.equal((sqlite.prepare("SELECT version FROM master_items").get() as { version: number }).version, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM durable_audit_events").get() as { n: number }).n, 0);
});

test("stale version never creates revision or durable audit", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  const proof = await audit("operation.SCHEDULE_MASTER_REVISION");
  assert.equal(await store.scheduleRevision({
    item: item(3, 3), revision, mutationId: "mutation-stale",
    priorRevisionId: "cutover-r1", expectedItemVersion: 1, durableAudit: proof,
  }), false);
  assert.equal((sqlite.prepare("SELECT version FROM master_items").get() as { version: number }).version, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM durable_audit_events").get() as { n: number }).n, 0);
});

test("retirement also commits audit atomically and fails closed when audit cannot persist", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  const proof = await audit("operation.RETIRE_MASTER_ITEM");
  assert.equal(await store.retireItem({
    item: item(3, 2, createdAt), expectedItemVersion: 2,
    mutationId: "retire-marker", durableAudit: proof,
  }), true);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM durable_audit_events").get() as { n: number }).n, 1);
  const failure = createDatabase();
  t.after(() => failure.sqlite.close());
  failure.sqlite.exec("DROP TABLE durable_audit_events");
  await assert.rejects(() => failure.store.retireItem({
    item: item(3, 2, createdAt), expectedItemVersion: 2,
    mutationId: "retire-fail", durableAudit: proof,
  }));
  assert.equal((failure.sqlite.prepare("SELECT version FROM master_items").get() as { version: number }).version, 2);
});

test("unexpected later batch result cannot silently accept a partial state", async (t) => {
  const { sqlite, store } = createDatabase();
  t.after(() => sqlite.close());
  assert.equal(await store.scheduleRevision({
    item: item(3, 3), revision, mutationId: "wrong-prior", priorRevisionId: "not-r1",
    expectedItemVersion: 2,
  }), false);
  assert.equal((sqlite.prepare("SELECT version FROM master_items").get() as { version: number }).version, 2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM master_revisions").get() as { n: number }).n, 1);
});
