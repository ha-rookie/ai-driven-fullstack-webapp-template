import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryWorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowError,
  WorkflowService,
  type WorkflowAssigneeResolver,
  type WorkflowDefinition,
  type WorkflowTransitionRecord,
} from "../src/worker/workflow";

const definition: WorkflowDefinition = {
  key: "two_step_approval",
  version: 1,
  allowWithdrawWhileActive: true,
  allowWithdrawWhileAwaitingResubmission: true,
  steps: [
    {
      key: "review_1",
      assigneeResolverKey: "reviewer_1",
      reasonPolicy: { return: "required", reject: "required" },
    },
    {
      key: "review_2",
      assigneeResolverKey: "reviewer_2",
      reasonPolicy: { return: "required", reject: "required" },
    },
  ],
};

const singleStepDefinition: WorkflowDefinition = {
  key: "single_step",
  version: 1,
  allowWithdrawWhileActive: true,
  allowWithdrawWhileAwaitingResubmission: true,
  steps: [{
    key: "review",
    assigneeResolverKey: "reviewer_1",
    reasonPolicy: { return: "required", reject: "required" },
  }],
};

const createFixture = (options?: {
  definitions?: readonly WorkflowDefinition[];
  assignees?: Record<string, string | null>;
  eventSink?: { emit(event: WorkflowTransitionRecord): Promise<void> | void };
  mutationGate?: { assertMutationAllowed(): Promise<void> | void };
}) => {
  const store = new InMemoryWorkflowStore();
  const assigneeValues = options?.assignees ?? { reviewer_1: "principal-a", reviewer_2: "principal-b" };
  const assignees: WorkflowAssigneeResolver = {
    async resolve(key) {
      return assigneeValues[key] ?? null;
    },
  };
  let counter = 0;
  const service = new WorkflowService({
    environment: "test",
    store,
    definitions: new StaticWorkflowDefinitionRegistry(options?.definitions ?? [definition, singleStepDefinition]),
    assignees,
    eventSink: options?.eventSink,
    mutationGate: options?.mutationGate,
    now: () => new Date("2026-10-04T03:00:00.000Z"),
    generateId: () => `id-${++counter}`,
  });
  return { service, store };
};

const start = async (service: WorkflowService, definitionKey = "two_step_approval") => service.start({
  submissionKey: "submit-1",
  resourceType: "example_request",
  resourceId: "resource-1",
  definitionKey,
  definitionVersion: 1,
  requesterId: "requester-1",
  requestId: "request-start",
});

test("sequential approval creates one work item at a time and completes after final step", async () => {
  const { service } = createFixture();
  const started = await start(service);
  assert.equal(started.instance.state, "active");
  assert.equal(started.currentWorkItem?.stepKey, "review_1");
  assert.equal(started.currentWorkItem?.assigneePrincipal, "principal-a");

  const firstApproved = await service.approve({
    instanceId: started.instance.id,
    actorId: "principal-a",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
    requestId: "approve-1",
  });
  assert.equal(firstApproved.instance.state, "active");
  assert.equal(firstApproved.instance.definitionVersion, 1);
  assert.equal(firstApproved.currentWorkItem?.stepKey, "review_2");
  assert.equal(firstApproved.currentWorkItem?.assigneePrincipal, "principal-b");

  const completed = await service.approve({
    instanceId: started.instance.id,
    actorId: "principal-b",
    expectedInstanceVersion: 2,
    expectedWorkItemVersion: 1,
    requestId: "approve-2",
  });
  assert.equal(completed.instance.state, "completed");
  assert.equal(completed.currentWorkItem, null);
  assert.equal(completed.instance.completedAt, "2026-10-04T03:00:00.000Z");
});

test("return keeps the same workflow instance and resubmit creates a new work item sequence", async () => {
  const { service } = createFixture();
  const started = await start(service, "single_step");

  await assert.rejects(
    () => service.returnForCorrection({
      instanceId: started.instance.id,
      actorId: "principal-a",
      expectedInstanceVersion: 1,
      expectedWorkItemVersion: 1,
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === "reason_required",
  );

  const returned = await service.returnForCorrection({
    instanceId: started.instance.id,
    actorId: "principal-a",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
    comment: "Please correct the request",
  });
  assert.equal(returned.instance.state, "awaiting_resubmission");
  assert.equal(returned.instance.returnedStepKey, "review");
  assert.equal(returned.currentWorkItem, null);

  const resubmitted = await service.resubmit({
    instanceId: started.instance.id,
    actorId: "requester-1",
    expectedInstanceVersion: 2,
  });
  assert.equal(resubmitted.instance.id, started.instance.id);
  assert.equal(resubmitted.instance.state, "active");
  assert.equal(resubmitted.currentWorkItem?.sequence, 2);
  assert.equal(resubmitted.currentWorkItem?.stepKey, "review");
});

test("reject is terminal and requires configured reason", async () => {
  const { service } = createFixture();
  const started = await start(service, "single_step");

  await assert.rejects(
    () => service.reject({
      instanceId: started.instance.id,
      actorId: "principal-a",
      expectedInstanceVersion: 1,
      expectedWorkItemVersion: 1,
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === "reason_required",
  );

  const rejected = await service.reject({
    instanceId: started.instance.id,
    actorId: "principal-a",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
    reasonCode: "policy_failed",
  });
  assert.equal(rejected.instance.state, "rejected");
  assert.equal(rejected.currentWorkItem, null);

  await assert.rejects(
    () => service.resubmit({
      instanceId: started.instance.id,
      actorId: "requester-1",
      expectedInstanceVersion: 2,
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === "invalid_state",
  );
});

test("only effective assignee may decide an open work item", async () => {
  const { service } = createFixture();
  const started = await start(service, "single_step");
  await assert.rejects(
    () => service.approve({
      instanceId: started.instance.id,
      actorId: "not-assigned",
      expectedInstanceVersion: 1,
      expectedWorkItemVersion: 1,
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === "forbidden",
  );
});

test("stale instance versions fail closed instead of last-write-wins", async () => {
  const { service } = createFixture();
  const started = await start(service, "single_step");
  const approved = await service.approve({
    instanceId: started.instance.id,
    actorId: "principal-a",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
  });
  assert.equal(approved.instance.state, "completed");

  await assert.rejects(
    () => service.approve({
      instanceId: started.instance.id,
      actorId: "principal-a",
      expectedInstanceVersion: 1,
      expectedWorkItemVersion: 1,
    }),
    (error: unknown) => error instanceof WorkflowError
      && (error.code === "invalid_state" || error.code === "conflict"),
  );
});

test("assignee resolution fails closed without fallback to requester or administrator", async () => {
  const { service } = createFixture({ assignees: { reviewer_1: null, reviewer_2: null } });
  await assert.rejects(
    () => start(service, "single_step"),
    (error: unknown) => error instanceof WorkflowError && error.code === "assignee_unresolved",
  );
});

test("requester can withdraw only when definition policy allows it", async () => {
  const { service } = createFixture();
  const started = await start(service, "single_step");

  await assert.rejects(
    () => service.withdraw({
      instanceId: started.instance.id,
      actorId: "different-user",
      expectedInstanceVersion: 1,
      expectedWorkItemVersion: 1,
    }),
    (error: unknown) => error instanceof WorkflowError && error.code === "forbidden",
  );

  const withdrawn = await service.withdraw({
    instanceId: started.instance.id,
    actorId: "requester-1",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
  });
  assert.equal(withdrawn.instance.state, "withdrawn");
  assert.equal(withdrawn.currentWorkItem, null);
});

test("mutation gate runs before workflow persistence", async () => {
  const { service } = createFixture({
    mutationGate: {
      assertMutationAllowed() {
        throw new Error("read-only");
      },
    },
  });
  await assert.rejects(() => start(service), /read-only/u);
});

test("event sink failure does not roll back an already committed workflow transition", async () => {
  const { service } = createFixture({
    eventSink: {
      emit() {
        throw new Error("notification unavailable");
      },
    },
  });
  const started = await start(service, "single_step");
  assert.equal(started.instance.state, "active");
});

test("submission key prevents duplicate workflow starts", async () => {
  const { service } = createFixture();
  await start(service, "single_step");
  await assert.rejects(
    () => start(service, "single_step"),
    (error: unknown) => error instanceof WorkflowError && error.code === "conflict",
  );
});

test("MY WORK query returns only open work items for the effective assignee", async () => {
  const { service } = createFixture();
  await start(service, "single_step");
  const mine = await service.listMyOpenWorkItems("principal-a");
  const others = await service.listMyOpenWorkItems("principal-b");
  assert.equal(mine.length, 1);
  assert.equal(others.length, 0);
});
