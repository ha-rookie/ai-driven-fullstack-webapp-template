import assert from "node:assert/strict";
import test from "node:test";

import {
  createLoginIntent,
  evaluateProtectedRoute,
} from "../src/frontend/routing/policy";

test("protected route distinguishes bootstrap, authenticated and auth error states", () => {
  assert.deepEqual(
    evaluateProtectedRoute({ status: "loading" }, { loginPath: "/login", currentPath: "/secure" }),
    { kind: "pending" },
  );
  assert.deepEqual(
    evaluateProtectedRoute({ status: "authenticated" }, { loginPath: "/login", currentPath: "/secure" }),
    { kind: "authenticated" },
  );
  assert.deepEqual(
    evaluateProtectedRoute({ status: "error", requestId: "req-auth" }, { loginPath: "/login" }),
    { kind: "error", requestId: "req-auth" },
  );
});

test("unauthenticated route produces a bounded same-origin login intent", () => {
  assert.deepEqual(
    evaluateProtectedRoute(
      { status: "unauthenticated" },
      { loginPath: "/login", currentPath: "/orders/42?tab=history#latest" },
    ),
    {
      kind: "unauthenticated",
      login: {
        loginPath: "/login",
        returnTo: "/orders/42?tab=history#latest",
        href: "/login?returnTo=%2Forders%2F42%3Ftab%3Dhistory%23latest",
      },
    },
  );
});

test("login route is never inserted as its own return target", () => {
  assert.deepEqual(createLoginIntent("/login", "/login"), {
    loginPath: "/login",
    href: "/login",
  });
  assert.deepEqual(createLoginIntent("/login", "/login?reason=expired"), {
    loginPath: "/login",
    href: "/login",
  });
});

test("unsafe return targets are discarded instead of propagated", () => {
  assert.deepEqual(createLoginIntent("/login", "https://evil.example/phish"), {
    loginPath: "/login",
    href: "/login",
  });
  assert.deepEqual(createLoginIntent("/login", "//evil.example/phish"), {
    loginPath: "/login",
    href: "/login",
  });
  assert.deepEqual(createLoginIntent("/login", "/\\evil.example/phish"), {
    loginPath: "/login",
    href: "/login",
  });
});

test("invalid login configuration fails closed", () => {
  assert.throws(() => createLoginIntent("https://evil.example/login", "/secure"), /safe same-origin/);
  assert.throws(() => createLoginIntent("//evil.example/login", "/secure"), /safe same-origin/);
  assert.throws(() => createLoginIntent("/login?next=/secure", "/secure"), /query or fragment/);
});
