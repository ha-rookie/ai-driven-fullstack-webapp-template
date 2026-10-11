import {
  D1WorkflowStore, StaticWorkflowDefinitionRegistry, WorkflowError,
  WorkflowService,
  type WorkflowDefinition, type WorkflowInstanceRecord, type WorkflowWorkItemRecord,
} from "../../worker/workflow";
import { MOVING_MOCK_DEFINITIONS, MOVING_MOCK_RESOURCE_TYPE, MOVING_MOCK_STEPS, isMovingMockStepKey,
  movingMockResourceId, movingMockSubmissionKey, projectMovingMockJourney, type MovingMockRecord,
} from "./moving-mock-steps";

/**
 * Two Reference-only journeys. Workflow tables are the persisted state for
 * these simulated confirmations; they DO NOT update HR or IT asset records.
 */
export const SECONDARY_RESOURCE_TYPE = "workhub_secondary_journey";
export const SECONDARY_DEFINITIONS: readonly WorkflowDefinition[] = [
  {
    key: "workhub.moving.reference", version: 1,
    steps: [
      { key: "address", assigneeResolverKey: "requester" },
      { key: "commute", assigneeResolverKey: "requester" },
      { key: "emergency", assigneeResolverKey: "requester" },
    ],
  },
  {
    key: "workhub.pc_replacement.reference", version: 1,
    steps: [
      { key: "request", assigneeResolverKey: "requester" },
      { key: "intake", assigneeResolverKey: "corporate" },
      { key: "processing", assigneeResolverKey: "corporate" },
      { key: "receipt", assigneeResolverKey: "requester" },
    ],
  },
];

export type SecondaryIntent = "moving" | "pc-replacement";
export interface SecondaryStep {
  readonly key: string;
  readonly label: string;
  readonly status: "done" | "current" | "pending" | "stopped";
  readonly version?: number | null;
  readonly workItemVersion?: number | null;
  readonly assignedToMe?: boolean;
}
export interface SecondaryJourneyView {
  readonly id: string;
  readonly intent: SecondaryIntent;
  readonly title: string;
  readonly requesterId: string;
  readonly state: "in_progress" | "completed" | "needs_information" | "rejected";
  readonly version: number;
  readonly workItemVersion: number | null;
  readonly assignedToMe: boolean;
  readonly submissionKey: string;
  readonly steps: readonly SecondaryStep[];
}

const CONFIG = {
  moving: {
    definitionKey: "workhub.moving.reference", title: "引っ越した",
    steps: [
      ["address", "住所変更の確認（デモ）"],
      ["commute", "通勤経路の確認（デモ）"],
      ["emergency", "緊急連絡先の確認（デモ）"],
    ],
  },
  "pc-replacement": {
    definitionKey: "workhub.pc_replacement.reference", title: "PCを交換したい",
    steps: [
      ["request", "社員から交換依頼"],
      ["intake", "総務担当による受付"],
      ["processing", "総務担当による交換準備"],
      ["receipt", "社員による受領確認"],
    ],
  },
} as const;

export const isSecondaryIntent = (input: string): input is SecondaryIntent =>
  input === "moving" || input === "pc-replacement";

export const projectSecondaryJourney = (
  instance: WorkflowInstanceRecord,
  item: WorkflowWorkItemRecord | null,
  principalId: string,
  rejectedStepKey: string | null = null,
): SecondaryJourneyView => {
  const intent: SecondaryIntent = instance.definitionKey === CONFIG.moving.definitionKey
    ? "moving" : "pc-replacement";
  const spec = CONFIG[intent];
  const current = spec.steps.findIndex(([key]) => key === (instance.currentStepKey ?? instance.returnedStepKey ?? rejectedStepKey));
  return {
    id: instance.id,
    intent,
    title: spec.title,
    requesterId: instance.requesterId,
    state: instance.state === "completed" ? "completed"
      : instance.state === "awaiting_resubmission" ? "needs_information"
      : instance.state === "rejected" ? "rejected" : "in_progress",
    version: instance.version,
    workItemVersion: item?.version ?? null,
    assignedToMe: item?.assigneePrincipal === principalId,
    submissionKey: instance.submissionKey,
    steps: spec.steps.map(([key, label], index) => ({
      key, label,
      status: instance.state === "completed" || (current >= 0 && index < current)
        ? "done"
        : instance.state === "rejected" && index === current ? "stopped"
        : index === current ? "current" : "pending",
    })),
  };
};

export class WorkhubSecondaryJourneyService {
  private readonly store: D1WorkflowStore;
  private readonly workflow: WorkflowService;
  constructor(
    private readonly db: D1Database,
    private readonly environment: string,
  ) {
    this.store = new D1WorkflowStore(db);
    this.workflow = new WorkflowService({
      environment,
      store: this.store,
      definitions: new StaticWorkflowDefinitionRegistry([...SECONDARY_DEFINITIONS, ...MOVING_MOCK_DEFINITIONS]),
      assignees: {
        resolve: async (key, context) =>
          key === "requester" ? context.requesterId
            : key === "corporate" ? "workhub-demo-sora" : null,
      },
    });
  }

  /** Each moving mock owns an independent persisted Workflow state. */
  private async findMovingMocks(principalId: string, key: string): Promise<MovingMockRecord[]> {
    const resourceIds = MOVING_MOCK_STEPS.map(step => movingMockResourceId(key, step.key));
    const result = await this.db.prepare(`
      SELECT id, resource_id FROM workflow_instances
      WHERE environment = ? AND resource_type = ? AND requester_id = ?
        AND resource_id IN (?, ?, ?)
    `).bind(this.environment, MOVING_MOCK_RESOURCE_TYPE, principalId, ...resourceIds)
      .all<{ id: string; resource_id: string }>();
    const records: MovingMockRecord[] = [];
    for (const row of result.results ?? []) {
      const step = MOVING_MOCK_STEPS.find(candidate => row.resource_id === movingMockResourceId(key, candidate.key));
      if (!step) continue;
      const instance = await this.store.getInstance(row.id, this.environment);
      if (!instance) continue;
      records.push({ key: step.key, instance, item: await this.store.getOpenWorkItem(row.id, this.environment) });
    }
    return records;
  }

  /**
   * Workflow terminal rejection clears currentStepKey. The persisted
   * reject transition records which step stopped. Read only for rejections.
   */
  private async projectInstance(
    instance: WorkflowInstanceRecord, item: WorkflowWorkItemRecord | null, principalId: string,
  ): Promise<SecondaryJourneyView> {
    let rejectedStepKey: string | null = null;
    if (instance.state === "rejected") {
      const transition = await this.db.prepare(`
        SELECT from_step_key FROM workflow_transitions
        WHERE environment = ? AND workflow_instance_id = ? AND transition = 'reject'
        ORDER BY sequence DESC LIMIT 1
      `).bind(this.environment, instance.id).first<{ from_step_key: string | null }>();
      rejectedStepKey = transition?.from_step_key ?? null;
    }
    return projectSecondaryJourney(instance, item, principalId, rejectedStepKey);
  }

  async list(principalId: string, role: string): Promise<readonly SecondaryJourneyView[]> {
    if (role !== "employee" && role !== "corporate") return [];
    const result = await this.db.prepare(`
      SELECT i.id, i.resource_type, i.resource_id FROM workflow_instances i
      WHERE i.environment = ? AND i.resource_type IN (?, ?)
        AND (
          (i.requester_id = ? AND ? = 'employee')
          OR (? = 'corporate' AND i.resource_type = ? AND EXISTS (
            SELECT 1 FROM workflow_work_items w
            WHERE w.workflow_instance_id = i.id AND w.environment = i.environment
              AND w.assignee_principal = ? AND w.status = 'open'
          ))
        )
      ORDER BY i.created_at DESC, i.id DESC LIMIT 75
    `).bind(this.environment, SECONDARY_RESOURCE_TYPE, MOVING_MOCK_RESOURCE_TYPE,
      principalId, role, role, SECONDARY_RESOURCE_TYPE, principalId)
      .all<{ id: string; resource_type: string; resource_id: string }>();
    const views: SecondaryJourneyView[] = [];
    const movingKeys = new Set<string>();
    for (const row of result.results ?? []) {
      if (row.resource_type === MOVING_MOCK_RESOURCE_TYPE) {
        const key = row.resource_id.split(":")[0];
        if (/^[0-9a-f-]{36}$/iu.test(key)) movingKeys.add(key);
        continue;
      }
      const instance = await this.store.getInstance(row.id, this.environment);
      if (!instance || !SECONDARY_DEFINITIONS.some(d => d.key === instance.definitionKey)) continue;
      const item = await this.store.getOpenWorkItem(row.id, this.environment);
      views.push(await this.projectInstance(instance, item, principalId));
    }
    if (role === "employee") {
      for (const key of movingKeys) {
        const records = await this.findMovingMocks(principalId, key);
        if (records.length) views.push(projectMovingMockJourney(key, principalId, records));
      }
    }
    return views.slice(0, 25);
  }

  /** Resource ID and requester are bound to the authenticated scope, not supplied by the browser. */
  private async findOwnedStart(principalId: string, key: string): Promise<WorkflowInstanceRecord | null> {
    const row = await this.db.prepare(`
      SELECT id FROM workflow_instances
      WHERE environment = ? AND resource_type = ? AND resource_id = ? AND requester_id = ?
      LIMIT 1
    `).bind(this.environment, SECONDARY_RESOURCE_TYPE, key, principalId).first<{ id: string }>();
    return row ? this.store.getInstance(row.id, this.environment) : null;
  }

  private async currentOwnedStart(
    principalId: string, key: string, intent: SecondaryIntent,
  ): Promise<SecondaryJourneyView | null> {
    const instance = await this.findOwnedStart(principalId, key);
    if (!instance) return null;
    if (instance.definitionKey !== CONFIG[intent].definitionKey) {
      throw new WorkflowError("conflict", "This reference request key belongs to another journey");
    }
    const item = await this.store.getOpenWorkItem(instance.id, this.environment);
    return this.projectInstance(instance, item, principalId);
  }

  async start(principalId: string, role: string, intent: string, key: string): Promise<SecondaryJourneyView> {
    if (role !== "employee") throw new WorkflowError("forbidden", "Only employees may start this demo journey");
    if (!isSecondaryIntent(intent) || !/^[0-9a-f-]{36}$/iu.test(key)) {
      throw new WorkflowError("invalid_input", "Invalid demo journey intent or request key");
    }
    // A lost HTTP response must not create a second workflow on explicit retry.
    // First read the original owner-scoped submission, then handle a concurrent
    // unique-key conflict by reading the existing committed instance again.
    const existing = await this.currentOwnedStart(principalId, key, intent);
    if (existing) return existing;
    const mocks = await this.findMovingMocks(principalId, key);
    if (intent !== "moving" && mocks.length) {
      throw new WorkflowError("conflict", "This request key belongs to a moving journey");
    }
    if (intent === "moving") {
      // Each reference adapter gets its own transaction and version. A failure
      // starting one mock cannot undo another; same-key retry fills missing ones.
      for (const step of MOVING_MOCK_STEPS) {
        if (mocks.some(row => row.key === step.key)) continue;
        try {
          await this.workflow.start({
            resourceType: MOVING_MOCK_RESOURCE_TYPE,
            resourceId: movingMockResourceId(key, step.key),
            definitionKey: step.definitionKey,
            definitionVersion: 1,
            requesterId: principalId,
            submissionKey: movingMockSubmissionKey(principalId, key, step.key),
          });
        } catch (caught) {
          if (!(caught instanceof WorkflowError && caught.code === "conflict"
            && (await this.findMovingMocks(principalId, key)).some(row => row.key === step.key))) throw caught;
        }
      }
      return projectMovingMockJourney(key, principalId, await this.findMovingMocks(principalId, key));
    }
    try {
      const result = await this.workflow.start({
        resourceType: SECONDARY_RESOURCE_TYPE,
        resourceId: key,
        definitionKey: CONFIG[intent].definitionKey,
        definitionVersion: 1,
        requesterId: principalId,
        submissionKey: `workhub-secondary:${principalId}:${key}`,
      });
      return this.projectInstance(result.instance, result.currentWorkItem, principalId);
    } catch (caught) {
      if (caught instanceof WorkflowError && caught.code === "conflict") {
        const concurrentlyCreated = await this.currentOwnedStart(principalId, key, intent);
        if (concurrentlyCreated) return concurrentlyCreated;
      }
      throw caught;
    }
  }

  /**
   * PC-only exception handling. The current Workflow work item and requester
   * are the authorization boundary; no simulated stock or device record exists.
   */
  async decidePcReplacement(
    principalId: string, role: string, id: string,
    action: "return" | "reject" | "resubmit",
    version: number, workItemVersion?: number,
  ): Promise<SecondaryJourneyView> {
    const instance = await this.store.getInstance(id, this.environment);
    if (!instance || instance.resourceType !== SECONDARY_RESOURCE_TYPE
      || instance.definitionKey !== CONFIG["pc-replacement"].definitionKey) {
      throw new WorkflowError("not_found", "PC replacement demo is unavailable");
    }
    if (action === "resubmit") {
      if (role !== "employee" || principalId !== instance.requesterId
        || instance.state !== "awaiting_resubmission") {
        throw new WorkflowError("not_found", "PC replacement correction is unavailable");
      }
      const result = await this.workflow.resubmit({
        instanceId: id, actorId: principalId, expectedInstanceVersion: version,
      });
      return this.projectInstance(result.instance, result.currentWorkItem, principalId);
    }
    const workItem = await this.store.getOpenWorkItem(id, this.environment);
    if (role !== "corporate" || principalId !== "workhub-demo-sora"
      || !workItem || workItem.assigneePrincipal !== principalId
      || workItemVersion === undefined) {
      throw new WorkflowError("not_found", "PC replacement work item is unavailable");
    }
    if (action === "return" && instance.currentStepKey !== "intake") {
      throw new WorkflowError("invalid_state", "Information request is available only at intake");
    }
    if (action === "reject" && instance.currentStepKey !== "processing") {
      throw new WorkflowError("invalid_state", "Stock unavailable is available only at processing");
    }
    const command = {
      instanceId: id, actorId: principalId,
      expectedInstanceVersion: version, expectedWorkItemVersion: workItemVersion,
      reasonCode: action === "return" ? "additional_information" : "no_stock",
      comment: action === "return"
        ? "追加情報の確認が必要です（Referenceデモ）"
        : "デモ在庫なしとして処理を終了します（Referenceデモ）",
    };
    const result = action === "return"
      ? await this.workflow.returnForCorrection(command)
      : await this.workflow.reject(command);
    return this.projectInstance(result.instance, result.currentWorkItem, principalId);
  }

  async advance(
    principalId: string, role: string, id: string,
    version: number, workItemVersion: number, stepKey?: string,
  ): Promise<SecondaryJourneyView> {
    if (role !== "employee" && role !== "corporate") {
      throw new WorkflowError("forbidden", "Demo workflow access denied");
    }
    if (stepKey) {
      if (role !== "employee" || !isMovingMockStepKey(stepKey)) {
        throw new WorkflowError("not_found", "Demo step is unavailable");
      }
      const records = await this.findMovingMocks(principalId, id);
      const record = records.find(x => x.key === stepKey);
      if (!record || record.item?.assigneePrincipal !== principalId) {
        throw new WorkflowError("not_found", "Demo step is unavailable");
      }
      await this.workflow.approve({
        instanceId: record.instance.id, actorId: principalId,
        expectedInstanceVersion: version, expectedWorkItemVersion: workItemVersion,
      });
      return projectMovingMockJourney(id, principalId, await this.findMovingMocks(principalId, id));
    }
    const instance = await this.store.getInstance(id, this.environment);
    if (!instance || instance.resourceType !== SECONDARY_RESOURCE_TYPE
      || !SECONDARY_DEFINITIONS.some(d => d.key === instance.definitionKey)) {
      throw new WorkflowError("not_found", "Demo journey not available");
    }
    const item = await this.store.getOpenWorkItem(id, this.environment);
    if (!item || item.assigneePrincipal !== principalId) {
      throw new WorkflowError("not_found", "Demo work item not available");
    }
    if (role === "employee" && instance.requesterId !== principalId) {
      throw new WorkflowError("not_found", "Demo work item not available");
    }
    if (role === "corporate" && principalId !== "workhub-demo-sora") {
      throw new WorkflowError("not_found", "Demo work item not available");
    }
    const result = await this.workflow.approve({
      instanceId: instance.id,
      actorId: principalId,
      expectedInstanceVersion: version,
      expectedWorkItemVersion: workItemVersion,
    });
    return this.projectInstance(result.instance, result.currentWorkItem, principalId);
  }
}
