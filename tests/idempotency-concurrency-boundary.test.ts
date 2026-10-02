import assert from "node:assert/strict";
import test from "node:test";

import type {
  IdempotencyRecord,
  TransitionIdempotencyRecordResult,
} from "../src/infrastructure/d1-idempotency-store";
import { createFixedClock } from "../src/shared/runtime";
import {
  IdempotencyHttpGuard,
  idempotencyAuditFields,
  idempotencyReplayResponse,
  type IdempotencyHttpStore,
} from "../src/worker/http/idempotency";

const fixedNow = "2026-10-02T00:00:00.000Z";

const makeRequest = (key: string, name = "Example") =>
  new Request("https://example.test/api/scopes/scope-1/resources", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({ name }),
  });

const input = (request: Request) => ({
  request,
  actorId: "user-1",
  scopeId: "scope-1",
  action: "resource.create",
});

const createAtomicMemoryStore = () => {
  let current: IdempotencyRecord | null = null;

  const updated = (record: IdempotencyRecord): TransitionIdempotencyRecordResult => ({
    kind: "updated",
    record,
  });

  const store: IdempotencyHttpStore = {
    async create(createInput) {
      if (current) return { kind: "existing", record: current };
      current = {
        key: createInput.key,
        actorId: createInput.actorId,
        scopeId: createInput.scopeId,
        action: createInput.action,
        fingerprint: createInput.fingerprint,
        state: "in_progress",
        createdAt: createInput.createdAt,
        updatedAt: createInput.createdAt,
        expiresAt: createInput.expiresAt,
        replay: null,
      };
      return { kind: "created", record: current };
    },
    async complete(transitionInput) {
      if (!current) return { kind: "not_found" };
      current = { ...current, state: "completed", updatedAt: transitionInput.changedAt };
      return updated(current);
    },
    async completeReplayable(transitionInput) {
      if (!current) return { kind: "not_found" };
      current = {
        ...current,
        state: "completed",
        updatedAt: transitionInput.changedAt,
        replay: transitionInput.replay,
      };
      return updated(current);
    },
    async fail(transitionInput) {
      if (!current) return { kind: "not_found" };
      current = { ...current, state: "failed", updatedAt: transitionInput.changedAt };
      return updated(current);
    },
  };

  return {
    store,
    getRecord: () => current,
  };
};

test("concurrent duplicate arrivals execute the business mutation exactly once", async () => {
  const { store, getRecord } = createAtomicMemoryStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));
  let mutationCount = 0;

  const execute = async (requestId: string) => {
    const request = makeRequest("same-key");
    const decision = await guard.begin(input(request));
    if (decision.kind === "proceed") {
      mutationCount += 1;
      await guard.completeWithResponse(
        decision.execution,
        new Response(JSON.stringify({ id: "resource-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
      return { kind: "executed" as const, requestId };
    }
    return { kind: decision.kind, decision, requestId };
  };

  const results = await Promise.all([execute("req-a"), execute("req-b")]);

  assert.equal(mutationCount, 1);
  assert.equal(results.filter((result) => result.kind === "executed").length, 1);
  assert.equal(getRecord()?.state, "completed");
  assert.equal(getRecord()?.replay?.status, 201);

  const retry = await guard.begin(input(makeRequest("same-key")));
  assert.equal(retry.kind, "replay");
  if (retry.kind !== "replay") return;
  const response = idempotencyReplayResponse(retry, "req-retry");
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("x-idempotent-replay"), "true");
  assert.equal(response.headers.get("x-request-id"), "req-retry");
  assert.equal(mutationCount, 1);

  const audit = idempotencyAuditFields(input(makeRequest("same-key")), retry);
  const serialized = JSON.stringify(audit);
  assert.equal(audit.reason, "response_replayed");
  assert.doesNotMatch(serialized, /same-key/);
  assert.doesNotMatch(serialized, /resource-1/);
});

test("concurrent reuse of one key with conflicting fingerprints fails closed", async () => {
  const { store, getRecord } = createAtomicMemoryStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));

  const [first, conflicting] = await Promise.all([
    guard.begin(input(makeRequest("conflict-key", "First"))),
    guard.begin(input(makeRequest("conflict-key", "Second"))),
  ]);

  const decisions = [first, conflicting];
  assert.equal(decisions.filter((decision) => decision.kind === "proceed").length, 1);
  const rejected = decisions.find((decision) => decision.kind === "reject");
  assert.ok(rejected && rejected.kind === "reject");
  if (!rejected || rejected.kind !== "reject") return;
  assert.equal(rejected.reason, "fingerprint_mismatch");
  assert.equal(rejected.code, "idempotency_key_reused");
  assert.equal(getRecord()?.state, "in_progress");
});
