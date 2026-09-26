import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionExampleResource,
  isTerminalExampleResourceStatus,
  type ExampleResource,
} from "../src/domain/example-resource";
import {
  renameExampleResource,
  transitionExampleResourceStatus,
} from "../src/infrastructure/d1-example-resource-store";

interface FakeStatement {
  sql: string;
  values: unknown[];
  first<T>(): Promise<T | null>;
}

const resource = (overrides: Partial<ExampleResource> = {}): ExampleResource => ({
  id: "resource-1",
  name: "Example",
  status: "draft",
  version: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  ...overrides,
});

const fakeDb = (options: {
  batchChanges: [number, number];
  current: ExampleResource | null;
  currentAfterBatch?: ExampleResource | null;
}) => {
  const batches: FakeStatement[][] = [];
  let current = options.current;

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement: FakeStatement = {
            sql,
            values,
            async first<T>() {
              if (!/SELECT id, name, status, version/.test(sql)) {
                throw new Error("unexpected first() call");
              }
              if (!current) return null;
              return {
                id: current.id,
                name: current.name,
                status: current.status,
                version: current.version,
                createdAt: current.createdAt,
                updatedAt: current.updatedAt,
              } as T;
            },
          };
          return statement;
        },
      };
    },
    async batch(statements: FakeStatement[]) {
      batches.push(statements);
      if (Object.prototype.hasOwnProperty.call(options, "currentAfterBatch")) {
        current = options.currentAfterBatch ?? null;
      }
      return options.batchChanges.map((changes) => ({
        meta: { changes },
      })) as unknown as D1Result<unknown>[];
    },
  } as unknown as D1Database;

  return { db, batches };
};

test("example resource transitions are explicit and finalized is terminal", () => {
  assert.equal(canTransitionExampleResource("draft", "active"), true);
  assert.equal(canTransitionExampleResource("active", "finalized"), true);
  assert.equal(canTransitionExampleResource("draft", "finalized"), false);
  assert.equal(canTransitionExampleResource("active", "draft"), false);
  assert.equal(canTransitionExampleResource("finalized", "active"), false);
  assert.equal(isTerminalExampleResourceStatus("finalized"), true);
  assert.equal(isTerminalExampleResourceStatus("active"), false);
});

test("rename uses one D1 batch for the optimistic update and change record", async () => {
  const updated = resource({
    name: "Renamed",
    version: 2,
    updatedAt: "2026-09-27T00:01:00.000Z",
  });
  const { db, batches } = fakeDb({
    batchChanges: [1, 1],
    current: resource(),
    currentAfterBatch: updated,
  });

  const result = await renameExampleResource(db, {
    id: "resource-1",
    name: "Renamed",
    expectedVersion: 1,
    changedAt: "2026-09-27T00:01:00.000Z",
  });

  assert.deepEqual(result, { ok: true, resource: updated });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 2);
  assert.match(batches[0][0].sql, /version = version \+ 1/);
  assert.match(batches[0][0].sql, /version = \?/);
  assert.match(batches[0][0].sql, /status <> 'finalized'/);
  assert.match(batches[0][1].sql, /INSERT INTO example_resource_changes/);
  assert.deepEqual(batches[0][0].values, [
    "Renamed",
    "2026-09-27T00:01:00.000Z",
    "resource-1",
    1,
  ]);
});

test("stale rename does not report success", async () => {
  const current = resource({ version: 2, name: "Already changed" });
  const { db } = fakeDb({ batchChanges: [0, 0], current });

  const result = await renameExampleResource(db, {
    id: "resource-1",
    name: "Late change",
    expectedVersion: 1,
    changedAt: "2026-09-27T00:02:00.000Z",
  });

  assert.deepEqual(result, { ok: false, reason: "stale", current });
});

test("finalized resource is immutable", async () => {
  const current = resource({ status: "finalized", version: 3 });
  const { db } = fakeDb({ batchChanges: [0, 0], current });

  const result = await renameExampleResource(db, {
    id: "resource-1",
    name: "Should not change",
    expectedVersion: 3,
    changedAt: "2026-09-27T00:03:00.000Z",
  });

  assert.deepEqual(result, { ok: false, reason: "immutable", current });
});

test("valid status transition is versioned and recorded in one batch", async () => {
  const updated = resource({
    status: "active",
    version: 2,
    updatedAt: "2026-09-27T00:04:00.000Z",
  });
  const { db, batches } = fakeDb({
    batchChanges: [1, 1],
    current: resource(),
    currentAfterBatch: updated,
  });

  const result = await transitionExampleResourceStatus(db, {
    id: "resource-1",
    fromStatus: "draft",
    toStatus: "active",
    expectedVersion: 1,
    changedAt: "2026-09-27T00:04:00.000Z",
  });

  assert.deepEqual(result, { ok: true, resource: updated });
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].sql, /status = \?/);
  assert.match(batches[0][0].sql, /version = \?/);
  assert.match(batches[0][1].sql, /'status_transition'/);
});

test("invalid status transition is rejected before touching D1", async () => {
  const { db, batches } = fakeDb({ batchChanges: [1, 1], current: resource() });

  const result = await transitionExampleResourceStatus(db, {
    id: "resource-1",
    fromStatus: "draft",
    toStatus: "finalized",
    expectedVersion: 1,
    changedAt: "2026-09-27T00:05:00.000Z",
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "invalid_transition",
    current: null,
  });
  assert.equal(batches.length, 0);
});

test("state changed with the same version is rejected", async () => {
  const current = resource({ status: "active", version: 1 });
  const { db } = fakeDb({ batchChanges: [0, 0], current });

  const result = await transitionExampleResourceStatus(db, {
    id: "resource-1",
    fromStatus: "draft",
    toStatus: "active",
    expectedVersion: 1,
    changedAt: "2026-09-27T00:06:00.000Z",
  });

  assert.deepEqual(result, { ok: false, reason: "state_changed", current });
});

test("a batch result mismatch is treated as an integrity failure", async () => {
  const { db } = fakeDb({
    batchChanges: [1, 0],
    current: resource(),
    currentAfterBatch: resource({ version: 2, name: "Renamed" }),
  });

  await assert.rejects(
    renameExampleResource(db, {
      id: "resource-1",
      name: "Renamed",
      expectedVersion: 1,
      changedAt: "2026-09-27T00:07:00.000Z",
    }),
    /runtime_integrity_batch_mismatch/,
  );
});
