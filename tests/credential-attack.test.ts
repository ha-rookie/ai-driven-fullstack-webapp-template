import assert from "node:assert/strict";
import test from "node:test";

import {
  CredentialAttackConfigurationError,
  CredentialAttackGuard,
  InMemoryCredentialAttackStore,
  createCredentialAttackStoreKey,
  credentialAttackRejectionResponse,
  fromCredentialAttackRejection,
  securityRejectionAuditEvent,
  securityRejectionLogContext,
  type CredentialAttackPolicy,
} from "../src/worker/security";

const policy: CredentialAttackPolicy = {
  endpointId: "auth.login",
  failureThreshold: 3,
  windowSeconds: 300,
  lockSeconds: 120,
};

const identifier = { dimension: "identifier" as const, value: " User@Example.COM " };
const network = { dimension: "network" as const, value: "203.0.113.10" };

const mutableClock = (initial: string) => {
  let current = new Date(initial);
  return {
    now: () => new Date(current),
    advanceSeconds: (seconds: number) => {
      current = new Date(current.getTime() + seconds * 1_000);
    },
  };
};

test("repeated credential failures reach a temporary lock at the configured threshold", async () => {
  const clock = mutableClock("2026-10-04T00:00:00.000Z");
  const guard = new CredentialAttackGuard(new InMemoryCredentialAttackStore(), "test", clock);

  assert.deepEqual(await guard.check(policy, identifier), { kind: "allow", failureCount: 0 });
  assert.deepEqual(await guard.recordFailure(policy, identifier), { kind: "allow", failureCount: 1 });
  assert.deepEqual(await guard.recordFailure(policy, identifier), { kind: "allow", failureCount: 2 });
  const locked = await guard.recordFailure(policy, identifier);

  assert.equal(locked.kind, "reject");
  if (locked.kind === "reject") {
    assert.equal(locked.failureCount, 3);
    assert.equal(locked.retryAfterSeconds, 120);
    assert.equal(locked.lockedUntil, "2026-10-04T00:02:00.000Z");
  }
  assert.equal((await guard.check(policy, identifier)).kind, "reject");
});

test("expired temporary lock starts a fresh failure window rather than becoming permanent", async () => {
  const clock = mutableClock("2026-10-04T00:00:00.000Z");
  const guard = new CredentialAttackGuard(new InMemoryCredentialAttackStore(), "test", clock);

  await guard.recordFailure(policy, identifier);
  await guard.recordFailure(policy, identifier);
  assert.equal((await guard.recordFailure(policy, identifier)).kind, "reject");

  clock.advanceSeconds(121);
  assert.deepEqual(await guard.check(policy, identifier), { kind: "allow", failureCount: 3 });
  assert.deepEqual(await guard.recordFailure(policy, identifier), { kind: "allow", failureCount: 1 });
});

test("failure window expiry also resets the counter", async () => {
  const clock = mutableClock("2026-10-04T00:00:00.000Z");
  const guard = new CredentialAttackGuard(new InMemoryCredentialAttackStore(), "test", clock);

  await guard.recordFailure(policy, identifier);
  await guard.recordFailure(policy, identifier);
  clock.advanceSeconds(301);
  assert.deepEqual(await guard.recordFailure(policy, identifier), { kind: "allow", failureCount: 1 });
});

test("successful authentication can clear identifier failure state without clearing network state", async () => {
  const clock = mutableClock("2026-10-04T00:00:00.000Z");
  const store = new InMemoryCredentialAttackStore();
  const guard = new CredentialAttackGuard(store, "test", clock);

  await guard.recordFailure(policy, identifier);
  await guard.recordFailure(policy, network);
  await guard.recordSuccess(policy, identifier);

  assert.deepEqual(await guard.check(policy, identifier), { kind: "allow", failureCount: 0 });
  assert.deepEqual(await guard.check(policy, network), { kind: "allow", failureCount: 1 });
});

test("identifier and network subjects become opaque environment-scoped hashes", async () => {
  const identifierKey = await createCredentialAttackStoreKey("preview", policy, identifier);
  const sameIdentifierKey = await createCredentialAttackStoreKey(
    "preview",
    policy,
    { dimension: "identifier", value: "User@Example.COM" },
  );
  const productionKey = await createCredentialAttackStoreKey("production", policy, identifier);
  const networkKey = await createCredentialAttackStoreKey("preview", policy, network);

  assert.equal(identifierKey.subjectHash.length, 64);
  assert.equal(identifierKey.subjectHash, sameIdentifierKey.subjectHash);
  assert.notEqual(identifierKey.subjectHash, networkKey.subjectHash);
  assert.equal(identifierKey.environment, "preview");
  assert.equal(productionKey.environment, "production");
  assert.equal(JSON.stringify(identifierKey).includes("User@Example.COM"), false);
  assert.equal(JSON.stringify(networkKey).includes("203.0.113.10"), false);
});

test("throttle response is generic and does not disclose account existence", async () => {
  const clock = mutableClock("2026-10-04T00:00:00.000Z");
  const guard = new CredentialAttackGuard(new InMemoryCredentialAttackStore(), "test", clock);
  await guard.recordFailure(policy, identifier);
  await guard.recordFailure(policy, identifier);
  const decision = await guard.recordFailure(policy, identifier);
  assert.equal(decision.kind, "reject");
  if (decision.kind !== "reject") throw new Error("expected rejection");

  const response = credentialAttackRejectionResponse(decision, "request-1");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "120");
  const body = await response.text();
  assert.match(body, /authentication_temporarily_limited/u);
  assert.doesNotMatch(body, /User@Example\.COM|exists|missing/u);
});

test("security rejection event contains endpoint metadata but no credential control subject", () => {
  const decision = {
    kind: "reject" as const,
    failureCount: 3,
    retryAfterSeconds: 120,
    lockedUntil: "2026-10-04T00:02:00.000Z",
  };
  const event = fromCredentialAttackRejection(decision, policy.endpointId, {
    requestId: "request-1",
    method: "POST",
    path: "/api/auth/login",
    timestamp: new Date("2026-10-04T00:00:00.000Z"),
  });

  assert.deepEqual(event, {
    eventType: "credential_attack_rejected",
    reasonCode: "credential_attempt_throttled",
    outcome: "rejected",
    timestamp: "2026-10-04T00:00:00.000Z",
    requestId: "request-1",
    method: "POST",
    path: "/api/auth/login",
    resourceType: "credential_endpoint",
    resourceId: "auth.login",
  });
  const serialized = JSON.stringify({
    event,
    audit: securityRejectionAuditEvent(event),
    log: securityRejectionLogContext(event),
  });
  assert.doesNotMatch(serialized, /User@Example\.COM|203\.0\.113\.10|subjectHash/u);
});

test("invalid credential attack policies and subjects fail closed", async () => {
  const guard = new CredentialAttackGuard(new InMemoryCredentialAttackStore(), "test");
  await assert.rejects(
    () => guard.check({ ...policy, failureThreshold: 0 }, identifier),
    CredentialAttackConfigurationError,
  );
  await assert.rejects(
    () => guard.check(policy, { dimension: "identifier", value: "bad\nidentifier" }),
    CredentialAttackConfigurationError,
  );
});
