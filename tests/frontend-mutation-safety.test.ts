import assert from "node:assert/strict";
import test from "node:test";

import { ApiClientError } from "../src/frontend/api";
import { createMutationState, runSafeMutation } from "../src/frontend/mutation";

interface Draft {
  readonly value: string;
  readonly version: number;
}

const conflictError = () => new ApiClientError("http", "Conflict", {
  status: 409,
  requestId: "req-conflict",
  apiError: {
    error: { code: "conflict", message: "private backend detail" },
    requestId: "req-conflict",
  },
});

const authError = () => new ApiClientError("http", "Authentication required", {
  status: 401,
  requestId: "req-auth",
  apiError: {
    error: { code: "authentication_required", message: "private backend detail" },
    requestId: "req-auth",
  },
});

test("mutation state separates persisted and draft values and exposes expected version", () => {
  const state = createMutationState<Draft>(
    { value: "alpha", version: 3 },
    {
      normalize: (entry) => entry.value.trim(),
      expectedVersion: (entry) => entry.version,
    },
  );

  state.setDraft({ value: " alpha ", version: 3 });
  assert.equal(state.getSnapshot().phase, "clean");

  state.setDraft({ value: "beta", version: 3 });
  assert.equal(state.getSnapshot().phase, "dirty");
  assert.deepEqual(state.beginSubmit(), {
    draft: { value: "beta", version: 3 },
    expectedVersion: 3,
  });
});

test("safe mutation suppresses duplicate submit and updates persisted snapshot on success", async () => {
  const state = createMutationState("before");
  state.setDraft("after");

  let resolveMutation: ((value: string) => void) | undefined;
  const execute = () => new Promise<string>((resolve) => {
    resolveMutation = resolve;
  });

  const first = runSafeMutation(state, execute);
  assert.equal(state.getSnapshot().phase, "submitting");

  const duplicate = await runSafeMutation(state, execute);
  assert.deepEqual(duplicate, { status: "skipped", reason: "submitting" });

  resolveMutation?.("saved");
  assert.deepEqual(await first, { status: "success", value: "saved" });
  assert.equal(state.getSnapshot().phase, "success");
  assert.equal(state.getSnapshot().persisted, "saved");
  assert.equal(state.getSnapshot().draft, "saved");
});

test("edits made while submitting remain dirty after the server response", async () => {
  const state = createMutationState("before");
  state.setDraft("submitted");

  let resolveMutation: ((value: string) => void) | undefined;
  const pending = runSafeMutation(state, () => new Promise<string>((resolve) => {
    resolveMutation = resolve;
  }));

  state.setDraft("edited-again");
  resolveMutation?.("submitted");
  await pending;

  assert.equal(state.getSnapshot().phase, "dirty");
  assert.equal(state.getSnapshot().persisted, "submitted");
  assert.equal(state.getSnapshot().draft, "edited-again");
});

test("409 refreshes latest persisted data without overwriting the user draft", async () => {
  const state = createMutationState<Draft>({ value: "server-old", version: 4 });
  state.setDraft({ value: "user-edit", version: 4 });

  const result = await runSafeMutation(
    state,
    async () => { throw conflictError(); },
    { loadLatest: async () => ({ value: "server-new", version: 5 }) },
  );

  assert.deepEqual(result, { status: "conflict" });
  assert.equal(state.getSnapshot().phase, "conflict");
  assert.deepEqual(state.getSnapshot().persisted, { value: "server-new", version: 5 });
  assert.deepEqual(state.getSnapshot().draft, { value: "user-edit", version: 4 });
  assert.equal(state.getSnapshot().failure?.kind, "conflict");

  state.setDraft({ value: "user-edit-after-review", version: 5 });
  assert.equal(state.getSnapshot().phase, "dirty");
});

test("401 keeps the draft, invokes recovery once, and never auto-replays the mutation", async () => {
  const state = createMutationState("persisted");
  state.setDraft("unsaved work");
  let executions = 0;
  let recoveries = 0;

  const result = await runSafeMutation(
    state,
    async () => {
      executions += 1;
      throw authError();
    },
    {
      onAuthenticationRequired: async () => {
        recoveries += 1;
      },
    },
  );

  assert.deepEqual(result, { status: "authentication_required" });
  assert.equal(executions, 1);
  assert.equal(recoveries, 1);
  assert.equal(state.getSnapshot().phase, "failed");
  assert.equal(state.getSnapshot().draft, "unsaved work");
  assert.equal(state.getSnapshot().failure?.kind, "authentication_required");
});

test("destructive confirmation can cancel before any mutation begins", async () => {
  const state = createMutationState("before");
  state.setDraft("delete-me");
  let executions = 0;

  const result = await runSafeMutation(
    state,
    async () => {
      executions += 1;
      return "deleted";
    },
    { confirmDestructive: () => false },
  );

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(executions, 0);
  assert.equal(state.getSnapshot().phase, "dirty");
});
