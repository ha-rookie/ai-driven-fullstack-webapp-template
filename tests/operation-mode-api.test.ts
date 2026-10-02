import assert from "node:assert/strict";
import test from "node:test";
import { handleOperationModeApi, type OperationModeApiOptions } from "../src/worker/administration";
import type { OperationModeState, OperationModeStore } from "../src/domain/operation-mode";
import { toStructuredAuditRecord } from "../src/worker/audit";
import type { AuditEvent } from "../src/worker/audit";
import { deriveCsrfToken, LocalRateLimitStore, RateLimitGuard } from "../src/worker/http";
import type { SecurityRejectionEvent } from "../src/worker/security";

const token = "local-test-only-operation-session";
const initial = (): OperationModeState => ({ environment: "preview", mode: "normal", version: 1,
  updatedAt: "2026-10-02T00:00:00.000Z", updatedBy: "operator", reason: "Initialize fixture" });

const fixture = (role: string | null = "operator", authenticated = true) => {
  let state = initial();
  let reads = 0;
  let writes = 0;
  const events: SecurityRejectionEvent[] = [];
  const audits: Omit<AuditEvent, "requestId" | "method" | "path">[] = [];
  const db = { prepare(sql: string) { return { bind(...bindings: unknown[]) { return { async first() {
    if (sql.includes("FROM application_sessions")) return authenticated ? { id: "operator", displayName: null,
      expiresAt: "2099-01-01T00:00:00.000Z", lastSeenAt: new Date().toISOString() } : null;
    assert.match(sql, /FROM scope_memberships/);
    assert.deepEqual(bindings, ["operator", "preview-control"]);
    return role ? { scopeId: "preview-control", userId: "operator", role } : null;
  } }; } }; } } as unknown as D1Database;
  const store: OperationModeStore = { async read() { reads++; return { ...state }; }, async update(input) {
    writes++;
    if (input.expectedVersion !== state.version) return { kind: "conflict" };
    state = { ...state, mode: input.mode, version: state.version + 1, updatedBy: input.updatedBy, reason: input.reason };
    return { kind: "updated", state: { ...state } };
  } };
  const options: OperationModeApiOptions = { store, environment: "preview", operatorScopeId: "preview-control",
    authorizationPolicy: { "operation_mode:read": ["observer", "operator"], "operation_mode:update": ["operator"] },
    rateLimitGuard: new RateLimitGuard(new LocalRateLimitStore()),
    rateLimitPolicy: { endpointId: "mode", limit: 100, windowSeconds: 60 },
    securityEventSink: event => events.push(event) };
  const call = async (method = "PATCH", body: unknown = { targetEnvironment: "preview", mode: "maintenance", expectedVersion: 1, reason: "Incident containment" },
    csrf = true, settings: OperationModeApiOptions = options, path = "/api/admin/operation-mode") => {
    const headers: Record<string, string> = { cookie: `app_session=${token}`, "content-type": "application/json" };
    if (csrf) headers["x-csrf-token"] = await deriveCsrfToken(token);
    return handleOperationModeApi(new Request("https://example.test" + path, { method, headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }) }), db, e => audits.push(e), "mode-request", settings);
  };
  return { call, store, options, events, audits, state: () => state, reads: () => reads, writes: () => writes };
};

test("opt-in route/method boundary and correlated uncached responses", async () => {
  const f = fixture();
  assert.equal(await f.call("GET", undefined, true, f.options, "/api/other"), null);
  const wrong = await f.call("POST");
  assert.equal(wrong?.status, 405);
  assert.equal(wrong?.headers.get("allow"), "GET, PATCH");
  assert.equal(f.reads(), 0);
  const read = await f.call("GET");
  assert.equal(read?.status, 200);
  assert.equal(read?.headers.get("cache-control"), "no-store");
  assert.equal(read?.headers.get("x-request-id"), "mode-request");
  const data = await read!.json() as { state: Record<string, unknown>; requestId: string };
  assert.equal(data.state.mode, "normal");
  assert.equal(data.requestId, "mode-request");
  assert.equal("reason" in data.state, false);
  assert.equal("updatedBy" in data.state, false);
  assert.equal(f.audits.length, 0);
});

test("authenticated scoped operator changes mode with trusted actor and typed before/after Audit", async () => {
  const f = fixture();
  const response = await f.call("PATCH", { targetEnvironment: "preview", mode: "maintenance", expectedVersion: 1,
    reason: "Incident containment", updatedBy: "attacker" });
  assert.equal(response?.status, 200);
  assert.equal(f.state().version, 2);
  assert.equal(f.state().updatedBy, "operator");
  assert.deepEqual(f.audits[0].operationModeChange, { environment: "preview", beforeMode: "normal", afterMode: "maintenance",
    beforeVersion: 1, afterVersion: 2, reason: "Incident containment" });
  assert.equal(f.audits[0].actorId, "operator");
  assert.equal((await f.call("PATCH", { targetEnvironment: "preview", mode: "normal", expectedVersion: 2,
    reason: "Containment verified" }))?.status, 200);
  assert.equal(f.state().mode, "normal", "control plane remains usable in maintenance");
});

test("authentication, missing membership, read-only role and CSRF fail before Store access", async () => {
  for (const [role, authenticated, csrf, status, event] of [
    ["operator", false, true, 401, "authentication_rejected"],
    [null, true, true, 403, "authorization_rejected"],
    ["observer", true, true, 403, "authorization_rejected"],
    ["operator", true, false, 403, "csrf_rejected"],
  ] as const) {
    const f = fixture(role, authenticated);
    assert.equal((await f.call("PATCH", undefined, csrf))?.status, status);
    assert.equal(f.reads(), 0);
    assert.equal(f.writes(), 0);
    assert.equal(f.events[0].eventType, event);
    assert.equal(JSON.stringify(f.events).includes(token), false);
  }
  assert.equal((await fixture("observer").call("GET"))?.status, 200);
});

test("target confirmation, mode, observed positive version and bounded safe reason are required", async () => {
  const valid = { targetEnvironment: "preview", mode: "read-only", expectedVersion: 1, reason: "Containment" };
  for (const invalid of [null, [], { ...valid, targetEnvironment: "production" }, { ...valid, mode: "unknown" },
    ...[undefined, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER].map(expectedVersion => ({ ...valid, expectedVersion })),
    ...[undefined, "", "  ", "secret\nline", "x".repeat(201)].map(reason => ({ ...valid, reason }))]) {
    const f = fixture();
    assert.equal((await f.call("PATCH", invalid))?.status, 400);
    assert.equal(f.reads(), 0);
    assert.equal(f.writes(), 0);
  }
});

test("stale caller and concurrent update reject without retry, refresh or overwrite", async () => {
  const f = fixture();
  assert.equal((await f.call())?.status, 200);
  const first = { ...f.state() };
  assert.equal((await f.call())?.status, 409);
  assert.deepEqual(f.state(), first);
  assert.equal(f.writes(), 1);
  const racing = fixture();
  let passedVersion: number | undefined;
  const store: OperationModeStore = { read: () => racing.store.read(), update: async input => {
    passedVersion = input.expectedVersion;
    await racing.store.update({ mode: "read-only", expectedVersion: 1, updatedBy: "other-operator", reason: "Other change" });
    return racing.store.update(input);
  } };
  assert.equal((await racing.call("PATCH", undefined, true, { ...racing.options, store }))?.status, 409);
  assert.equal(passedVersion, 1);
  assert.equal(racing.state().mode, "read-only");
  assert.equal(racing.state().updatedBy, "other-operator");
  assert.equal(racing.audits[0].reason, "conflict");
});

test("invalid/mismatched or unavailable Store fails closed with no diagnostics", async () => {
  for (const broken of [async () => { throw new Error("private SQL diagnostics"); },
    async () => ({ ...initial(), environment: "production" as const }),
    async () => ({ ...initial(), version: 0 }),
    async () => ({ ...initial(), mode: "unknown" as OperationModeState["mode"] })]) {
    const f = fixture();
    const store = { ...f.store, read: broken };
    const response = await f.call("PATCH", undefined, true, { ...f.options, store });
    assert.equal(response?.status, 503);
    assert.equal(f.writes(), 0);
    assert.equal((await response!.text()).includes("private"), false);
  }
  const f = fixture();
  assert.equal((await f.call("PATCH", undefined, true, { ...f.options,
    store: { ...f.store, update: async () => { throw new Error("SQL failure"); } } }))?.status, 503);
  assert.equal(f.audits[0].reason, "dependency_failure");
});

test("rate limiter and telemetry failures cannot permit rejected writes", async () => {
  const f = fixture();
  const options = { ...f.options, rateLimitPolicy: { endpointId: "mode", limit: 1, windowSeconds: 60 },
    securityEventSink: () => { throw new Error("telemetry failure"); } };
  assert.equal((await f.call("GET", undefined, true, options))?.status, 200);
  const response = await f.call("PATCH", undefined, true, options);
  assert.equal(response?.status, 429);
  assert.ok(response?.headers.get("retry-after"));
  assert.equal(f.writes(), 0);
  const success = fixture();
  const response2 = await handleOperationModeApi(new Request("https://example.test/api/admin/operation-mode", {
    method: "PATCH", headers: { cookie: `app_session=${token}`, "x-csrf-token": await deriveCsrfToken(token),
      "content-type": "application/json" }, body: JSON.stringify({ targetEnvironment: "preview", mode: "read-only",
        expectedVersion: 1, reason: "Controlled change" }) }),
  { prepare(sql: string) { return { bind() { return { async first() {
    return sql.includes("FROM application_sessions") ? { id: "operator", displayName: null,
      expiresAt: "2099-01-01T00:00:00Z", lastSeenAt: new Date().toISOString() }
      : { scopeId: "preview-control", userId: "operator", role: "operator" };
  } }; } }; } } as unknown as D1Database,
  () => { throw new Error("audit unavailable"); }, "mode-request", success.options);
  assert.equal(response2?.status, 200);
  assert.equal(success.state().mode, "read-only");
});

test("Audit projection drops extra fields and invalid operation metadata", () => {
  const f = { requestId: "r", method: "PATCH", path: "/api/admin/operation-mode", category: "system", action: "operation_mode.update",
    outcome: "success", operationModeChange: { environment: "preview", beforeMode: "normal", afterMode: "maintenance",
      beforeVersion: 1, afterVersion: 2, reason: "Containment", token: "must-not-serialize" } } as AuditEvent;
  const record = toStructuredAuditRecord(f, "2026-10-02T00:00:00Z");
  assert.equal(JSON.stringify(record).includes("must-not-serialize"), false);
  for (const patch of [{ afterVersion: 3 }, { environment: "unknown" }, { beforeMode: "unknown" }, { reason: "bad\nreason" }]) {
    assert.equal(toStructuredAuditRecord({ ...f, operationModeChange: { ...f.operationModeChange!, ...patch } } as AuditEvent,
      "2026-10-02T00:00:00Z").operationModeChange, undefined);
  }
});
