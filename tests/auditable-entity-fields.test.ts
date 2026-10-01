import assert from "node:assert/strict";
import test from "node:test";

import {
  createExampleResource,
  loadExampleResource,
} from "../src/infrastructure/d1-example-resource-store";

interface RecordedStatement {
  sql: string;
  values: unknown[];
}

test("create stores the same actor as created_by and updated_by", async () => {
  const statements: RecordedStatement[] = [];
  const createdAt = "2026-10-02T00:00:00.000Z";

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return {
            async run() {
              return { meta: { changes: 1 } };
            },
            async first<T>() {
              return {
                id: "resource-1",
                name: "Example",
                status: "draft",
                version: 1,
                createdAt,
                createdBy: "user-1",
                updatedAt: createdAt,
                updatedBy: "user-1",
              } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const created = await createExampleResource(db, {
    id: "resource-1",
    name: "Example",
    actorId: " user-1 ",
    createdAt,
  });

  assert.equal(created.createdBy, "user-1");
  assert.equal(created.updatedBy, "user-1");
  assert.match(statements[0].sql, /created_by/);
  assert.match(statements[0].sql, /updated_by/);
  assert.deepEqual(statements[0].values, [
    "resource-1",
    "Example",
    createdAt,
    "user-1",
    createdAt,
    "user-1",
  ]);
});

test("legacy rows may expose unknown actor metadata as null", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first<T>() {
              return {
                id: "legacy-1",
                name: "Legacy",
                status: "draft",
                version: 1,
                createdAt: "2026-09-01T00:00:00.000Z",
                createdBy: null,
                updatedAt: "2026-09-01T00:00:00.000Z",
                updatedBy: null,
              } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const legacy = await loadExampleResource(db, "legacy-1");
  assert.equal(legacy?.createdBy, null);
  assert.equal(legacy?.updatedBy, null);
});

test("create rejects an unknown actor instead of writing ambiguous metadata", async () => {
  let prepared = false;
  const db = {
    prepare() {
      prepared = true;
      throw new Error("must not prepare SQL");
    },
  } as unknown as D1Database;

  await assert.rejects(
    createExampleResource(db, {
      id: "resource-1",
      name: "Example",
      actorId: "",
      createdAt: "2026-10-02T00:00:00.000Z",
    }),
    /actorId must be between 1 and 128 characters/,
  );
  assert.equal(prepared, false);
});
