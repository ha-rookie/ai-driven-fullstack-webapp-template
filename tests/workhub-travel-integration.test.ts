import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryMasterDataStore,
  MasterDataService,
  StaticMasterDefinitionRegistry,
} from "../src/worker/master-data";
import {
  InMemoryWorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowService,
  type WorkflowTransitionRecord,
} from "../src/worker/workflow";
import {
  InMemoryTravelRequestStore,
  TravelRequestService,
  WORKHUB_OFFICE_MASTER_DEFINITION,
  WORKHUB_OFFICE_MASTER_KEY,
  WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
  WORKHUB_TRAVEL_WORKFLOW_DEFINITION,
  WorkhubWorkflowProjectionFanOut,
} from "../src/reference/workhub/travel-request";

const NOW = "2026-10-04T08:00:00.000Z";

test("Aoi corrects a returned TravelRequest, resubmits, and Ren approves it", async () => {
  const masterStore = new InMemoryMasterDataStore();
  const workflowStore = new InMemoryWorkflowStore();
  const travelStore = new InMemoryTravelRequestStore();
  let masterCounter = 0;
  let workflowCounter = 0;
  let travelCounter = 0;

  const masterData = new MasterDataService({
    environment: "test",
    store: masterStore,
    definitions: new StaticMasterDefinitionRegistry([WORKHUB_OFFICE_MASTER_DEFINITION]),
    now: () => new Date(NOW),
    generateId: () => `master-${++masterCounter}`,
  });
  const office = await masterData.createItem({
    masterKey: WORKHUB_OFFICE_MASTER_KEY,
    code: "TOKYO",
    actorId: "fixture-admin",
  });
  const tokyo = await masterData.addRevision({
    itemId: office.id,
    actorId: "fixture-admin",
    expectedItemVersion: office.version,
    label: "Tokyo Office",
    enabled: true,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
  });

  const workflow = new WorkflowService({
    environment: "test",
    store: workflowStore,
    definitions: new StaticWorkflowDefinitionRegistry([WORKHUB_TRAVEL_WORKFLOW_DEFINITION]),
    assignees: WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
    now: () => new Date(NOW),
    generateId: () => `workflow-${++workflowCounter}`,
  });
  const travel = new TravelRequestService({
    environment: "test",
    store: travelStore,
    masterData,
    workflow,
    workflowState: workflowStore,
    now: () => new Date(NOW),
    generateId: () => `travel-${++travelCounter}`,
  });

  const draft = await travel.createDraft({
    principalId: "workhub-demo-aoi",
    destinationOfficeItemId: tokyo.item.id,
    startDate: "2026-10-20",
    endDate: "2026-10-21",
    purpose: "Tokyo customer meeting",
  });
  const submitted = await travel.submit({
    id: draft.id,
    principalId: "workhub-demo-aoi",
    expectedVersion: draft.version,
  });
  assert.ok(submitted.workflowInstanceId);

  const firstWorkItem = await workflowStore.getOpenWorkItem(submitted.workflowInstanceId!, "test");
  const firstInstance = await workflowStore.getInstance(submitted.workflowInstanceId!, "test");
  assert.ok(firstWorkItem);
  assert.ok(firstInstance);
  assert.equal(firstWorkItem.assigneePrincipal, "workhub-demo-ren");

  const returned = await workflow.returnForCorrection({
    instanceId: firstInstance.id,
    actorId: "workhub-demo-ren",
    expectedInstanceVersion: firstInstance.version,
    expectedWorkItemVersion: firstWorkItem.version,
    reasonCode: "correction_required",
    comment: "Please confirm the schedule",
  });
  assert.equal(returned.instance.state, "awaiting_resubmission");

  const corrected = await travel.updateReturned({
    id: submitted.id,
    principalId: "workhub-demo-aoi",
    expectedVersion: submitted.version,
    destinationOfficeItemId: tokyo.item.id,
    startDate: "2026-10-22",
    endDate: "2026-10-23",
    purpose: "Tokyo customer meeting - corrected",
  });
  assert.equal(corrected.destinationOfficeRevisionId, null);

  const resubmitted = await travel.resubmit({
    id: corrected.id,
    principalId: "workhub-demo-aoi",
    expectedRequestVersion: corrected.version,
    expectedWorkflowVersion: returned.instance.version,
  });
  assert.equal(resubmitted.workflow.instance.state, "active");
  assert.equal(resubmitted.request.destinationOfficeRevisionId, tokyo.revision.id);

  const secondWorkItem = await workflowStore.getOpenWorkItem(submitted.workflowInstanceId!, "test");
  assert.ok(secondWorkItem);
  assert.equal(secondWorkItem.assigneePrincipal, "workhub-demo-ren");

  const approved = await workflow.approve({
    instanceId: resubmitted.workflow.instance.id,
    actorId: "workhub-demo-ren",
    expectedInstanceVersion: resubmitted.workflow.instance.version,
    expectedWorkItemVersion: secondWorkItem.version,
  });
  assert.equal(approved.instance.state, "completed");
  assert.equal(await workflowStore.getOpenWorkItem(approved.instance.id, "test"), null);
});

test("WORKHUB workflow projection fan-out isolates sink failures", async () => {
  const delivered: string[] = [];
  const failures: number[] = [];
  const transition: WorkflowTransitionRecord = {
    id: "transition-1",
    environment: "test",
    workflowInstanceId: "workflow-1",
    workItemId: "work-item-1",
    sequence: 1,
    transition: "approve",
    actorId: "workhub-demo-ren",
    fromState: "active",
    toState: "completed",
    fromStepKey: "manager_approval",
    toStepKey: null,
    definitionVersion: 1,
    reasonCode: null,
    comment: null,
    requestId: null,
    correlationId: null,
    occurredAt: NOW,
  };
  const sink = new WorkhubWorkflowProjectionFanOut([
    { async emit() { throw new Error("timeline unavailable"); } },
    { async emit(event) { delivered.push(event.id); } },
  ], (failure) => failures.push(failure.sinkIndex));

  await sink.emit(transition);
  assert.deepEqual(failures, [0]);
  assert.deepEqual(delivered, ["transition-1"]);
});
