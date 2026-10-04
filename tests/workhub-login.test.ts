import assert from "node:assert/strict";
import test from "node:test";

import {
  handleWorkhubDemoConfig,
  isWorkhubDemoEnabled,
  resolveWorkhubRuntimeEnvironment,
} from "../src/worker/workhub-login";

const db = {} as D1Database;

test("WORKHUB demo mode is never enabled in production", () => {
  assert.equal(isWorkhubDemoEnabled("production", "true"), false);
  assert.equal(isWorkhubDemoEnabled("production", undefined), false);
  assert.equal(isWorkhubDemoEnabled("preview", undefined), false);
  assert.equal(isWorkhubDemoEnabled("preview", "true"), true);
  assert.equal(isWorkhubDemoEnabled("local", undefined), true);
  assert.equal(isWorkhubDemoEnabled("test", "false"), false);
});

test("runtime environment falls back to local only for loopback hosts", () => {
  assert.equal(
    resolveWorkhubRuntimeEnvironment(new Request("http://127.0.0.1:4173/"), undefined),
    "local",
  );
  assert.equal(
    resolveWorkhubRuntimeEnvironment(new Request("https://workhub.example/"), "preview"),
    "preview",
  );
  assert.throws(
    () => resolveWorkhubRuntimeEnvironment(new Request("https://workhub.example/"), undefined),
    /workhub_runtime_environment_required/u,
  );
});

test("production demo config does not expose personas or demo password", async () => {
  const response = handleWorkhubDemoConfig(
    new Request("https://workhub.example/api/workhub/demo-config"),
    { DB: db, RUNTIME_ENVIRONMENT: "production", WORKHUB_DEMO_MODE: "true" },
    "request-1",
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(payload.demoEnabled, false);
  assert.deepEqual(payload.personas, []);
  assert.equal(Object.hasOwn(payload, "demoPassword"), false);
});

test("local demo config exposes reference personas only in demo-enabled environment", async () => {
  const response = handleWorkhubDemoConfig(
    new Request("http://127.0.0.1:4173/api/workhub/demo-config"),
    { DB: db },
    "request-2",
  );
  assert.ok(response);
  const payload = await response.json() as {
    demoEnabled: boolean;
    personas: Array<{ userId: string }>;
    demoPassword?: string;
  };
  assert.equal(payload.demoEnabled, true);
  assert.deepEqual(payload.personas.map((persona) => persona.userId), [
    "haru",
    "aoi",
    "ren",
    "mei",
    "sora",
    "kai",
  ]);
  assert.equal(typeof payload.demoPassword, "string");
  assert.ok((payload.demoPassword?.length ?? 0) >= 15);
});
