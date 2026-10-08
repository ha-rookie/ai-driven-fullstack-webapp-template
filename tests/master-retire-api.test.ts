import assert from "node:assert/strict";
import test from "node:test";
import { handleMasterRetireApi, RETIRE_MASTER_ITEM } from "../src/worker/administration/master-retire-api";
import { WORKHUB_OFFICE_MASTER_DEFINITION } from "../src/reference/workhub/travel-request";

const options = {
  scopeId: "workhub-company",
  definition: WORKHUB_OFFICE_MASTER_DEFINITION,
  allowedItemIds: ["workhub-office-legacy"],
};
const dbWithoutSession = {
  prepare() {
    return { bind() { return { first: async () => null }; } };
  },
} as unknown as D1Database;

test("master retirement route is explicitly separated from generic master CRUD", async () => {
  const result = await handleMasterRetireApi(
    new Request("https://example.test/api/admin/master-data?scopeId=workhub-company"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" }, "req-1", options,
  );
  assert.equal(result, null);
  assert.equal(RETIRE_MASTER_ITEM, "RETIRE_MASTER_ITEM");
});

test("master retirement refuses mutation methods on preview endpoint", async () => {
  const response = await handleMasterRetireApi(
    new Request("https://example.test/api/admin/master-operations/retire/preview", { method: "POST" }),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" }, "req-2", options,
  );
  assert.equal(response?.status, 405);
});

test("master retirement fail-closes missing runtime environment and Production", async () => {
  const target = "https://example.test/api/admin/master-operations/retire/preview";
  const unset = await handleMasterRetireApi(
    new Request(target), { DB: dbWithoutSession }, "req-3", options,
  );
  assert.equal(unset?.status, 503);
  const production = await handleMasterRetireApi(
    new Request(target), { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "production" },
    "req-4", options,
  );
  assert.equal(production?.status, 403);
  const body = await production?.json() as { error: { code: string } };
  assert.equal(body.error.code, "human_gate_required");
});

test("master retirement requires authentication before item lookup", async () => {
  let masterReadCount = 0;
  const db = {
    prepare(sql: string) {
      if (sql.includes("master_items")) masterReadCount += 1;
      return { bind() { return { first: async () => null }; } };
    },
  } as unknown as D1Database;
  const response = await handleMasterRetireApi(
    new Request("https://example.test/api/admin/master-operations/retire/preview?scopeId=workhub-company&itemId=workhub-office-legacy&expectedVersion=2"),
    { DB: db, RUNTIME_ENVIRONMENT: "test" }, "req-5", options,
  );
  assert.equal(response?.status, 401);
  assert.equal(masterReadCount, 0);
});

test("master retirement rejects missing session even if item ID is allowlisted", async () => {
  const response = await handleMasterRetireApi(
    new Request("https://example.test/api/admin/master-operations/retire/execute?scopeId=workhub-company&itemId=workhub-office-legacy", {
      method: "POST",
    }),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" }, "req-6", options,
  );
  assert.equal(response?.status, 401);
});
