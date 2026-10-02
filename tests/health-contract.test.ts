import assert from "node:assert/strict";
import test from "node:test";

import { handleLiveness, handleReadiness } from "../src/worker/health";

const body = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

const fakeDb = (result: { ok: number } | null, throws = false) => ({
  prepare(sql: string) {
    assert.equal(sql, "SELECT 1 AS ok");
    return {
      async first<T>() {
        if (throws) throw new Error("internal database detail");
        return result as T | null;
      },
    };
  },
}) as unknown as D1Database;

test("liveness is dependency-free and returns only the runtime status", async () => {
  const response = handleLiveness();
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { status: "ok", component: "runtime" });
});

test("readiness reports database availability", async () => {
  const response = await handleReadiness(fakeDb({ ok: 1 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { status: "ok", component: "database" });
});

test("readiness fails closed when the database result is unavailable", async () => {
  let unavailable = 0;
  const response = await handleReadiness(fakeDb(null), () => { unavailable += 1; });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { status: "unavailable", component: "database" });
  assert.equal(unavailable, 1);
});

test("readiness hides dependency exception details", async () => {
  let unavailable = 0;
  const response = await handleReadiness(fakeDb(null, true), () => { unavailable += 1; });
  assert.equal(response.status, 503);
  const payload = await body(response);
  assert.deepEqual(payload, { status: "unavailable", component: "database" });
  assert.equal(JSON.stringify(payload).includes("internal database detail"), false);
  assert.equal(unavailable, 1);
});
