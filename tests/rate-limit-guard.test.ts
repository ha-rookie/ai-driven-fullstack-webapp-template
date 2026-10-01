import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalRateLimitStore,
  RateLimitConfigurationError,
  RateLimitGuard,
  RateLimitStoreError,
  rateLimitRejectionAuditFields,
  rateLimitRejectionResponse,
  type RateLimitStore,
} from "../src/worker/http";

const mutableClock = (initialIso: string) => {
  let nowMs = new Date(initialIso).getTime();
  return {
    clock: { now: () => new Date(nowMs) },
    set: (iso: string) => {
      nowMs = new Date(iso).getTime();
    },
  };
};

const policy = {
  endpointId: "auth_csrf",
  limit: 2,
  windowSeconds: 60,
} as const;

test("allows through the configured limit and rejects the next request", async () => {
  const time = mutableClock("2026-09-30T08:00:10.000Z");
  const guard = new RateLimitGuard(new LocalRateLimitStore(), time.clock);
  const input = {
    policy,
    subject: { kind: "ip", id: "203.0.113.10" } as const,
  };

  const first = await guard.check(input);
  const second = await guard.check(input);
  const third = await guard.check(input);

  assert.deepEqual(first, {
    kind: "allow",
    limit: 2,
    remaining: 1,
    resetAtEpochSeconds: new Date("2026-09-30T08:01:00.000Z").getTime() / 1_000,
  });
  assert.equal(second.kind, "allow");
  assert.equal(second.remaining, 0);
  assert.equal(third.kind, "reject");
  if (third.kind !== "reject") assert.fail("expected reject decision");
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterSeconds, 50);
});

test("endpoint and subject dimension use independent buckets", async () => {
  const time = mutableClock("2026-09-30T08:00:10.000Z");
  const guard = new RateLimitGuard(new LocalRateLimitStore(), time.clock);
  const strict = { ...policy, limit: 1 };

  await guard.check({
    policy: strict,
    subject: { kind: "actor", id: "user-1" },
  });
  const actorRejected = await guard.check({
    policy: strict,
    subject: { kind: "actor", id: "user-1" },
  });
  const sameIdAsIp = await guard.check({
    policy: strict,
    subject: { kind: "ip", id: "user-1" },
  });
  const otherEndpoint = await guard.check({
    policy: { ...strict, endpointId: "auth_logout" },
    subject: { kind: "actor", id: "user-1" },
  });

  assert.equal(actorRejected.kind, "reject");
  assert.equal(sameIdAsIp.kind, "allow");
  assert.equal(otherEndpoint.kind, "allow");
});

test("a new fixed window resets the count and local store expires old buckets", async () => {
  const time = mutableClock("2026-09-30T08:00:59.000Z");
  const store = new LocalRateLimitStore();
  const guard = new RateLimitGuard(store, time.clock);
  const input = {
    policy: { ...policy, limit: 1 },
    subject: { kind: "ip", id: "2001:db8::1" } as const,
  };

  assert.equal((await guard.check(input)).kind, "allow");
  assert.equal((await guard.check(input)).kind, "reject");
  assert.equal(store.size, 1);

  time.set("2026-09-30T08:01:00.000Z");
  const nextWindow = await guard.check(input);
  assert.equal(nextWindow.kind, "allow");
  assert.equal(store.size, 1);
});

test("storage key is opaque and does not persist raw actor or IP subject IDs", async () => {
  const keys: string[] = [];
  const store: RateLimitStore = {
    increment(input) {
      keys.push(input.key);
      return Promise.resolve(1);
    },
  };
  const guard = new RateLimitGuard(
    store,
    mutableClock("2026-09-30T08:00:00.000Z").clock,
  );

  await guard.check({
    policy,
    subject: { kind: "actor", id: "user-sensitive-123" },
  });
  await guard.check({
    policy,
    subject: { kind: "ip", id: "203.0.113.99" },
  });

  assert.equal(keys.length, 2);
  assert.match(keys[0], /^rate-limit:v1:auth_csrf:actor:[a-f0-9]{64}:/);
  assert.match(keys[1], /^rate-limit:v1:auth_csrf:ip:[a-f0-9]{64}:/);
  assert.equal(keys.join("|").includes("user-sensitive-123"), false);
  assert.equal(keys.join("|").includes("203.0.113.99"), false);
});

test("reject maps to the existing API envelope with Retry-After", async () => {
  const time = mutableClock("2026-09-30T08:00:10.000Z");
  const guard = new RateLimitGuard(new LocalRateLimitStore(), time.clock);
  const input = {
    policy: { ...policy, limit: 1 },
    subject: { kind: "ip", id: "203.0.113.10" } as const,
  };

  await guard.check(input);
  const decision = await guard.check(input);
  assert.equal(decision.kind, "reject");
  if (decision.kind !== "reject") assert.fail("expected reject decision");

  const response = rateLimitRejectionResponse(decision, "request-123");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "50");
  assert.equal(response.headers.get("x-request-id"), "request-123");
  assert.deepEqual(await response.json(), {
    error: { code: "rate_limited", message: "Too many requests" },
    requestId: "request-123",
  });
});

test("audit fields record actor rejection without exposing IP or storage key", () => {
  const actorFields = rateLimitRejectionAuditFields({
    policy,
    subject: { kind: "actor", id: "user-1" },
  });
  assert.deepEqual(actorFields, {
    category: "system",
    action: "rate_limit_guard",
    outcome: "failure",
    actorId: "user-1",
    resourceType: "http_endpoint",
    resourceId: "auth_csrf",
    reason: "actor_rate_limited",
  });

  const ipFields = rateLimitRejectionAuditFields({
    policy,
    subject: { kind: "ip", id: "203.0.113.10" },
  });
  assert.deepEqual(ipFields, {
    category: "system",
    action: "rate_limit_guard",
    outcome: "failure",
    resourceType: "http_endpoint",
    resourceId: "auth_csrf",
    reason: "ip_rate_limited",
  });
  assert.equal(JSON.stringify(ipFields).includes("203.0.113.10"), false);
});

test("invalid policy and subject identifiers fail before store access", async () => {
  let calls = 0;
  const store: RateLimitStore = {
    increment() {
      calls += 1;
      return Promise.resolve(1);
    },
  };
  const guard = new RateLimitGuard(store);

  await assert.rejects(
    () =>
      guard.check({
        policy: { endpointId: "bad endpoint", limit: 1, windowSeconds: 60 },
        subject: { kind: "ip", id: "203.0.113.10" },
      }),
    RateLimitConfigurationError,
  );
  await assert.rejects(
    () =>
      guard.check({
        policy: { endpointId: "auth_login", limit: 0, windowSeconds: 60 },
        subject: { kind: "ip", id: "203.0.113.10" },
      }),
    RateLimitConfigurationError,
  );
  await assert.rejects(
    () =>
      guard.check({
        policy,
        subject: { kind: "actor", id: "user id with spaces" },
      }),
    RateLimitConfigurationError,
  );
  assert.equal(calls, 0);
});

test("store failures propagate and invalid counts are rejected", async () => {
  const unavailable = new RateLimitGuard({
    increment() {
      return Promise.reject(new Error("shared store unavailable"));
    },
  });
  await assert.rejects(
    () =>
      unavailable.check({
        policy,
        subject: { kind: "ip", id: "203.0.113.10" },
      }),
    /shared store unavailable/,
  );

  const invalid = new RateLimitGuard({
    increment() {
      return Promise.resolve(0);
    },
  });
  await assert.rejects(
    () =>
      invalid.check({
        policy,
        subject: { kind: "ip", id: "203.0.113.10" },
      }),
    RateLimitStoreError,
  );
});
