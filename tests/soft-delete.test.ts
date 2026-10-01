import assert from "node:assert/strict";
import test from "node:test";

import type { ExampleResource } from "../src/domain/example-resource";
import {
  loadExampleResource,
  restoreExampleResource,
  softDeleteExampleResource,
} from "../src/infrastructure/d1-example-resource-store";

const resource = (overrides: Partial<ExampleResource> = {}): ExampleResource => ({
  id: "resource-1",
  name: "Example",
  status: "draft",
  version: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  createdBy: "creator-1",
  updatedAt: "2026-10-02T00:00:00.000Z",
  updatedBy: "creator-1",
  deletedAt: null,
  deletedBy: null,
  ...overrides,
});

const fakeDb = (initial: ExampleResource | null) => {
  let current = initial;
  const statements: Array<{ sql: string; values: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return {
            async first<T>() {
              if (!current) return null;
              if (/deleted_at IS NULL/.test(sql) && current.deletedAt !== null) return null;
              return {
                id: current.id,
                name: current.name,
                status: current.status,
                version: current.version,
                createdAt: current.createdAt,
                createdBy: current.createdBy,
                updatedAt: current.updatedAt,
                updatedBy: current.updatedBy,
                deletedAt: current.deletedAt,
                deletedBy: current.deletedBy,
              } as T;
            },
            async run() {
              if (!current) return { meta: { changes: 0 } };
              const expectedVersion = Number(values.at(-1));
              if (current.version !== expectedVersion) return { meta: { changes: 0 } };

              if (/SET deleted_at = \?/.test(sql)) {
                if (current.deletedAt !== null) return { meta: { changes: 0 } };
                current = {
                  ...current,
                  deletedAt: String(values[0]),
                  deletedBy: String(values[1]),
                  updatedAt: String(values[2]),
                  updatedBy: String(values[3]),
                  version: current.version + 1,
                };
                return { meta: { changes: 1 } };
              }

              if (/SET deleted_at = NULL/.test(sql)) {
                if (current.deletedAt === null) return { meta: { changes: 0 } };
                current = {
                  ...current,
                  deletedAt: null,
                  deletedBy: null,
                  updatedAt: String(values[0]),
                  updatedBy: String(values[1]),
                  version: current.version + 1,
                };
                return { meta: { changes: 1 } };
              }

              throw new Error("unexpected run() call");
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, statements, current: () => current };
};

test("default load excludes soft-deleted resources while includeDeleted returns them", async () => {
  const deleted = resource({
    version: 2,
    deletedAt: "2026-10-02T00:01:00.000Z",
    deletedBy: "user-1",
  });
  const { db } = fakeDb(deleted);

  assert.equal(await loadExampleResource(db, deleted.id), null);
  assert.deepEqual(
    await loadExampleResource(db, deleted.id, { includeDeleted: true }),
    deleted,
  );
});

test("soft delete records actor, timestamp, and increments version", async () => {
  const { db, statements } = fakeDb(resource());

  const result = await softDeleteExampleResource(db, {
    id: "resource-1",
    expectedVersion: 1,
    changedAt: "2026-10-02T00:01:00.000Z",
    actorId: "user-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.resource.version, 2);
  assert.equal(result.resource.deletedBy, "user-1");
  assert.equal(result.resource.deletedAt, "2026-10-02T00:01:00.000Z");
  assert.equal(result.resource.updatedBy, "user-1");
  assert.match(statements[0].sql, /deleted_at IS NULL/);
});

test("restore clears delete metadata and increments version", async () => {
  const { db } = fakeDb(
    resource({
      version: 2,
      deletedAt: "2026-10-02T00:01:00.000Z",
      deletedBy: "user-1",
    }),
  );

  const result = await restoreExampleResource(db, {
    id: "resource-1",
    expectedVersion: 2,
    changedAt: "2026-10-02T00:02:00.000Z",
    actorId: "user-2",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.resource.version, 3);
  assert.equal(result.resource.deletedAt, null);
  assert.equal(result.resource.deletedBy, null);
  assert.equal(result.resource.updatedBy, "user-2");
});

test("stale soft delete and repeated restore fail closed", async () => {
  const active = resource({ version: 2 });
  const activeDb = fakeDb(active).db;
  const staleDelete = await softDeleteExampleResource(activeDb, {
    id: active.id,
    expectedVersion: 1,
    changedAt: "2026-10-02T00:03:00.000Z",
    actorId: "user-1",
  });
  assert.deepEqual(staleDelete, { ok: false, reason: "stale", current: active });

  const restoreDb = fakeDb(active).db;
  const repeatedRestore = await restoreExampleResource(restoreDb, {
    id: active.id,
    expectedVersion: 2,
    changedAt: "2026-10-02T00:04:00.000Z",
    actorId: "user-1",
  });
  assert.deepEqual(repeatedRestore, {
    ok: false,
    reason: "state_changed",
    current: active,
  });
});
