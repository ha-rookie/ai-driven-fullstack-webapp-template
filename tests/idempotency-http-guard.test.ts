import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreateIdempotencyRecordResult,
  IdempotencyRecord,
  TransitionIdempotencyRecordResult,
} from "../src/infrastructure/d1-idempotency-store";
import { createFixedClock } from "../src/shared/runtime";
import {
  IdempotencyHttpGuard,
  fingerprintIdempotentRequest,
  idempotencyAuditFields,
  idempotencyRejectionResponse,
  type IdempotencyHttpStore,
} from "../src/worker/http/idempotency";

const fixedNow = "2026-10-02T00:00:00.000Z";

const mutationRequest = (
  key: string | null,
  body = JSON.stringify({ name: "Example" }),
): Request => {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("idempotency-key", key);
  return new Request("https://example.test/api/scopes/scope-1/resources?mode=full", {
    method: "POST",
    headers,
    body,
  });
};

const record = (overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord => ({
  key: "key-1",
  actorId: "user-1",
  scopeId: "scope-1",
  action: "resource.create",
  fingerprint: "fingerprint",
  state: "in_progress",
  createdAt: fixedNow,
  updatedAt: fixedNow,
  expiresAt: "2026-10-03T00:00:00.000Z",
  ...overrides,
});

const fakeStore = (
  createResult?: CreateIdempotencyRecordResult,
): {
  store: IdempotencyHttpStore;
  creates: Array<Record<string, unknown>>;
  completes: Array<Record<string, unknown>>;
  fails: Array<Record<string, unknown>>;
} => {
  const creates: Array<Record<string, unknown>> = [];
  const completes: Array<Record<string, unknown>> = [];
  const fails: Array<Record<string, unknown>> = [];

  const store: IdempotencyHttpStore = {
    async create(input) {
      creates.push({ ...input });
      if (createResult) return createResult;
      return {
        kind: "created",
        record: record({
          key: input.key,
          actorId: input.actorId,
          scopeId: input.scopeId,
          action: input.action,
          fingerprint: input.fingerprint,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          expiresAt: input.expiresAt,
        }),
      };
    },
    async complete(input): Promise<TransitionIdempotencyRecordResult> {
      completes.push({ ...input });
      return { kind: "updated", record: record({ state: "completed" }) };
    },
    async fail(input): Promise<TransitionIdempotencyRecordResult> {
      fails.push({ ...input });
      return { kind: "updated", record: record({ state: "failed" }) };
    },
  };

  return { store, creates, completes, fails };
};

const beginInput = (request: Request) => ({
  request,
  actorId: "user-1",
  scopeId: "scope-1",
  action: "resource.create",
});

test("missing Idempotency-Key is rejected before Store access", async () => {
  const { store, creates } = fakeStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(mutationRequest(null)));

  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") {
    assert.equal(decision.reason, "missing_key");
    assert.equal(decision.status, 400);
    assert.equal(decision.code, "idempotency_key_required");
  }
  assert.equal(creates.length, 0);
});

test("unsafe Idempotency-Key is rejected", async () => {
  const { store, creates } = fakeStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(mutationRequest("bad key!")));

  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.reason, "invalid_key");
  assert.equal(creates.length, 0);
});

test("request fingerprint is deterministic and body-sensitive", async () => {
  const first = await fingerprintIdempotentRequest(mutationRequest("key-1"));
  const second = await fingerprintIdempotentRequest(mutationRequest("key-2"));
  const changed = await fingerprintIdempotentRequest(
    mutationRequest("key-1", JSON.stringify({ name: "Changed" })),
  );

  assert.equal(first.length, 64);
  assert.equal(first, second, "Idempotency-Key must not affect request fingerprint");
  assert.notEqual(first, changed);
});

test("new key proceeds and stores bounded context with expiry", async () => {
  const { store, creates } = fakeStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(mutationRequest("key-1")));

  assert.equal(decision.kind, "proceed");
  assert.equal(creates.length, 1);
  assert.equal(creates[0].key, "key-1");
  assert.equal(creates[0].actorId, "user-1");
  assert.equal(creates[0].scopeId, "scope-1");
  assert.equal(creates[0].action, "resource.create");
  assert.equal(creates[0].createdAt, fixedNow);
  assert.equal(creates[0].expiresAt, "2026-10-03T00:00:00.000Z");
});

test("same in-progress request is rejected with retry hint", async () => {
  const request = mutationRequest("key-1");
  const fingerprint = await fingerprintIdempotentRequest(request);
  const { store } = fakeStore({
    kind: "existing",
    record: record({ fingerprint, state: "in_progress" }),
  });
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(request));

  assert.equal(decision.kind, "reject");
  if (decision.kind !== "reject") return;
  assert.equal(decision.reason, "in_progress");
  assert.equal(decision.replayable, false);
  const response = idempotencyRejectionResponse(decision, "req-1");
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("x-request-id"), "req-1");
});

test("completed request is not re-executed before response replay exists", async () => {
  const request = mutationRequest("key-1");
  const fingerprint = await fingerprintIdempotentRequest(request);
  const { store } = fakeStore({
    kind: "existing",
    record: record({ fingerprint, state: "completed" }),
  });
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(request));

  assert.equal(decision.kind, "reject");
  if (decision.kind !== "reject") return;
  assert.equal(decision.reason, "completed");
  assert.equal(decision.code, "idempotency_completed_no_replay");
  assert.equal(decision.replayable, false);
});

test("failed key is consumed and requires a new key", async () => {
  const request = mutationRequest("key-1");
  const fingerprint = await fingerprintIdempotentRequest(request);
  const { store } = fakeStore({
    kind: "existing",
    record: record({ fingerprint, state: "failed" }),
  });
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(request));

  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.reason, "failed");
});

test("same key/context with a different fingerprint is rejected", async () => {
  const { store } = fakeStore({
    kind: "existing",
    record: record({ fingerprint: "different-fingerprint" }),
  });
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(mutationRequest("key-1")));

  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") {
    assert.equal(decision.reason, "fingerprint_mismatch");
    assert.equal(decision.code, "idempotency_key_reused");
  }
});

test("expired record remains consumed until cleanup and requires a new key", async () => {
  const request = mutationRequest("key-1");
  const fingerprint = await fingerprintIdempotentRequest(request);
  const { store } = fakeStore({
    kind: "existing",
    record: record({
      fingerprint,
      state: "completed",
      expiresAt: "2026-10-01T23:59:59.000Z",
    }),
  });
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const decision = await guard.begin(beginInput(request));

  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.reason, "expired");
});

test("complete and fail preserve execution context and use the clock", async () => {
  const { store, completes, fails } = fakeStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));
  const execution = {
    key: "key-1",
    actorId: "user-1",
    scopeId: "scope-1",
    action: "resource.create",
    fingerprint: "abc123",
  };

  await guard.complete(execution);
  await guard.fail(execution);

  assert.equal(completes[0].changedAt, fixedNow);
  assert.equal(completes[0].fingerprint, "abc123");
  assert.equal(fails[0].changedAt, fixedNow);
  assert.equal(fails[0].key, "key-1");
});

test("audit fields never expose the idempotency key or fingerprint", async () => {
  const { store } = fakeStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));
  const input = beginInput(mutationRequest("secret-key-1"));
  const decision = await guard.begin(input);

  const fields = idempotencyAuditFields(input, decision);
  const serialized = JSON.stringify(fields);

  assert.equal(fields.action, "idempotency_guard");
  assert.equal(fields.actorId, "user-1");
  assert.equal(fields.scopeId, "scope-1");
  assert.doesNotMatch(serialized, /secret-key-1/);
  if (decision.kind === "proceed") {
    assert.doesNotMatch(serialized, new RegExp(decision.execution.fingerprint));
  }
});
