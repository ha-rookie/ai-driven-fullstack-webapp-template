import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createOperationModeController,
  OperationModeBanner,
  type OperationModeSnapshot,
} from "../src/frontend/operation-mode";

const snapshot = (mode: "normal" | "read-only" | "maintenance", stale = false): OperationModeSnapshot => ({
  status: "ready",
  state: { mode, version: 2, updatedAt: "2026-10-03T00:00:00.000Z" },
  refreshing: false,
  stale,
});

test("operation mode controller preserves the last known state and marks it stale after refresh failure", async () => {
  let fail = false;
  const controller = createOperationModeController(async () => {
    if (fail) throw new Error("private dependency detail");
    return { mode: "read-only", version: 3 } as const;
  });

  await controller.bootstrap();
  assert.deepEqual(controller.getSnapshot(), {
    status: "ready",
    state: { mode: "read-only", version: 3 },
    refreshing: false,
    stale: false,
  });

  fail = true;
  await controller.refresh();
  assert.deepEqual(controller.getSnapshot(), {
    status: "ready",
    state: { mode: "read-only", version: 3 },
    refreshing: false,
    stale: true,
  });
});

test("initial loader failure never fabricates normal mode", async () => {
  const controller = createOperationModeController(async () => {
    throw new Error("unavailable");
  });

  await controller.bootstrap();
  assert.deepEqual(controller.getSnapshot(), {
    status: "error",
    state: null,
    refreshing: false,
    stale: true,
  });
});

test("operation mode banner is quiet in normal mode and explicit in read-only / maintenance", () => {
  assert.equal(renderToStaticMarkup(createElement(OperationModeBanner, { snapshot: snapshot("normal") })), "");

  const readOnly = renderToStaticMarkup(createElement(OperationModeBanner, { snapshot: snapshot("read-only") }));
  assert.match(readOnly, /role="status"/);
  assert.match(readOnly, /data-operation-mode="read-only"/);
  assert.match(readOnly, /Changes cannot be saved/);

  const maintenance = renderToStaticMarkup(createElement(OperationModeBanner, { snapshot: snapshot("maintenance") }));
  assert.match(maintenance, /role="alert"/);
  assert.match(maintenance, /data-operation-mode="maintenance"/);
  assert.match(maintenance, /under maintenance/);
});

test("stale and unavailable states are never displayed as a trustworthy normal state", () => {
  const stale = renderToStaticMarkup(createElement(OperationModeBanner, { snapshot: snapshot("normal", true) }));
  assert.match(stale, /data-operation-mode-stale="true"/);
  assert.match(stale, /may be out of date/);

  const unavailable = renderToStaticMarkup(createElement(OperationModeBanner, {
    snapshot: { status: "error", state: null, refreshing: false, stale: true },
  }));
  assert.match(unavailable, /data-operation-mode="unknown"/);
  assert.match(unavailable, /status is temporarily unavailable/);
});
