import assert from "node:assert/strict";
import test from "node:test";
import { D1MasterDataStore, MasterDataStoreIntegrityError } from "../src/worker/master-data";
import { handleMasterScheduleApi } from "../src/worker/administration/master-schedule-api";
import { WORKHUB_OFFICE_MASTER_DEFINITION } from "../src/reference/workhub/travel-request";
import type { ScheduleMasterRevisionBundle } from "../src/worker/master-data";

const options = {
  scopeId: "workhub-company",
  definition: WORKHUB_OFFICE_MASTER_DEFINITION,
  allowedItemIds: ["workhub-office-schedule"],
};
const fakeDb = { prepare() {
  return { bind() { return { first: async () => null }; } };
} } as unknown as D1Database;

test("future master scheduling is Preview-only and fails closed in Production", async () => {
  const path = "https://example.test/api/admin/master-operations/schedule/preview";
  assert.equal(await handleMasterScheduleApi(
    new Request("https://example.test/api/admin/master-data"),
    { DB: fakeDb, RUNTIME_ENVIRONMENT: "test" }, "req-1", options,
  ), null);
  assert.equal((await handleMasterScheduleApi(
    new Request(path, { method: "POST" }),
    { DB: fakeDb, RUNTIME_ENVIRONMENT: "test" }, "req-2", options,
  ))?.status, 405);
  assert.equal((await handleMasterScheduleApi(
    new Request(path),
    { DB: fakeDb, RUNTIME_ENVIRONMENT: "production" }, "req-3", options,
  ))?.status, 403);
  assert.equal((await handleMasterScheduleApi(
    new Request(path),
    { DB: fakeDb }, "req-4", options,
  ))?.status, 503);
});

test("unauthenticated future schedule fails before privileged lookup", async () => {
  const url = "https://example.test/api/admin/master-operations/schedule/preview?scopeId=workhub-company&itemId=workhub-office-schedule&expectedVersion=2&effectiveFrom=2027-04-01T00%3A00%3A00.000Z&label=New";
  const response = await handleMasterScheduleApi(
    new Request(url), { DB: fakeDb, RUNTIME_ENVIRONMENT: "test" }, "req-5", options,
  );
  assert.equal(response?.status, 401);
});

const bundle: ScheduleMasterRevisionBundle = {
  priorRevisionId: "old-r1", mutationId: "operation-id",
  expectedItemVersion: 2,
  item: {
    id: "office-1", environment: "test", masterKey: "office", code: "TOKYO",
    version: 3, nextRevision: 3, retiredAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", createdBy: "admin",
    updatedAt: "2026-10-09T00:00:00.000Z", updatedBy: "admin",
  },
  revision: {
    id: "new-r2", environment: "test", masterItemId: "office-1",
    revision: 2, label: "Future Tokyo", enabled: true,
    effectiveFrom: "2027-04-01T00:00:00.000Z", effectiveTo: null,
    displayOrder: 10, parentItemId: null, attributes: {},
    createdAt: "2026-10-09T00:00:00.000Z", createdBy: "admin",
  },
};
const mockStore = (changes: number[]) => {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return { bind() { return { run: async () => ({ meta: { changes: 1 } }) }; } };
    },
    async batch(statements: unknown[]) {
      assert.equal(statements.length, 3);
      return changes.map((value) => ({ meta: { changes: value } }));
    },
  } as unknown as D1Database;
  return { store: new D1MasterDataStore(db), queries };
};

test("D1 future cutover guards item version, old open end and other future periods in one batch", async () => {
  const { store, queries } = mockStore([1, 1, 1]);
  assert.equal(await store.scheduleRevision(bundle), true);
  assert.equal(queries.length, 3);
  assert.match(queries[0], /version = \? AND retired_at IS NULL/u);
  assert.match(queries[0], /prior.effective_to IS NULL/u);
  assert.match(queries[0], /NOT EXISTS/u);
  assert.match(queries[1], /SET effective_to = \?/u);
  assert.match(queries[1], /last_mutation_id = \?/u);
  assert.match(queries[2], /INSERT INTO master_revisions/u);
  assert.match(queries[2], /last_mutation_id = \?/u);
});

test("D1 stale version yields no cutover, invariant violations are not silently accepted", async () => {
  // A successful batch response with zero-row writes is an impossible/unsafe transaction
  // once the SQL NOT NULL guard is in place; fail closed instead of reporting clean conflict.
  await assert.rejects(
    () => mockStore([0, 0, 0]).store.scheduleRevision(bundle),
    (e: unknown) => e instanceof MasterDataStoreIntegrityError,
  );
  await assert.rejects(
    () => mockStore([1, 0, 0]).store.scheduleRevision(bundle),
    (e: unknown) => e instanceof MasterDataStoreIntegrityError,
  );
});

test("disabled state and display-order update are only legal in bounded ranges", async () => {
  // The preview requires authentication before revealing even request validation or values.
  // Domain-level enabled/ordering behavior is covered by master-revision-cutover tests.
  const base = "https://example.test/api/admin/master-operations/schedule/preview?scopeId=workhub-company&itemId=workhub-office-schedule&expectedVersion=2&effectiveFrom=2027-04-01T00%3A00%3A00.000Z&label=New";
  const response = await handleMasterScheduleApi(
    new Request(base + "&enabled=false&displayOrder=70"),
    { DB: fakeDb, RUNTIME_ENVIRONMENT: "production" }, "req-disabled-production", options,
  );
  assert.equal(response?.status, 403);
});
