import assert from "node:assert/strict";
import test from "node:test";
import { isTravelDelegationActive, type TravelDelegationRecord } from "../src/reference/workhub/approval-delegation";
import type { WorkflowInstanceRecord, WorkflowWorkItemRecord } from "../src/worker/workflow";

const date = (value: string) => new Date(value);
const grant: TravelDelegationRecord = {
  environment: "test", delegatorId: "workhub-demo-ren", delegateId: "workhub-demo-mei",
  resourceType: "workhub.travel_request", stepKey: "manager_approval",
  actionScope: "approve_return", validFrom: "2026-10-12T00:00:00.000Z",
  validUntil: "2026-10-13T00:00:00.000Z", reason: "Reference",
  revokedAt: null, updatedAt: "2026-10-12T00:00:00.000Z",
};
const instance: WorkflowInstanceRecord = {
  id: "wf-1", environment: "test", resourceType: "workhub.travel_request",
  resourceId: "travel-1", definitionKey: "workhub.travel_request_approval",
  definitionVersion: 1, requesterId: "workhub-demo-aoi",
  state: "active", currentStepKey: "manager_approval", returnedStepKey: null,
  version: 1, nextWorkItemSequence: 2, nextTransitionSequence: 2,
  submissionKey: "test-delegation", createdAt: grant.validFrom,
  updatedAt: grant.validFrom, completedAt: null,
};
const workItem: WorkflowWorkItemRecord = {
  id: "work-1", environment: "test", workflowInstanceId: instance.id,
  stepKey: "manager_approval", assigneePrincipal: "workhub-demo-ren",
  status: "open", sequence: 1, version: 1, createdAt: grant.validFrom,
  dueAt: null, completedAt: null, completedBy: null,
};
const allowed = (
  record: TravelDelegationRecord | null = grant,
  actorId = "workhub-demo-mei",
  workflow = instance,
  work = workItem,
  action: "approve" | "return" | "reject" = "approve",
  at = date("2026-10-12T12:00:00.000Z"),
) => isTravelDelegationActive(record, actorId, workflow, work, action, at);

test("explicit approved travel delegate works only within the valid window and for approved actions", () => {
  assert.equal(allowed(), true);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, workItem, "return"), true);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, workItem, "reject"), false);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, workItem, "approve", date(grant.validFrom)), true);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, workItem, "approve", date(grant.validUntil)), false);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, workItem, "approve", date("2026-10-11T23:59:59.000Z")), false);
});

test("revoked, missing, wrong-scope or other-principal delegation always denies", () => {
  assert.equal(allowed(null), false);
  assert.equal(allowed({ ...grant, revokedAt: "2026-10-12T01:00:00.000Z" }), false);
  assert.equal(allowed(grant, "workhub-demo-kai"), false);
  assert.equal(allowed(grant, "workhub-demo-ren"), false);
  assert.equal(allowed({ ...grant, resourceType: "workhub.expense" }), false);
  assert.equal(allowed({ ...grant, environment: "production" }), false);
  assert.equal(allowed({ ...grant, stepKey: "receipt" }), false);
  assert.equal(allowed(grant, "workhub-demo-mei", { ...instance, resourceType: "workhub.pc" }), false);
  assert.equal(allowed(grant, "workhub-demo-mei", { ...instance, requesterId: "workhub-demo-mei" }), false);
  assert.equal(allowed(grant, "workhub-demo-mei", instance, { ...workItem, assigneePrincipal: "workhub-demo-sora" }), false);
});
