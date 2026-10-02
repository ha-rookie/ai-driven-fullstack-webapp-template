import assert from "node:assert/strict";
import test from "node:test";

import {
  completeIdempotencyRecord,
  createIdempotencyRecord,
  failIdempotencyRecord,
  lookupIdempotencyRecord,
  type IdempotencyRecord,
} from "../src/infrastructure/d1-idempotency-store";

interface FakeStatement {
  sql: string;
  values: unknown[];
  run(): Promise<D1Result<unknown>>;
  first<T>(): Promise<T | null>;
}

const contextKey = (key: string, actorId: string, scopeId: string, action: string) =>
  [key, actorId, scopeId, action].join("\u0000");

const fakeDb = () => {
  const records = new Map<string, IdempotencyRecord>();
  const statements: FakeStatement[] = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement: FakeStatement = {
            sql,
            values,
            async run() {
              if (/INSERT OR IGNORE INTO idempotency_records/.test(sql)) {
                const [key, actorId, scopeId, action, fingerprint, createdAt, updatedAt, expiresAt] =
                  values as string[];
                const mapKey = contextKey(key, actorId, scopeId, action);
                if (records.has(mapKey)) {
                  return { meta: { changes: 0 } } as D1Result<unknown>;
                }
                records.set(mapKey, {
                  key,
                  actorId,
                  scopeId,
                  action,
                  fingerprint,
                  state: "in_progress",
                  createdAt,
                  updatedAt,
                  expiresAt,
                });
                return { meta: { changes: 1 } } as D1Result<unknown>;
              }

              if (/UPDATE idempotency_records/.test(sql)) {
                const [state, updatedAt, key, actorId, scopeId, action, fingerprint] =
                  values as string[];
                const mapKey = contextKey(key, actorId, scopeId, action);
                const current = records.get(mapKey);
                if (
                  !current ||
                  current.fingerprint !== fingerprint ||
                  current.state !== "in_progress"
                ) {
                  return { meta: { changes: 0 } } as D1Result<unknown>;
                }
                records.set(mapKey, {
                  ...current,
                  state: state as IdempotencyRecord["state"],
                  updatedAt,
                });
                return { meta: { changes: 1 } } as D1Result<unknown>;
              }

              throw new Error("unexpected run() call");
            },
            async first<T>() {
              if (!/FROM idempotency_records/.test(sql)) {
                throw new Error("unexpected first() call");
              }
              const [key, actorId, scopeId, action] = values as string[];
              const record = records.get(contextKey(key, actorId, scopeId, action));
              if (!record) return null;
              return {
                idempotencyKey: record.key,
                actorId: record.actorId,
                scopeId: record.scopeId,
                action: record.action,
                fingerprint: record.fingerprint,
                state: record.state,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                expiresAt: record.expiresAt,
              } as T;
            },
          };
          statements.push(statement);
          return statement;
        },
      };
    },
  } as unknown as D1Database;

  return { db, records, statements };
};

const baseInput = {
  key: "request-1",
  actorId: "user-1",
  scopeId: "scope-1",
  action: "example_resource:create",
  fingerprint: "sha256:abc",
  createdAt: "2026-10-02T00:00:00.000Z",
  expiresAt: "2026-10-03T00:00:00.000Z",
};

test("create stores one in-progress record with expiry metadata", async () => {
  const { db } = fakeDb();

  const result = await createIdempotencyRecord(db, baseInput);

  assert.equal(result.kind, "created");
  assert.equal(result.record.state, "in_progress");
  assert.equal(result.record.fingerprint, "sha256:abc");
  assert.equal(result.record.expiresAt, "2026-10-03T00:00:00.000Z");
  assert.equal(result.record.updatedAt, baseInput.createdAt);
});

test("same key and context cannot create a second record", async () => {
  const { db, records } = fakeDb();
  await createIdempotencyRecord(db, baseInput);

  const duplicate = await createIdempotencyRecord(db, {
    ...baseInput,
    fingerprint: "sha256:different",
  });

  assert.equal(duplicate.kind, "existing");
  assert.equal(duplicate.record.fingerprint, "sha256:abc");
  assert.equal(records.size, 1);
});

test("the same key may be isolated by actor, scope, or action context", async () => {
  const { db, records } = fakeDb();
  await createIdempotencyRecord(db, baseInput);
  await createIdempotencyRecord(db, { ...baseInput, actorId: "user-2" });
  await createIdempotencyRecord(db, { ...baseInput, scopeId: "scope-2" });
  await createIdempotencyRecord(db, { ...baseInput, action: "other:create" });

  assert.equal(records.size, 4);
});

test("complete transitions only an in-progress record with the same fingerprint", async () => {
  const { db } = fakeDb();
  await createIdempotencyRecord(db, baseInput);

  const completed = await completeIdempotencyRecord(db, {
    key: baseInput.key,
    actorId: baseInput.actorId,
    scopeId: baseInput.scopeId,
    action: baseInput.action,
    fingerprint: baseInput.fingerprint,
    changedAt: "2026-10-02T00:01:00.000Z",
  });

  assert.equal(completed.kind, "updated");
  if (completed.kind === "updated") {
    assert.equal(completed.record.state, "completed");
    assert.equal(completed.record.updatedAt, "2026-10-02T00:01:00.000Z");
  }

  const repeated = await completeIdempotencyRecord(db, {
    key: baseInput.key,
    actorId: baseInput.actorId,
    scopeId: baseInput.scopeId,
    action: baseInput.action,
    fingerprint: baseInput.fingerprint,
    changedAt: "2026-10-02T00:02:00.000Z",
  });
  assert.equal(repeated.kind, "not_in_progress");
});

test("fingerprint mismatch never changes the stored state", async () => {
  const { db } = fakeDb();
  await createIdempotencyRecord(db, baseInput);

  const result = await completeIdempotencyRecord(db, {
    key: baseInput.key,
    actorId: baseInput.actorId,
    scopeId: baseInput.scopeId,
    action: baseInput.action,
    fingerprint: "sha256:not-the-same",
    changedAt: "2026-10-02T00:03:00.000Z",
  });

  assert.equal(result.kind, "fingerprint_mismatch");
  const stored = await lookupIdempotencyRecord(db, baseInput);
  assert.equal(stored?.state, "in_progress");
});

test("fail transitions an in-progress record to the failed terminal state", async () => {
  const { db } = fakeDb();
  await createIdempotencyRecord(db, baseInput);

  const failed = await failIdempotencyRecord(db, {
    key: baseInput.key,
    actorId: baseInput.actorId,
    scopeId: baseInput.scopeId,
    action: baseInput.action,
    fingerprint: baseInput.fingerprint,
    changedAt: "2026-10-02T00:04:00.000Z",
  });

  assert.equal(failed.kind, "updated");
  if (failed.kind === "updated") {
    assert.equal(failed.record.state, "failed");
  }
});

test("bounded context validation fails before D1 access", async () => {
  const { db, statements } = fakeDb();

  await assert.rejects(
    createIdempotencyRecord(db, { ...baseInput, key: "   " }),
    /key must be between 1 and 128 characters/,
  );
  assert.equal(statements.length, 0);
});
