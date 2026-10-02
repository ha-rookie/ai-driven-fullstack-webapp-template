import assert from "node:assert/strict";
import test from "node:test";
import { OperationModeUnavailableError, type OperationModeState } from "../src/domain/operation-mode";
import { D1OperationModeStore } from "../src/infrastructure/d1-operation-mode-store";

const state: OperationModeState = {
  environment: "preview", mode: "read-only", version: 2,
  updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: "operator-1", reason: "Investigation",
};
const input = { mode: "maintenance" as const, expectedVersion: 2, updatedBy: "operator-2", reason: "Incident" };
const fake = (result: unknown, fail = false) => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = { prepare(sql: string) {
    return { bind(...values: unknown[]) {
      calls.push({ sql, values });
      return { first: async () => { if (fail) throw new Error("secret SQL details"); return result; } };
    } };
  } } as unknown as D1Database;
  return { db, calls };
};

test("read is environment-specific and does not leak unprojected row fields", async () => {
  const f = fake({ ...state, secret: "hidden" });
  assert.deepEqual(await new D1OperationModeStore(f.db, "preview").read(), state);
  assert.deepEqual(f.calls[0].values, ["preview"]);
  assert.match(f.calls[0].sql, /WHERE environment = \?/);
});

test("missing, corrupt and unavailable state never falls back to normal", async () => {
  for (const [row, fail, reason] of [
    [null, false, "missing"], [{ ...state, mode: "unknown" }, false, "invalid_state"],
    [{ ...state, environment: "production" }, false, "invalid_state"],
    [{ ...state, version: 0 }, false, "invalid_state"],
    [{ ...state, updatedAt: "invalid" }, false, "invalid_state"],
    [{ ...state, reason: "" }, false, "invalid_state"], [null, true, "dependency_failure"],
  ] as const) {
    const f = fake(row, fail);
    await assert.rejects(new D1OperationModeStore(f.db, "preview").read(), (error: unknown) =>
      error instanceof OperationModeUnavailableError && error.reason === reason && !error.message.includes("SQL"));
  }
});

test("atomic update carries observed version and clock metadata to persistence", async () => {
  const updated = { ...state, mode: "maintenance", version: 3, updatedBy: input.updatedBy, reason: input.reason };
  const f = fake(updated);
  const store = new D1OperationModeStore(f.db, "preview", { now: () => new Date(state.updatedAt) });
  assert.deepEqual(await store.update(input), { kind: "updated", state: updated });
  assert.match(f.calls[0].sql, /version = version \+ 1/);
  assert.deepEqual(f.calls[0].values, ["maintenance", state.updatedAt, "operator-2", "Incident", "preview", 2]);
});

test("zero-row update is conflict without re-read, version reacquisition or retry", async () => {
  const f = fake(null);
  assert.deepEqual(await new D1OperationModeStore(f.db, "preview").update(input), { kind: "conflict" });
  assert.equal(f.calls.length, 1);
});

test("initialization requires version zero and cannot overwrite existing state", async () => {
  const f = fake(null);
  assert.deepEqual(await new D1OperationModeStore(f.db, "preview").update({ ...input, expectedVersion: 0 }), { kind: "conflict" });
  assert.match(f.calls[0].sql, /ON CONFLICT\(environment\) DO NOTHING/);
});

test("invalid input and environment fail before database access", async () => {
  const f = fake(state);
  assert.throws(() => new D1OperationModeStore(f.db, "bogus" as "preview"));
  const store = new D1OperationModeStore(f.db, "preview");
  for (const invalid of [
    { ...input, mode: "bogus" as "normal" }, { ...input, expectedVersion: -1 },
    { ...input, expectedVersion: 1.5 }, { ...input, updatedBy: "" },
    { ...input, reason: "secret\nvalue" }, { ...input, reason: "x".repeat(513) },
  ]) await assert.rejects(store.update(invalid), TypeError);
  assert.equal(f.calls.length, 0);
});

test("write and prepare failures remain unavailable and do not expose diagnostics", async () => {
  const f = fake(null, true);
  await assert.rejects(new D1OperationModeStore(f.db, "preview").update(input), OperationModeUnavailableError);
  const db = { prepare() { throw new Error("private binding"); } } as unknown as D1Database;
  const store = new D1OperationModeStore(db, "preview");
  await assert.rejects(store.read(), OperationModeUnavailableError);
  await assert.rejects(store.update(input), OperationModeUnavailableError);
});
