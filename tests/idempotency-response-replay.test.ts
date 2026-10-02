import assert from "node:assert/strict";
import test from "node:test";

import type {
  IdempotencyRecord,
  TransitionIdempotencyRecordResult,
} from "../src/infrastructure/d1-idempotency-store";
import { createFixedClock } from "../src/shared/runtime";
import {
  IdempotencyHttpGuard,
  captureReplayableResponse,
  idempotencyAuditFields,
  idempotencyReplayResponse,
  type IdempotencyHttpStore,
} from "../src/worker/http/idempotency";

const fixedNow = "2026-10-02T00:00:00.000Z";

const request = (): Request =>
  new Request("https://example.test/api/scopes/scope-1/resources", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "replay-key-1",
    },
    body: JSON.stringify({ name: "Example" }),
  });

const createMemoryStore = (): {
  store: IdempotencyHttpStore;
  getRecord: () => IdempotencyRecord | null;
} => {
  let current: IdempotencyRecord | null = null;

  const updated = (record: IdempotencyRecord): TransitionIdempotencyRecordResult => ({
    kind: "updated",
    record,
  });

  const store: IdempotencyHttpStore = {
    async create(input) {
      if (current) return { kind: "existing", record: current };
      current = {
        key: input.key,
        actorId: input.actorId,
        scopeId: input.scopeId,
        action: input.action,
        fingerprint: input.fingerprint,
        state: "in_progress",
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        expiresAt: input.expiresAt,
        replay: null,
      };
      return { kind: "created", record: current };
    },
    async complete(input) {
      if (!current) return { kind: "not_found" };
      current = {
        ...current,
        state: "completed",
        updatedAt: input.changedAt,
        replay: null,
      };
      return updated(current);
    },
    async completeReplayable(input) {
      if (!current) return { kind: "not_found" };
      current = {
        ...current,
        state: "completed",
        updatedAt: input.changedAt,
        replay: input.replay,
      };
      return updated(current);
    },
    async fail(input) {
      if (!current) return { kind: "not_found" };
      current = {
        ...current,
        state: "failed",
        updatedAt: input.changedAt,
        replay: null,
      };
      return updated(current);
    },
  };

  return { store, getRecord: () => current };
};

const input = (httpRequest: Request) => ({
  request: httpRequest,
  actorId: "user-1",
  scopeId: "scope-1",
  action: "resource.create",
});

test("safe 2xx JSON response can be captured for replay", async () => {
  const response = new Response(JSON.stringify({ id: "resource-1", version: 1 }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

  const captured = await captureReplayableResponse(response);

  assert.equal(captured.kind, "replayable");
  if (captured.kind !== "replayable") return;
  assert.equal(captured.replay.status, 201);
  assert.equal(captured.replay.contentType, "application/json; charset=utf-8");
  assert.equal(captured.replay.body, '{"id":"resource-1","version":1}');
});

test("response containing common secret-bearing JSON fields is not cached", async () => {
  const response = new Response(JSON.stringify({ accessToken: "do-not-cache" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const captured = await captureReplayableResponse(response);

  assert.deepEqual(captured, {
    kind: "not_replayable",
    reason: "sensitive_json_field",
  });
});

test("response with credential-bearing headers is not cached", async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": "session=secret",
    },
  });

  const captured = await captureReplayableResponse(response);

  assert.deepEqual(captured, {
    kind: "not_replayable",
    reason: "sensitive_header",
  });
});

test("completed replayable request returns the stored result without proceeding again", async () => {
  const { store, getRecord } = createMemoryStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));
  const httpRequest = request();

  const first = await guard.begin(input(httpRequest));
  assert.equal(first.kind, "proceed");
  if (first.kind !== "proceed") return;

  const completion = await guard.completeWithResponse(
    first.execution,
    new Response(JSON.stringify({ id: "resource-1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(completion.replayStored, true);
  assert.equal(getRecord()?.state, "completed");
  assert.equal(getRecord()?.replay?.status, 201);

  const duplicate = await guard.begin(input(httpRequest));
  assert.equal(duplicate.kind, "replay");
  if (duplicate.kind !== "replay") return;

  const replayResponse = idempotencyReplayResponse(duplicate, "req-retry-2");
  assert.equal(replayResponse.status, 201);
  assert.equal(replayResponse.headers.get("x-idempotent-replay"), "true");
  assert.equal(replayResponse.headers.get("x-request-id"), "req-retry-2");
  assert.equal(await replayResponse.text(), '{"id":"resource-1"}');

  const audit = idempotencyAuditFields(input(httpRequest), duplicate);
  assert.equal(audit.outcome, "success");
  assert.equal(audit.reason, "response_replayed");
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("replay-key-1"), false);
  assert.equal(serialized.includes(first.execution.fingerprint), false);
});

test("non-replayable successful response still completes and blocks mutation replay", async () => {
  const { store, getRecord } = createMemoryStore();
  const guard = new IdempotencyHttpGuard(store, createFixedClock(fixedNow));
  const httpRequest = request();

  const first = await guard.begin(input(httpRequest));
  assert.equal(first.kind, "proceed");
  if (first.kind !== "proceed") return;

  const completion = await guard.completeWithResponse(
    first.execution,
    new Response(JSON.stringify({ token: "secret" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(completion.replayStored, false);
  assert.equal(completion.notReplayableReason, "sensitive_json_field");
  assert.equal(getRecord()?.state, "completed");
  assert.equal(getRecord()?.replay, null);

  const duplicate = await guard.begin(input(httpRequest));
  assert.equal(duplicate.kind, "reject");
  if (duplicate.kind === "reject") {
    assert.equal(duplicate.reason, "completed");
    assert.equal(duplicate.code, "idempotency_completed_no_replay");
  }
});
