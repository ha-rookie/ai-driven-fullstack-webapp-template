import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncJobEnvelope } from "../src/shared/async-job";

test("async job payload rejects camelCase sensitive field names", async () => {
  await assert.rejects(
    () => createAsyncJobEnvelope({
      type: "resource.rebuild",
      payload: { userId: "u-1", accessToken: "do-not-queue" },
      jobId: "job-sensitive-1",
    }),
    /sensitive field 'accessToken'/,
  );

  await assert.rejects(
    () => createAsyncJobEnvelope({
      type: "resource.rebuild",
      payload: { sessionId: "session-should-not-be-queued" },
      jobId: "job-sensitive-2",
    }),
    /sensitive field 'sessionId'/,
  );
});

test("async job payload rejects sparse arrays instead of canonicalizing ambiguous JSON", async () => {
  const sparse: unknown[] = [];
  sparse.length = 2;
  sparse[1] = "value";

  await assert.rejects(
    () => createAsyncJobEnvelope({
      type: "resource.rebuild",
      payload: { items: sparse },
      jobId: "job-sparse-1",
    }),
    /sparse array entries/,
  );
});
