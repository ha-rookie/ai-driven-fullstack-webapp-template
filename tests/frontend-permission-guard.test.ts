import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AuthProvider,
  type AuthController,
  type AuthSnapshot,
} from "../src/frontend/auth";
import {
  PermissionGuard,
  PermissionProvider,
} from "../src/frontend/permissions";

const controllerFor = (snapshot: AuthSnapshot): AuthController => ({
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  bootstrap: async () => snapshot,
  synchronize: async () => snapshot,
  resetAfterLogout: () => undefined,
});

const renderGuard = (snapshot: AuthSnapshot, allowed: boolean) => renderToStaticMarkup(
  createElement(
    AuthProvider,
    { controller: controllerFor(snapshot) },
    createElement(
      PermissionProvider,
      { evaluate: (permission, user) => allowed && permission === "resource:delete" && user.id === "u1" },
      createElement(
        PermissionGuard,
        { permission: "resource:delete", fallback: createElement("span", null, "Denied") },
        createElement("button", { type: "button" }, "Delete"),
      ),
    ),
  ),
);

test("permission guard can show a destructive action when project policy allows it", () => {
  const markup = renderGuard({
    status: "authenticated",
    user: { id: "u1", displayName: "User" },
    syncing: false,
  }, true);
  assert.match(markup, /Delete/);
  assert.equal(markup.includes("Denied"), false);
});

test("permission guard renders fallback when denied", () => {
  const markup = renderGuard({
    status: "authenticated",
    user: { id: "u1", displayName: "User" },
    syncing: false,
  }, false);
  assert.match(markup, /Denied/);
  assert.equal(markup.includes("Delete"), false);
});

test("permission guard fails closed when the user is not authenticated", () => {
  const markup = renderGuard({ status: "unauthenticated", user: null, syncing: false }, true);
  assert.match(markup, /Denied/);
  assert.equal(markup.includes("Delete"), false);
});

test("permission evaluator failure is denied rather than leaking an exception", () => {
  const snapshot: AuthSnapshot = {
    status: "authenticated",
    user: { id: "u1", displayName: null },
    syncing: false,
  };
  const markup = renderToStaticMarkup(
    createElement(
      AuthProvider,
      { controller: controllerFor(snapshot) },
      createElement(
        PermissionProvider,
        { evaluate: () => { throw new Error("private policy detail"); } },
        createElement(
          PermissionGuard,
          { permission: "resource:delete", fallback: createElement("span", null, "Denied") },
          createElement("button", { type: "button" }, "Delete"),
        ),
      ),
    ),
  );
  assert.match(markup, /Denied/);
  assert.equal(markup.includes("private policy detail"), false);
});
