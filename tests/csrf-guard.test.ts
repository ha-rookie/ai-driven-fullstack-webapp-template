import assert from "node:assert/strict";
import test from "node:test";

import {
  csrfGuardFailureResponse,
  deriveCsrfToken,
  issueCsrfTokenForRequest,
  requireCsrfProtection,
} from "../src/worker/http";

const requestWithSession = (
  method: string,
  sessionToken: string,
  csrfToken?: string,
) =>
  new Request("https://app.example.com/api/resource", {
    method,
    headers: {
      cookie: `app_session=${sessionToken}`,
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
  });

test("safe methods do not require CSRF proof", async () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const result = await requireCsrfProtection(
      requestWithSession(method, "safe-session-token"),
    );
    assert.deepEqual(result, { allowed: true, reason: "safe_method" });
  }
});

test("mutation without an application session cookie is left to authentication", async () => {
  const result = await requireCsrfProtection(
    new Request("https://app.example.com/api/resource", { method: "PATCH" }),
  );

  assert.deepEqual(result, {
    allowed: true,
    reason: "session_cookie_absent",
  });
});

test("missing, malformed, and mismatched proofs fail with one public contract", async () => {
  const missing = await requireCsrfProtection(
    requestWithSession("PATCH", "session-token-a"),
  );
  const malformed = await requireCsrfProtection(
    requestWithSession("PATCH", "session-token-a", "not-a-token"),
  );
  const otherSessionProof = await deriveCsrfToken("session-token-b");
  const mismatched = await requireCsrfProtection(
    requestWithSession("PATCH", "session-token-a", otherSessionProof),
  );

  for (const result of [missing, malformed, mismatched]) {
    assert.equal(result.allowed, false);
    if (result.allowed) continue;
    assert.equal(result.status, 403);
    assert.equal(result.code, "csrf_failed");
    assert.equal(result.message, "CSRF validation failed");
    assert.equal(result.reason, "csrf_proof_missing_or_invalid");
  }
});

test("valid session-bound proof allows a mutation", async () => {
  const sessionToken = "session-token-a";
  const csrfToken = await deriveCsrfToken(sessionToken);
  const result = await requireCsrfProtection(
    requestWithSession("POST", sessionToken, csrfToken),
  );

  assert.deepEqual(result, { allowed: true, reason: "valid_proof" });
});

test("CSRF proof is stable per session and changes with the session token", async () => {
  const first = await deriveCsrfToken("session-token-a");
  const repeated = await deriveCsrfToken("session-token-a");
  const rotated = await deriveCsrfToken("session-token-b");

  assert.match(first, /^v1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, rotated);
});

test("token issue helper derives proof from the HttpOnly application session cookie value", async () => {
  const request = requestWithSession("GET", "session-token-a");
  assert.equal(
    await issueCsrfTokenForRequest(request),
    await deriveCsrfToken("session-token-a"),
  );
  assert.equal(
    await issueCsrfTokenForRequest(
      new Request("https://app.example.com/api/auth/csrf"),
    ),
    null,
  );
});

test("CSRF failure response uses the standard error envelope without proof detail", async () => {
  const failure = await requireCsrfProtection(
    requestWithSession("DELETE", "session-token-a"),
  );
  assert.equal(failure.allowed, false);
  if (failure.allowed) return;

  const response = csrfGuardFailureResponse(failure, "csrf-request-1");
  const body = (await response.json()) as {
    error: { code: string; message: string };
    requestId: string;
  };

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-request-id"), "csrf-request-1");
  assert.deepEqual(body, {
    error: {
      code: "csrf_failed",
      message: "CSRF validation failed",
    },
    requestId: "csrf-request-1",
  });
  assert.equal(JSON.stringify(body).includes("session-token-a"), false);
  assert.equal(JSON.stringify(body).includes("csrf_proof_missing_or_invalid"), false);
});
