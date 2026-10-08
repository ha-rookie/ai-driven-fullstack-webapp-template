import assert from "node:assert/strict";
import test from "node:test";

import { handleDataCorrectionApi } from "../src/worker/administration";

const dbWithoutSession = {
  prepare() {
    return {
      bind() {
        return {
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        };
      },
    };
  },
} as unknown as D1Database;

test("returns null outside the data correction routes", async () => {
  const response = await handleDataCorrectionApi(
    new Request("https://example.test/api/admin/other"),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-correction-1",
  );
  assert.equal(response, null);
});

test("preview requires GET", async () => {
  const response = await handleDataCorrectionApi(
    new Request(
      "https://example.test/api/admin/data-corrections/RESTORE_SOFT_DELETED_RESOURCE/preview?scopeId=scope-1&resourceId=resource-1&expectedVersion=2",
      { method: "POST" },
    ),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-correction-2",
  );
  assert.equal(response?.status, 405);
});

test("execute requires POST", async () => {
  const response = await handleDataCorrectionApi(
    new Request(
      "https://example.test/api/admin/data-corrections/RESTORE_SOFT_DELETED_RESOURCE/execute?scopeId=scope-1&resourceId=resource-1",
    ),
    { DB: dbWithoutSession, RUNTIME_ENVIRONMENT: "test" },
    "req-correction-3",
  );
  assert.equal(response?.status, 405);
});

test("authenticated session is required before target lookup", async () => {
  let resourceLookup = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first<T>() {
              if (sql.includes("application_sessions")) return null;
              resourceLookup += 1;
              return null as T | null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  const response = await handleDataCorrectionApi(
    new Request(
      "https://example.test/api/admin/data-corrections/RESTORE_SOFT_DELETED_RESOURCE/preview?scopeId=scope-1&resourceId=resource-1&expectedVersion=2",
    ),
    { DB: db, RUNTIME_ENVIRONMENT: "test" },
    "req-correction-4",
  );

  assert.equal(response?.status, 401);
  assert.equal(resourceLookup, 0);
});

test("runtime environment is fail-closed", async () => {
  const response = await handleDataCorrectionApi(
    new Request(
      "https://example.test/api/admin/data-corrections/RESTORE_SOFT_DELETED_RESOURCE/preview?scopeId=scope-1&resourceId=resource-1&expectedVersion=2",
    ),
    { DB: dbWithoutSession },
    "req-correction-5",
  );
  assert.equal(response?.status, 503);
});
