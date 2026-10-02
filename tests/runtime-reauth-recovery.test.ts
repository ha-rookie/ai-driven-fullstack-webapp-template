import assert from "node:assert/strict";
import test from "node:test";

import { ApiClientError } from "../src/frontend/api";
import { createRuntimeReauthController } from "../src/frontend/auth/recovery";

const authError = (requestId: string) => new ApiClientError("http", "Authentication required", {
  status: 401,
  requestId,
});

test("non-401 failures do not start runtime reauthentication", async () => {
  let starts = 0;
  const controller = createRuntimeReauthController({
    beginReauthentication: async () => { starts += 1; },
    synchronize: async () => ({ status: "authenticated", user: { id: "u1", displayName: null }, syncing: false }),
  });

  const handled = await controller.handle(new ApiClientError("http", "Forbidden", { status: 403 }));
  assert.equal(handled, false);
  assert.equal(starts, 0);
  assert.deepEqual(controller.getSnapshot(), { status: "idle", attempt: 0 });
});

test("concurrent 401 failures converge on one reauthentication flow", async () => {
  let starts = 0;
  let synchronizations = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const controller = createRuntimeReauthController({
    beginReauthentication: async () => {
      starts += 1;
      await gate;
    },
    synchronize: async () => {
      synchronizations += 1;
      return { status: "authenticated", user: { id: "u1", displayName: "User" }, syncing: false } as const;
    },
  });

  const first = controller.handle(authError("req-1"));
  const second = controller.handle(authError("req-2"));
  await Promise.resolve();

  assert.equal(controller.getSnapshot().status, "recovering");
  assert.equal(controller.getSnapshot().requestId, "req-1");
  release?.();

  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(starts, 1);
  assert.equal(synchronizations, 1);
  assert.deepEqual(controller.getSnapshot(), {
    status: "recovered",
    attempt: 1,
    requestId: "req-1",
  });
});

test("reauthentication is failed unless auth synchronization confirms authenticated state", async () => {
  const controller = createRuntimeReauthController({
    beginReauthentication: async () => undefined,
    synchronize: async () => ({ status: "unauthenticated", user: null, syncing: false }),
  });

  await controller.handle(authError("req-auth"));
  assert.equal(controller.getSnapshot().status, "failed");
  assert.equal(controller.getSnapshot().attempt, 1);

  controller.acknowledge();
  assert.equal(controller.getSnapshot().status, "idle");
});

test("failed recovery can be retried explicitly and logout reset is separate", async () => {
  let shouldFail = true;
  const controller = createRuntimeReauthController({
    beginReauthentication: async () => {
      if (shouldFail) throw new Error("provider unavailable");
    },
    synchronize: async () => ({ status: "authenticated", user: { id: "u1", displayName: null }, syncing: false }),
  });

  await controller.handle(authError("req-auth"));
  assert.equal(controller.getSnapshot().status, "failed");

  shouldFail = false;
  await controller.retry();
  assert.equal(controller.getSnapshot().status, "recovered");
  assert.equal(controller.getSnapshot().attempt, 2);

  controller.resetAfterLogout();
  assert.deepEqual(controller.getSnapshot(), { status: "idle", attempt: 0 });
});
