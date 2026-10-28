import assert from "node:assert/strict";
import test from "node:test";
import { hashSessionToken } from "../src/worker/auth/application-session";
import { deriveCsrfToken } from "../src/worker/http/csrf";
import { handleMyPreferencesApi } from "../src/worker/user-preferences-api";
import { InMemoryUserPreferencesStore } from "../src/shared/in-memory-user-preferences-store";
import type { UserPreferencePolicy } from "../src/shared/user-preferences";

const policy: UserPreferencePolicy = {
  locale: { allowed: ["ja-JP", "en-US"], projectDefault: "ja-JP", systemDefault: "ja-JP" },
  timezone: { allowed: ["Asia/Tokyo", "UTC"], projectDefault: "Asia/Tokyo", systemDefault: "UTC" },
  theme: { allowed: ["light", "dark", "system"], projectDefault: "system", systemDefault: "light" },
};
const path = "https://example.test/api/me/preferences";

const fixture = async () => {
  const sessions = new Map<string, { id: string; displayName: string | null; expiresAt: string; lastSeenAt: string }>();
  const addUser = async (token: string, userId: string) => {
    sessions.set(await hashSessionToken(token), {
      id: userId, displayName: null,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  };
  const DB = {
    prepare(statement: string) {
      if (!statement.includes("JOIN users") || !statement.includes("u.status='active'")) {
        throw new Error("Test must use the established active-user session query");
      }
      return { bind(hash: string) {
        return { first: async () => sessions.get(hash) ?? null,
          run: async () => ({ meta: { changes: 1 } }) };
      } };
    },
  } as unknown as D1Database;
  const store = new InMemoryUserPreferencesStore();
  const api = (request: Request, environment = "test", available = true) =>
    handleMyPreferencesApi(request, { DB, RUNTIME_ENVIRONMENT: environment }, "request-preferences", {
      policy, ...(available ? { store } : {}),
    });
  const req = async (token: string | null, method = "GET", payload?: unknown, csrf = true) => {
    const headers: Record<string,string> = {};
    if (token !== null) headers.cookie = `app_session=${token}`;
    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      if (token !== null && csrf) headers["x-csrf-token"] = await deriveCsrfToken(token);
    }
    return new Request(path, { method, headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  };
  return { store, addUser, api, req };
};

test("authenticated GET/PATCH persists and reloads only own validated preferences through an injected reference store", async () => {
  const f = await fixture();
  await f.addUser("alice-token", "alice");
  await f.addUser("bob-token", "bob");
  const initial = await f.api(await f.req("alice-token"));
  assert.equal(initial?.status, 200);
  assert.deepEqual(await initial?.json(), {
    schemaVersion: 1, version: 0, values: { locale: null, timezone: null, theme: null }, updatedAt: null,
  });
  const saved = await f.api(await f.req("alice-token", "PATCH", {
    expectedVersion: 0, patch: { locale: "en-US", timezone: "Asia/Tokyo", theme: "system" },
  }));
  assert.equal(saved?.status, 200);
  const savedBody = await saved?.json() as { version: number; values: Record<string, unknown> };
  assert.equal(savedBody.version, 1);
  assert.equal(savedBody.values.theme, "system");
  assert.equal(saved?.headers.get("cache-control"), "no-store");
  const reloaded = await f.api(await f.req("alice-token"));
  assert.deepEqual(await reloaded?.json(), await saved?.clone().json());
  const other = await f.api(await f.req("bob-token"));
  assert.equal((await other?.json() as { version: number }).version, 0);
  const preview = await f.api(await f.req("alice-token"), "preview");
  assert.equal((await preview?.json() as { version: number }).version, 0);
});

test("invalid session, non-GET/PATCH, unknown userId and invalid environment are rejected", async () => {
  const f = await fixture();
  await f.addUser("alice-token", "alice");
  assert.equal((await f.api(await f.req(null)))?.status, 401);
  assert.equal((await f.api(await f.req("expired-token")))?.status, 401);
  assert.equal((await f.api(await f.req("alice-token", "POST")))?.status, 405);
  assert.equal((await f.api(await f.req("alice-token"), "undefined"))?.status, 503);
  assert.equal((await f.api(await f.req("alice-token"), "test", false))?.status, 503);
  assert.equal(await f.api(new Request("https://example.test/api/auth/me")), null);
  const foreign = await f.api(await f.req("alice-token", "PATCH", {
    userId: "bob", expectedVersion: 0, patch: { theme: "dark" },
  }));
  assert.equal(foreign?.status, 400);
  assert.equal(await f.store.get("bob", "test"), null);
});

test("CSRF, unsupported values, unknown fields and malformed payloads never modify state", async () => {
  const f = await fixture(); await f.addUser("alice-token", "alice");
  assert.equal((await f.api(await f.req("alice-token", "PATCH", {
    expectedVersion: 0, patch: { theme: "dark" },
  }, false)))?.status, 403);
  for (const patch of [
    { timezone: "Mars/Station" }, { theme: "neon" }, { locale: "fr-FR" },
    { role: "admin" }, { token: "test-secret" },
  ]) {
    const response = await f.api(await f.req("alice-token", "PATCH", { expectedVersion: 0, patch }));
    assert.equal(response?.status, 422);
  }
  for (const payload of [
    {}, { expectedVersion: 0.5, patch: { theme: "dark" } },
    { expectedVersion: -1, patch: { theme: "dark" } },
    { expectedVersion: 0, patch: { theme: "dark" }, userId: "bob" },
  ]) {
    assert.equal((await f.api(await f.req("alice-token", "PATCH", payload)))?.status, 400);
  }
  assert.equal(await f.store.get("alice", "test"), null);
});

test("version conflicts reject stale overwrite and an unset value stays distinct from system", async () => {
  const f = await fixture(); await f.addUser("alice-token", "alice");
  // Calls use the actual request with derived session CSRF proof, never a mock bypass.
  const first = await f.api(await f.req("alice-token", "PATCH",
    { expectedVersion: 0, patch: { theme: "system" } }));
  assert.equal(first?.status, 200);
  const stale = await f.api(await f.req("alice-token", "PATCH",
    { expectedVersion: 0, patch: { theme: "dark" } }));
  assert.equal(stale?.status, 409);
  const clear = await f.api(await f.req("alice-token", "PATCH",
    { expectedVersion: 1, patch: { theme: null } }));
  assert.equal(clear?.status, 200);
  const record = await clear?.json() as { version: number; values: { theme: string | null } };
  assert.equal(record.version, 2);
  assert.equal(record.values.theme, null);
  assert.equal((await f.store.get("alice", "test"))?.theme, null);
});
