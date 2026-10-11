import type { WorkflowDefinition, WorkflowInstanceRecord, WorkflowWorkItemRecord } from "../../worker/workflow";

/** Independent reference mocks; actual HR / payroll / commuting data is NOT changed. */
export const MOVING_MOCK_RESOURCE_TYPE = "workhub_moving_mock_step";
export const MOVING_MOCK_STEPS = [
  { key: "address", label: "住所変更の確認（デモ）", definitionKey: "workhub.moving.address.mock" },
  { key: "commute", label: "通勤経路の確認（デモ）", definitionKey: "workhub.moving.commute.mock" },
  { key: "emergency", label: "緊急連絡先の確認（デモ）", definitionKey: "workhub.moving.emergency.mock" },
] as const;
export type MovingMockStepKey = (typeof MOVING_MOCK_STEPS)[number]["key"];
export const isMovingMockStepKey = (key: string): key is MovingMockStepKey =>
  MOVING_MOCK_STEPS.some(step => step.key === key);

export const MOVING_MOCK_DEFINITIONS: readonly WorkflowDefinition[] = MOVING_MOCK_STEPS.map(step => ({
  key: step.definitionKey,
  version: 1,
  steps: [{ key: "confirm", assigneeResolverKey: "requester" }],
}));

export const movingMockResourceId = (journeyKey: string, stepKey: MovingMockStepKey): string =>
  `${journeyKey}:${stepKey}`;
export const movingMockSubmissionKey = (
  principalId: string, journeyKey: string, stepKey: MovingMockStepKey,
): string => `workhub-secondary:${principalId}:${journeyKey}:${stepKey}`;

export interface MovingMockRecord {
  readonly key: MovingMockStepKey;
  readonly instance: WorkflowInstanceRecord;
  readonly item: WorkflowWorkItemRecord | null;
}

export const projectMovingMockJourney = (
  journeyKey: string,
  principalId: string,
  records: readonly MovingMockRecord[],
) => {
  const steps = MOVING_MOCK_STEPS.map(step => {
    const record = records.find(x => x.key === step.key);
    return {
      key: step.key,
      label: step.label,
      status: record?.instance.state === "completed" ? "done" as const
        : record ? "current" as const : "pending" as const,
      version: record?.instance.version ?? null,
      workItemVersion: record?.item?.version ?? null,
      assignedToMe: record?.item?.assigneePrincipal === principalId,
    };
  });
  const allCompleted = steps.every(step => step.status === "done");
  return {
    id: journeyKey,
    intent: "moving" as const,
    title: "引っ越した",
    requesterId: principalId,
    state: allCompleted ? "completed" as const : "in_progress" as const,
    version: 0,
    workItemVersion: null,
    assignedToMe: false,
    submissionKey: `workhub-secondary:${principalId}:${journeyKey}`,
    steps,
  };
};
