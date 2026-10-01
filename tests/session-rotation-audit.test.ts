import assert from "node:assert/strict";
import test from "node:test";

import { createSessionRotationAuditEvent } from "../src/worker/audit";

const requestContext = {
  requestId: "rotation-request-1",
  method: "POST",
  path: "/api/auth/example/callback",
};

test("session rotation success audit stays bounded and secret-free", () => {
  const event = createSessionRotationAuditEvent({
    requestContext,
    outcome: "success",
    userId: "user-1",
  });

  assert.deepEqual(event, {
    ...requestContext,
    category: "authentication",
    action: "session_rotate",
    outcome: "success",
    actorId: "user-1",
    resourceType: "application_session",
    resourceId: "user-1",
  });
  assert.equal("token" in event, false);
  assert.equal("tokenHash" in event, false);
  assert.equal("cookie" in event, false);
  assert.equal("setCookie" in event, false);
});

test("session rotation failure audit uses only controlled reason", () => {
  const event = createSessionRotationAuditEvent({
    requestContext,
    outcome: "failure",
    reason: "session_state_changed",
  });

  assert.deepEqual(event, {
    ...requestContext,
    category: "authentication",
    action: "session_rotate",
    outcome: "failure",
    actorId: undefined,
    resourceType: "application_session",
    resourceId: undefined,
    reason: "session_state_changed",
  });
});
