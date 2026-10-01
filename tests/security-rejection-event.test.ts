import assert from "node:assert/strict";
import test from "node:test";

import {
  fromAuthenticationFailure,
  fromAuthorizationFailure,
  fromCsrfFailure,
  fromOriginRejection,
  fromRateLimitRejection,
  securityRejectionAuditEvent,
  securityRejectionLogContext,
} from "../src/worker/security";

const context = {
  requestId: "req-123",
  method: "POST",
  path: "/api/example-resources/resource-1",
  timestamp: new Date("2026-10-02T00:00:00.000Z"),
  scopeId: "scope-1",
  resourceType: "example_resource",
  resourceId: "resource-1",
} as const;

test("authentication rejection maps to a safe common event", () => {
  const event = fromAuthenticationFailure(
    {
      allowed: false,
      status: 401,
      code: "authentication_required",
      message: "Authentication required",
      reason: "session_missing_or_invalid",
    },
    context,
  );

  assert.equal(event.eventType, "authentication_rejected");
  assert.equal(event.reasonCode, "session_missing_or_invalid");
  assert.equal(event.requestId, "req-123");
  assert.equal(event.timestamp, "2026-10-02T00:00:00.000Z");
});

test("authorization rejection preserves tracking context without client detail", () => {
  const event = fromAuthorizationFailure(
    {
      allowed: false,
      status: 403,
      code: "forbidden",
      message: "Access denied",
      reason: "membership_required",
    },
    { ...context, actorId: "user-1" },
  );

  assert.equal(event.eventType, "authorization_rejected");
  assert.equal(event.reasonCode, "authorization_denied");
  assert.equal(event.actorId, "user-1");
  assert.equal(event.scopeId, "scope-1");
});

test("CSRF and Origin rejections use bounded reason codes", () => {
  const csrf = fromCsrfFailure(
    {
      allowed: false,
      status: 403,
      code: "csrf_failed",
      message: "CSRF validation failed",
      reason: "csrf_proof_missing_or_invalid",
    },
    context,
  );
  const origin = fromOriginRejection("origin_not_allowed", context);

  assert.equal(csrf.reasonCode, "csrf_proof_missing_or_invalid");
  assert.equal(origin.eventType, "origin_rejected");
  assert.equal(origin.reasonCode, "origin_not_allowed");
});

test("rate limit adapter does not expose IP subject identifiers", () => {
  const event = fromRateLimitRejection(
    {
      kind: "reject",
      limit: 10,
      remaining: 0,
      resetAtEpochSeconds: 100,
      retryAfterSeconds: 30,
    },
    {
      policy: { endpointId: "login", limit: 10, windowSeconds: 60 },
      subject: { kind: "ip", id: "203.0.113.10" },
    },
    context,
  );

  assert.equal(event.eventType, "rate_limit_rejected");
  assert.equal(event.reasonCode, "rate_limited");
  assert.equal(event.actorId, undefined);
  assert.equal(event.resourceType, "example_resource");
  assert.equal(JSON.stringify(event).includes("203.0.113.10"), false);
});

test("common event maps safely to Audit and Application Log contexts", () => {
  const event = fromOriginRejection("invalid_origin", {
    ...context,
    actorId: "user-1",
    sessionId: "session-1",
  });

  const audit = securityRejectionAuditEvent(event);
  const logContext = securityRejectionLogContext(event);

  assert.equal(audit.category, "system");
  assert.equal(audit.action, "origin_rejected");
  assert.equal(audit.outcome, "failure");
  assert.equal(audit.reason, "invalid_origin");
  assert.equal(logContext.kind, "security_rejection");
  assert.equal(logContext.sessionId, "session-1");

  const serialized = JSON.stringify({ audit, logContext });
  assert.equal(serialized.includes("cookie"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("token"), false);
});
