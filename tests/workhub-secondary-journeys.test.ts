import assert from "node:assert/strict";
import test from "node:test";
import { projectSecondaryJourney, SECONDARY_DEFINITIONS, isSecondaryIntent } from "../src/reference/workhub/secondary-journeys";
import type { WorkflowInstanceRecord, WorkflowWorkItemRecord } from "../src/worker/workflow";

const instance: WorkflowInstanceRecord = {
  id: "journey-1", environment: "test", resourceType: "workhub_secondary_journey",
  resourceId: "resource-1", definitionKey: SECONDARY_DEFINITIONS[0].key,
  definitionVersion: 1, requesterId: "workhub-demo-aoi", state: "active",
  currentStepKey: "commute", returnedStepKey: null, version: 2,
  nextWorkItemSequence: 3, nextTransitionSequence: 3,
  submissionKey: "demo-1", createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:01:00Z", completedAt: null,
};
const item: WorkflowWorkItemRecord = {
  id: "workitem-1", environment: "test", workflowInstanceId: "journey-1",
  stepKey: "commute", assigneePrincipal: "workhub-demo-aoi",
  status: "open", sequence: 2, version: 1,
  createdAt: "2026-10-12T00:01:00Z", dueAt: null,
  completedAt: null, completedBy: null,
};

test("moving partial completion is projected from existing persisted Workflow state", () => {
  assert.ok(isSecondaryIntent("moving"));
  assert.ok(!isSecondaryIntent("unknown"));
  const output = projectSecondaryJourney(instance, item, "workhub-demo-aoi");
  assert.equal(output.state, "in_progress");
  assert.deepEqual(output.steps.map(x => x.status), ["done", "current", "pending"]);
  assert.equal(output.assignedToMe, true);
  assert.equal(output.workItemVersion, 1);
  assert.equal(projectSecondaryJourney(instance, item, "other").assignedToMe, false);
});

test("completed secondary workflow does not invent an open work item", () => {
  const completed = projectSecondaryJourney({
    ...instance, state: "completed", currentStepKey: null, version: 4,
  }, null, "workhub-demo-aoi");
  assert.deepEqual(completed.steps.map(x => x.status), ["done", "done", "done"]);
  assert.equal(completed.workItemVersion, null);
  assert.equal(completed.assignedToMe, false);
});
