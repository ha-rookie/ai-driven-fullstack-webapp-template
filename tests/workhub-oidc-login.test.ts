import assert from "node:assert/strict";
import test from "node:test";
import { createOidcLoginTransaction } from "../src/worker/auth";
import {
  handleWorkhubFreeOidc,
  hasPreviewGoogleOidcConfig,
  requiresPreviewExternalIdentity,
  sealOidcTransaction,
  unsealOidcTransaction,
  type FreeOidcEnvironment,
  type FreeOidcHandlerOptions,
} from "../src/worker/workhub-oidc-login";

const ORIGIN = "https://ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";
const SECRET = Buffer.alloc(32, 7).toString("base64url");
const event = { verifications: 0, sessions: 0 };
const env = (status: "active" | "disabled" | "missing" = "active"): FreeOidcEnvironment => ({
  RUNTIME_ENVIRONMENT: "preview",
  WORKHUB_FREE_AUTH_MODE: "google_oidc",
  GOOGLE_OIDC_CLIENT_ID: "local-only-unit-test-client",
  GOOGLE_OIDC_CLIENT_SECRET: "local-only-not-real-secret",
  WORKHUB_OIDC_TRANSACTION_KEY: SECRET,
  DB: {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => sql.includes("external_identities") && status !== "missing"
          ? {
            id: "workhub-demo-aoi", displayName: "Aoi Employee", status,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          }
          : null,
        run: async () => {
          if (sql.includes("INSERT INTO application_sessions")) event.sessions += 1;
          return { meta: { changes: 1 } };
        },
      }),
    }),
  } as unknown as D1Database,
});

const fakeOidcProvider = (): NonNullable<FreeOidcHandlerOptions["provider"]> => ({
  createAuthorizationRequest: async (_redirectUri: string) => {
    const transaction = await createOidcLoginTransaction();
    return {
      url: "https://accounts.example.test/auth?state=" + transaction.state,
      transaction,
    };
  },
  verify: async (credential) => {
    event.verifications += 1;
    assert.equal(credential.returnedState, credential.expectedState);
    assert.equal(credential.redirectUri, ORIGIN + "/api/auth/oidc/callback");
    return { provider: "google", subject: "linked-google-subject", displayName: "Test" };
  },
});

const begin = async (source = env()) => {
  const start = await handleWorkhubFreeOidc(
    new Request(ORIGIN + "/api/auth/oidc/start"),
    source, "test-request-1", { provider: fakeOidcProvider() },
  );
  assert.equal(start?.status, 302);
  const state = new URL(start?.headers.get("location") || "").searchParams.get("state");
  const cookie = start?.headers.get("set-cookie")?.split(";")[0];
  assert.ok(state);
  assert.ok(cookie?.startsWith("__Host-workhub_oidc_transaction="));
  assert.ok(start?.headers.get("set-cookie")?.includes("HttpOnly; Secure; SameSite=Lax"));
  return { state, cookie };
};

const callback = (state: string, cookie: string, source = env(), now?: number) =>
  handleWorkhubFreeOidc(new Request(
    ORIGIN + "/api/auth/oidc/callback?code=fake-valid-code&state=" + state,
    { headers: { cookie } },
  ), source, "test-request-2", {
    provider: fakeOidcProvider(),
    ...(now === undefined ? {} : { now: () => now }),
  });

test("External OIDC Preview mode is explicitly gated and never inferred", () => {
  assert.equal(requiresPreviewExternalIdentity(env()), true);
  assert.equal(hasPreviewGoogleOidcConfig(env()), true);
  assert.equal(requiresPreviewExternalIdentity({ ...env(), RUNTIME_ENVIRONMENT: "production" }), false);
  assert.equal(requiresPreviewExternalIdentity({ ...env(), WORKHUB_FREE_AUTH_MODE: undefined }), false);
  assert.equal(hasPreviewGoogleOidcConfig({ ...env(), WORKHUB_OIDC_TRANSACTION_KEY: undefined }), false);
});

test("Free Preview external sign-in issues only linked active-user opaque application sessions", async () => {
  event.verifications = 0;
  event.sessions = 0;
  const { state, cookie } = await begin();
  const response = await callback(state, cookie);
  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("location"), "/");
  const cookies = response?.headers.getSetCookie() ?? [];
  assert.ok(cookies.some((item) => item.includes("app_session=") && item.includes("HttpOnly")));
  assert.ok(cookies.some((item) => item.startsWith("__Host-workhub_oidc_transaction=;")));
  assert.equal(event.verifications, 1);
  assert.equal(event.sessions, 1);
});

test("Missing or disabled provider-subject mapping fails closed without session", async () => {
  for (const status of ["disabled", "missing"] as const) {
    event.sessions = 0;
    const { state, cookie } = await begin();
    const response = await callback(state, cookie, env(status));
    assert.equal(response?.status, 403);
    assert.equal(event.sessions, 0);
    assert.ok(response?.headers.getSetCookie().some((item) =>
      item.startsWith("__Host-workhub_oidc_transaction=;")));
  }
});

test("State mismatch is rejected before contacting token endpoint", async () => {
  event.verifications = 0;
  const { cookie } = await begin();
  const response = await callback("wrong-state-no-provider-call", cookie);
  assert.equal(response?.status, 401);
  assert.equal(event.verifications, 0);
});

test("Missing cookie and tampered cookie fail closed", async () => {
  const { state, cookie } = await begin();
  assert.equal((await callback(state, ""))?.status, 401);
  assert.equal((await callback(state, cookie.slice(0, -3) + "AAA"))?.status, 401);
});

test("Callback transaction is authenticated, expires after 5 minutes, and rejects wrong keys", async () => {
  const tx = await createOidcLoginTransaction({ now: () => new Date("2026-10-11T00:00:00.000Z") });
  const sealed = await sealOidcTransaction(tx, SECRET);
  assert.equal((await unsealOidcTransaction(
    sealed, SECRET, Date.parse("2026-10-11T00:04:59.000Z"),
  )).state, tx.state);
  await assert.rejects(
    unsealOidcTransaction(sealed, SECRET, Date.parse("2026-10-11T00:05:01.000Z")),
    /expired_oidc_transaction/u,
  );
  await assert.rejects(
    unsealOidcTransaction(sealed, Buffer.alloc(32, 9).toString("base64url")),
  );
});

test("No external endpoints in Production or on wrong origin; no credential fallback", async () => {
  assert.equal((await handleWorkhubFreeOidc(
    new Request(ORIGIN + "/api/auth/oidc/start"),
    { ...env(), RUNTIME_ENVIRONMENT: "production" }, "test-request",
  ))?.status, 404);
  assert.equal((await handleWorkhubFreeOidc(
    new Request("https://other.example.com/api/auth/oidc/start"), env(), "test-request",
  ))?.status, 404);
  assert.equal((await handleWorkhubFreeOidc(
    new Request(ORIGIN + "/api/auth/oidc/start"), {
      ...env(), GOOGLE_OIDC_CLIENT_SECRET: undefined,
    }, "test-request",
  ))?.status, 503);
});
