import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

// Execute the real TypeScript adapter against Wrangler Local D1. This temporary
// directory contains only this test's compiled code and dedicated D1 state.
const scratch = mkdtempSync(join(tmpdir(), "operation-mode-local-"));
try {
  const compiled = join(scratch, "compiled");
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"),
    "src/infrastructure/d1-operation-mode-store.ts", "src/worker/administration/operation-mode-api.ts", "--outDir", compiled,
    "--rootDir", "src", "--target", "ES2023", "--module", "CommonJS",
    "--moduleResolution", "Node", "--types", "node,@cloudflare/workers-types",
    "--strict", "--skipLibCheck"], { stdio: "inherit" });
  writeFileSync(join(compiled, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const { D1OperationModeStore } = require(join(compiled, "infrastructure/d1-operation-mode-store.js"));
  const { OperationModeUnavailableError } = require(join(compiled, "domain/operation-mode.js"));
  const { handleOperationModeApi } = require(join(compiled, "worker/administration/operation-mode-api.js"));
  const { issueApplicationSession } = require(join(compiled, "worker/auth/application-session.js"));
  const { deriveCsrfToken, RateLimitGuard, LocalRateLimitStore } = require(join(compiled, "worker/http/index.js"));
  const cli = resolve("node_modules/wrangler/bin/wrangler.js");
  const run = (args) => execFileSync(process.execPath, [cli, "d1", "execute", "DB", "--local",
    "--persist-to", join(scratch, "state"), "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  for (const migration of ["0002_auth_foundation", "0003_authorization_foundation", "0007_session_idle_timeout", "0008_user_lifecycle", "0015_operation_modes"]) {
    run(["--file", `migrations/${migration}.sql`]);
  }
  const literal = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
    if (value === null) return "NULL";
    throw new TypeError("Unsupported fixture binding");
  };
  const db = { prepare(sql) { return { bind(...values) { const execute = () => {
    let i = 0;
    const rendered = sql.replaceAll("?", () => literal(values[i++]));
    assert.equal(i, values.length);
    const output = JSON.parse(run(["--command", rendered]));
    return output[0];
  }; return { async first() { return execute().results[0] ?? null; }, async run() { return execute(); } }; } }; } };
  const clock = { now: () => new Date("2026-10-02T10:00:00.000Z") };
  const preview = new D1OperationModeStore(db, "preview", clock);
  const production = new D1OperationModeStore(db, "production", clock);
  await assert.rejects(preview.read(), (e) => e instanceof OperationModeUnavailableError && e.reason === "missing");
  const change = { mode: "normal", expectedVersion: 0, updatedBy: "operator-1", reason: "Explicit initialization" };
  assert.equal((await preview.update(change)).kind, "updated");
  assert.equal((await production.update(change)).kind, "updated");
  const observed = await preview.read();
  assert.equal(observed.version, 1);
  assert.equal((await preview.update({ ...change, mode: "read-only", expectedVersion: observed.version })).kind, "updated");
  assert.equal((await preview.update({ ...change, mode: "maintenance", expectedVersion: observed.version })).kind, "conflict");
  assert.equal((await preview.update(change)).kind, "conflict");
  const current = await preview.read();
  assert.equal(current.mode, "read-only");
  assert.equal(current.version, 2);
  assert.equal(current.updatedBy, change.updatedBy);
  assert.equal(current.reason, change.reason);
  assert.equal(current.updatedAt, clock.now().toISOString());
  assert.equal((await production.read()).mode, "normal");
  assert.equal((await preview.update({ ...change, mode: "maintenance", expectedVersion: 2 })).kind, "updated");
  assert.equal((await preview.update({ ...change, mode: "normal", expectedVersion: 3 })).kind, "updated");
  for (const assignment of ["mode='unknown'", "version=0", "environment='other'", "reason=''", "updated_by=''"]) {
    assert.throws(() => run(["--command", `UPDATE operation_modes SET ${assignment} WHERE environment='preview'`]), "constraint must reject " + assignment);
  }
  assert.equal((await preview.read()).version, 4);
  // Exercise the actual Request -> Authn -> CSRF -> Authz -> D1 CAS boundary.
  const now = new Date().toISOString();
  const sqlNow = literal(now);
  run(["--command", `INSERT INTO users(id,created_at,updated_at) VALUES('local-operator',${sqlNow},${sqlNow});
    INSERT INTO resource_scopes(id,name,created_at,updated_at) VALUES('preview-control','Local control plane',${sqlNow},${sqlNow});
    INSERT INTO scope_memberships(scope_id,user_id,role,created_at,updated_at) VALUES('preview-control','local-operator','operator',${sqlNow},${sqlNow});`]);
  const session = await issueApplicationSession(db, "local-operator");
  const csrf = await deriveCsrfToken(session.token);
  const audit = [];
  const security = [];
  const options = { store: preview, environment: "preview", operatorScopeId: "preview-control",
    authorizationPolicy: { "operation_mode:read": ["operator"], "operation_mode:update": ["operator"] },
    rateLimitGuard: new RateLimitGuard(new LocalRateLimitStore()),
    rateLimitPolicy: { endpointId: "local-mode-api", limit: 100, windowSeconds: 60 },
    securityEventSink: event => security.push(event) };
  const request = async (method, body, authenticated = true, proof = true) => {
    const headers = { "content-type": "application/json" };
    if (authenticated) headers.cookie = `app_session=${session.token}`;
    if (proof) headers["x-csrf-token"] = csrf;
    return handleOperationModeApi(new Request("https://example.test/api/admin/operation-mode", {
      method, headers, ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    }), db, event => audit.push(event), "local-mode-request", options);
  };
  const before = await preview.read();
  const payload = { targetEnvironment: "preview", mode: "maintenance", expectedVersion: before.version,
    reason: "Local incident containment", updatedBy: "untrusted-client" };
  assert.equal((await request("GET")).status, 200);
  assert.equal((await request("PATCH", payload, false)).status, 401);
  assert.equal((await request("PATCH", payload, true, false)).status, 403);
  assert.equal((await request("PATCH", { ...payload, targetEnvironment: "production" })).status, 400);
  assert.deepEqual(await preview.read(), before);
  assert.equal((await request("PATCH", payload)).status, 200);
  const changed = await preview.read();
  assert.equal(changed.mode, "maintenance");
  assert.equal(changed.version, before.version + 1);
  assert.equal(changed.updatedBy, "local-operator");
  assert.equal(audit[0].operationModeChange.beforeMode, before.mode);
  assert.equal(audit[0].operationModeChange.afterMode, "maintenance");
  assert.equal((await request("PATCH", { ...payload, mode: "read-only" })).status, 409);
  assert.deepEqual(await preview.read(), changed);
  assert.equal((await production.read()).mode, "normal");
  run(["--command", "UPDATE scope_memberships SET role='observer' WHERE user_id='local-operator'"]);
  assert.equal((await request("PATCH", { ...payload, expectedVersion: changed.version })).status, 403);
  assert.deepEqual(await preview.read(), changed);
  assert.ok(security.some(event => event.eventType === "authorization_rejected"));
  run(["--command", "UPDATE scope_memberships SET role='operator' WHERE user_id='local-operator'"]);
  assert.equal((await request("PATCH", { ...payload, mode: "normal", expectedVersion: changed.version,
    reason: "Local recovery verified" })).status, 200);
  assert.equal((await preview.read()).mode, "normal");
  assert.equal(JSON.stringify(audit).includes(session.token), false);
  console.log("Operation mode Store/API Local D1 contract passed (isolated state, no remote resources)");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
