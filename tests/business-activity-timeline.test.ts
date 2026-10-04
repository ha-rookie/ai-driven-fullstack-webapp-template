import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessActivityError,
  BusinessActivityProjector,
  BusinessActivityTimelineService,
  InMemoryBusinessActivityStore,
  StaticBusinessActivityFormatter,
  WorkflowBusinessActivityProjector,
} from "../src/worker/business-activity";
import {
  InMemoryWorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowService,
  type WorkflowAssigneeResolver,
  type WorkflowDefinition,
} from "../src/worker/workflow";

const timelineDefinition: WorkflowDefinition = {
  key: "workhub.travel_request_approval",
  version: 1,
  steps: [{
    key: "manager_approval",
    assigneeResolverKey: "workhub.manager",
    reasonPolicy: { return: "required" },
  }],
};

const createScenario = () => {
  const workflowStore = new InMemoryWorkflowStore();
  const activityStore = new InMemoryBusinessActivityStore();
  let activityId = 0;
  const activityProjector = new BusinessActivityProjector({
    environment: "test",
    store: activityStore,
    now: () => new Date("2026-10-04T06:00:00.000Z"),
    generateId: () => `activity-${++activityId}`,
  });
  const timelineSink = new WorkflowBusinessActivityProjector({
    workflowStore,
    projector: activityProjector,
    resolveActorDisplaySnapshot(actorId) {
      return actorId === "aoi" ? "Aoi" : actorId === "ren" ? "Ren" : actorId;
    },
  });
  const assignees: WorkflowAssigneeResolver = {
    async resolve(key) {
      return key === "workhub.manager" ? "ren" : null;
    },
  };
  let workflowId = 0;
  const workflow = new WorkflowService({
    environment: "test",
    store: workflowStore,
    definitions: new StaticWorkflowDefinitionRegistry([timelineDefinition]),
    assignees,
    eventSink: timelineSink,
    now: () => new Date("2026-10-04T06:00:00.000Z"),
    generateId: () => `workflow-${++workflowId}`,
  });
  const timeline = new BusinessActivityTimelineService({
    environment: "test",
    store: activityStore,
    authorizer: {
      assertCanRead(context) {
        if (context.principalId !== "aoi" || context.resourceId !== "travel-1") {
          throw new Error("forbidden");
        }
      },
    },
  });
  return { workflow, workflowStore, activityStore, activityProjector, timeline, timelineSink };
};

test("WORKHUB travel workflow projects submit, return, resubmit and approve into a separate timeline", async () => {
  const { workflow, timeline } = createScenario();

  const started = await workflow.start({
    submissionKey: "travel-1-submit",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    definitionKey: timelineDefinition.key,
    definitionVersion: 1,
    requesterId: "aoi",
  });
  const returned = await workflow.returnForCorrection({
    instanceId: started.instance.id,
    actorId: "ren",
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
    reasonCode: "date_check",
  });
  const resubmitted = await workflow.resubmit({
    instanceId: started.instance.id,
    actorId: "aoi",
    expectedInstanceVersion: returned.instance.version,
  });
  const approved = await workflow.approve({
    instanceId: started.instance.id,
    actorId: "ren",
    expectedInstanceVersion: resubmitted.instance.version,
    expectedWorkItemVersion: resubmitted.currentWorkItem?.version ?? 0,
  });

  assert.equal(approved.instance.state, "completed");

  const first = await timeline.list({
    principalId: "aoi",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    limit: 2,
  });
  assert.deepEqual(first.items.map((entry) => entry.activityType), [
    "workflow.approved",
    "workflow.resubmitted",
  ]);
  assert.ok(first.nextCursor);

  const second = await timeline.list({
    principalId: "aoi",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    limit: 2,
    cursor: first.nextCursor ?? undefined,
  });
  assert.deepEqual(second.items.map((entry) => entry.activityType), [
    "workflow.returned",
    "workflow.submitted",
  ]);
  assert.equal(second.nextCursor, null);
  assert.equal(first.items[0]?.actorDisplaySnapshot, "Ren");
});

test("replaying the same workflow transition does not duplicate a timeline entry", async () => {
  const { workflow, timeline, timelineSink } = createScenario();
  const started = await workflow.start({
    submissionKey: "travel-1-submit",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    definitionKey: timelineDefinition.key,
    definitionVersion: 1,
    requesterId: "aoi",
  });

  await timelineSink.emit(started.transition);

  const page = await timeline.list({
    principalId: "aoi",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sourceId, started.transition.id);
});

test("timeline query fails closed before reading entries when resource authorization denies access", async () => {
  const { timeline } = createScenario();
  await assert.rejects(
    () => timeline.list({
      principalId: "ren",
      resourceType: "workhub.travel_request",
      resourceId: "travel-1",
    }),
    (error: unknown) => error instanceof BusinessActivityError && error.code === "forbidden",
  );
});

test("the same timeline contract can project different business resource types", async () => {
  const { activityProjector, activityStore } = createScenario();
  await activityProjector.project({
    resourceType: "purchase_request",
    resourceId: "purchase-1",
    activityType: "request.submitted",
    actorRef: "buyer",
    sourceType: "domain_event",
    sourceId: "purchase-event-1",
    sequence: 1,
    occurredAt: "2026-10-04T06:00:00.000Z",
  });
  const page = await activityStore.list({
    environment: "test",
    resourceType: "purchase_request",
    resourceId: "purchase-1",
    limit: 10,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.activityType, "request.submitted");
});

test("visibility policy may mask bounded metadata without changing the stored source entry", async () => {
  const store = new InMemoryBusinessActivityStore();
  const projector = new BusinessActivityProjector({
    environment: "test",
    store,
    now: () => new Date("2026-10-04T06:00:00.000Z"),
    generateId: () => "activity-mask",
  });
  await projector.project({
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    activityType: "workflow.returned",
    actorRef: "ren",
    sourceType: "workflow_transition",
    sourceId: "transition-mask",
    sequence: 2,
    metadata: { reasonCode: "private_reason" },
    occurredAt: "2026-10-04T06:00:00.000Z",
  });
  const service = new BusinessActivityTimelineService({
    environment: "test",
    store,
    authorizer: { assertCanRead() {} },
    visibilityPolicy: {
      apply(entry) {
        return { ...entry, metadata: {} };
      },
    },
  });
  const visible = await service.list({
    principalId: "aoi",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
  });
  assert.deepEqual(visible.items[0]?.metadata, {});

  const stored = await store.list({
    environment: "test",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    limit: 10,
  });
  assert.equal(stored.items[0]?.metadata.reasonCode, "private_reason");
});

test("presentation converts stable activity codes to locale-specific messages", () => {
  const formatter = new StaticBusinessActivityFormatter({
    messages: {
      "ja-JP": {
        "workflow.approved": ({ actorDisplay }) => `${actorDisplay ?? "承認者"}が承認しました`,
      },
      "en-US": {
        "workflow.approved": ({ actorDisplay }) => `${actorDisplay ?? "Approver"} approved the request`,
      },
    },
  });
  const entry = {
    id: "activity-1",
    environment: "test",
    resourceType: "workhub.travel_request",
    resourceId: "travel-1",
    activityType: "workflow.approved",
    actorRef: "ren",
    actorDisplaySnapshot: "Ren",
    subjectRef: null,
    sourceType: "workflow_transition",
    sourceId: "transition-4",
    sequence: 4,
    visibilityScope: null,
    metadata: {},
    occurredAt: "2026-10-04T06:00:00.000Z",
    createdAt: "2026-10-04T06:00:00.000Z",
  } as const;

  assert.equal(formatter.format(entry, { locale: "ja-JP", timeZone: "Asia/Tokyo" }).message, "Renが承認しました");
  assert.equal(formatter.format(entry, { locale: "en-US", timeZone: "UTC" }).message, "Ren approved the request");
});
