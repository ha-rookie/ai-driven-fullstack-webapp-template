import assert from "node:assert/strict";
import test from "node:test";
import { MOVING_MOCK_RESOURCE_TYPE, MOVING_MOCK_STEPS, movingMockResourceId,
  projectMovingMockJourney, type MovingMockRecord,
} from "../src/reference/workhub/moving-mock-steps";
import type { WorkflowInstanceRecord, WorkflowWorkItemRecord } from "../src/worker/workflow";

const principal = "workhub-demo-aoi";
const key = "d842801f-39b8-49e3-8176-21a05ea50896";
const makeRecord = (step: (typeof MOVING_MOCK_STEPS)[number], completed: boolean): MovingMockRecord => {
  const instance: WorkflowInstanceRecord = {
    id: `instance-${step.key}`, environment: "test",
    resourceType: MOVING_MOCK_RESOURCE_TYPE,
    resourceId: movingMockResourceId(key, step.key),
    definitionKey: step.definitionKey, definitionVersion: 1,
    requesterId: principal, state: completed ? "completed" : "active",
    currentStepKey: completed ? null : "confirm", returnedStepKey: null,
    version: completed ? 2 : 1,
    nextWorkItemSequence: 2, nextTransitionSequence: completed ? 3 : 2,
    submissionKey: `workhub-secondary:${principal}:${key}:${step.key}`,
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
    completedAt: completed ? "2026-10-12T00:00:00Z" : null,
  };
  const item: WorkflowWorkItemRecord | null = completed ? null : {
    id: `item-${step.key}`, environment: "test", workflowInstanceId: instance.id,
    stepKey: "confirm", assigneePrincipal: principal, status: "open",
    sequence: 1, version: 1, createdAt: instance.createdAt,
    dueAt: null, completedAt: null, completedBy: null,
  };
  return { key: step.key, instance, item };
};

test("three moving mock sources are independent and may complete out of order", () => {
  const records = MOVING_MOCK_STEPS.map((step, i) => makeRecord(step, i !== 0));
  const journey = projectMovingMockJourney(key, principal, records);
  assert.equal(journey.state, "in_progress");
  assert.deepEqual(journey.steps.map(x => x.status), ["current", "done", "done"]);
  assert.equal(journey.steps[0].version, 1);
  assert.equal(journey.steps[1].workItemVersion, null);
  assert.equal(journey.steps[2].assignedToMe, false);
  assert.equal(journey.submissionKey, `workhub-secondary:${principal}:${key}`);
  const complete = projectMovingMockJourney(key, principal, records.map(x =>
    x.key === "address" ? makeRecord(MOVING_MOCK_STEPS[0], true) : x));
  assert.equal(complete.state, "completed");
  assert.deepEqual(complete.steps.map(x => x.status), ["done", "done", "done"]);
});

test("missing adapter source is pending, not falsely complete", () => {
  const journey = projectMovingMockJourney(key, principal, [makeRecord(MOVING_MOCK_STEPS[0], true)]);
  assert.deepEqual(journey.steps.map(x => x.status), ["done", "pending", "pending"]);
  assert.equal(journey.state, "in_progress");
});
