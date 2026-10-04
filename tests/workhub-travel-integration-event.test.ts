import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryIntegrationEventStore, IntegrationEventService } from "../src/worker/integration-event";
import { InMemoryWorkflowStore, type WorkflowInstanceRecord, type WorkflowTransitionRecord } from "../src/worker/workflow";
import {
  WORKHUB_TRAVEL_APPROVED_EVENT_TYPE,
  WorkhubTravelApprovedIntegrationSink,
} from "../src/reference/workhub/travel-request";

const NOW = "2026-10-04T10:00:00.000Z";

const instance: WorkflowInstanceRecord = {
  id: "workflow-1",
  environment: "test",
  resourceType: "travel_request",
  resourceId: "travel-1",
  definitionKey: "workhub.travel_request_approval",
  definitionVersion: 1,
  requesterId: "workhub-demo-aoi",
  state: "completed",
  currentStepKey: null,
  returnedStepKey: null,
  version: 2,
  nextWorkItemSequence: 2,
  nextTransitionSequence: 3,
  submissionKey: "travel-submit-1",
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: NOW,
};

const transition: WorkflowTransitionRecord = {
  id: "transition-approved-1",
  environment: "test",
  workflowInstanceId: instance.id,
  workItemId: "work-item-1",
  sequence: 2,
  transition: "approve",
  actorId: "workhub-demo-ren",
  fromState: "active",
  toState: "completed",
  fromStepKey: "manager_approval",
  toStepKey: null,
  definitionVersion: 1,
  reasonCode: null,
  comment: null,
  requestId: "request-1",
  correlationId: "correlation-1",
  occurredAt: NOW,
};

test("completed TravelRequest approval maps to versioned travel.approved integration event", async () => {
  const workflowStore = new InMemoryWorkflowStore();
  await workflowStore.create({
    instance: { ...instance, state: "active", currentStepKey: "manager_approval", version: 1, completedAt: null },
    workItem: {
      id: "work-item-1", environment: "test", workflowInstanceId: instance.id,
      stepKey: "manager_approval", assigneePrincipal: "workhub-demo-ren", status: "open",
      sequence: 1, version: 1, createdAt: NOW, dueAt: null, completedAt: null, completedBy: null,
    },
    transition: { ...transition, id: "transition-submit-1", transition: "submit", actorId: "workhub-demo-aoi", fromState: null, toState: "active", fromStepKey: null, toStepKey: "manager_approval", workItemId: null, sequence: 1 },
  });
  await workflowStore.apply({
    expectedInstanceVersion: 1,
    expectedWorkItemVersion: 1,
    instance,
    completedWorkItem: {
      id: "work-item-1", environment: "test", workflowInstanceId: instance.id,
      stepKey: "manager_approval", assigneePrincipal: "workhub-demo-ren", status: "approved",
      sequence: 1, version: 2, createdAt: NOW, dueAt: null, completedAt: NOW, completedBy: "workhub-demo-ren",
    },
    transition,
  });

  const integrationStore = new InMemoryIntegrationEventStore();
  const integrationService = new IntegrationEventService(
    integrationStore,
    { now: () => new Date(NOW) },
    { generate: () => "unused-generated-id" },
  );
  const sink = new WorkhubTravelApprovedIntegrationSink(workflowStore, integrationService, "calendar");

  await sink.emit(transition);
  await sink.emit(transition);

  const event = await integrationStore.getEvent(transition.id, "test");
  const outbox = await integrationStore.getOutbox(transition.id, "test");
  assert.equal(event?.eventType, WORKHUB_TRAVEL_APPROVED_EVENT_TYPE);
  assert.equal(event?.schemaVersion, 1);
  assert.equal(event?.aggregateId, "travel-1");
  assert.deepEqual(event?.payload, {
    travelRequestId: "travel-1",
    requesterId: "workhub-demo-aoi",
    approvedBy: "workhub-demo-ren",
  });
  assert.equal(outbox?.destinationKey, "calendar");
  assert.equal(outbox?.status, "pending");
});

test("non-terminal workflow transition is not exposed as travel.approved", async () => {
  const integrationStore = new InMemoryIntegrationEventStore();
  const integrationService = new IntegrationEventService(integrationStore, { now: () => new Date(NOW) }, { generate: () => "unused" });
  const workflowState = { async getInstance() { return instance; } };
  const sink = new WorkhubTravelApprovedIntegrationSink(workflowState, integrationService, "calendar");
  await sink.emit({ ...transition, id: "transition-return-1", transition: "return", toState: "awaiting_resubmission" });
  assert.equal(await integrationStore.getEvent("transition-return-1", "test"), null);
});
