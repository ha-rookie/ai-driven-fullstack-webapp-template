import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthApiLoader,
  createAuthController,
  decodeAuthMePayload,
  type AuthUser,
} from "../src/frontend/auth/state";

const jsonResponse = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test("auth payload decoder exposes only bounded public user fields", () => {
  assert.deepEqual(
    decodeAuthMePayload({
      authenticated: true,
      user: { id: "u1", displayName: "User", secret: "ignored" },
      internal: "ignored",
    }),
    { id: "u1", displayName: "User" },
  );
  assert.equal(decodeAuthMePayload({ authenticated: false }), null);
  assert.equal(decodeAuthMePayload({ authenticated: true, user: { id: "", displayName: null } }), null);
});

test("auth API loader uses same-origin cookie request without copying credentials", async () => {
  let observedInput: RequestInfo | URL | undefined;
  let observedInit: RequestInit | undefined;
  const loader = createAuthApiLoader(async (input, init) => {
    observedInput = input;
    observedInit = init;
    return jsonResponse({ authenticated: true, user: { id: "u1", displayName: null } }, {
      headers: { "x-request-id": "req-auth" },
    });
  });

  assert.deepEqual(await loader(), { id: "u1", displayName: null });
  assert.equal(observedInput, "/api/auth/me");
  assert.equal(observedInit?.method, "GET");
  assert.equal(observedInit?.credentials, "same-origin");
  assert.equal("body" in (observedInit ?? {}) && observedInit?.body !== undefined, false);
});

test("bootstrap distinguishes authenticated, unauthenticated and infrastructure error", async () => {
  const authenticated = createAuthController(async () => ({ id: "u1", displayName: "User" }));
  assert.equal(authenticated.getSnapshot().status, "loading");
  assert.deepEqual(await authenticated.bootstrap(), {
    status: "authenticated",
    user: { id: "u1", displayName: "User" },
    syncing: false,
  });

  const unauthenticated = createAuthController(createAuthApiLoader(async () => new Response(null, {
    status: 401,
    headers: { "x-request-id": "req-401" },
  })));
  assert.deepEqual(await unauthenticated.bootstrap(), {
    status: "unauthenticated",
    user: null,
    syncing: false,
    requestId: "req-401",
  });

  const unavailable = createAuthController(createAuthApiLoader(async () => {
    throw new Error("socket detail");
  }));
  assert.deepEqual(await unavailable.bootstrap(), {
    status: "error",
    user: null,
    syncing: false,
  });
});

test("concurrent bootstrap calls collapse to one request", async () => {
  const gate = deferred<AuthUser>();
  let calls = 0;
  const controller = createAuthController(() => {
    calls += 1;
    return gate.promise;
  });

  const first = controller.bootstrap();
  const second = controller.bootstrap();
  assert.equal(calls, 1);
  gate.resolve({ id: "u1", displayName: null });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("synchronize preserves the stable authenticated state until convergence", async () => {
  const gate = deferred<AuthUser>();
  let call = 0;
  const controller = createAuthController(async () => {
    call += 1;
    if (call === 1) return { id: "u1", displayName: "Before" };
    return gate.promise;
  });

  await controller.bootstrap();
  const pending = controller.synchronize();
  assert.deepEqual(controller.getSnapshot(), {
    status: "authenticated",
    user: { id: "u1", displayName: "Before" },
    syncing: true,
  });

  gate.resolve({ id: "u1", displayName: "After" });
  assert.deepEqual(await pending, {
    status: "authenticated",
    user: { id: "u1", displayName: "After" },
    syncing: false,
  });
});

test("logout reset clears frontend identity without retaining raw session material", async () => {
  const controller = createAuthController(async () => ({ id: "u1", displayName: "User" }));
  await controller.bootstrap();
  controller.resetAfterLogout();
  assert.deepEqual(controller.getSnapshot(), {
    status: "unauthenticated",
    user: null,
    syncing: false,
  });
});
