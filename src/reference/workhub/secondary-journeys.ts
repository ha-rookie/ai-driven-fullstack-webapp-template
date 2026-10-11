import {
  D1WorkflowStore, StaticWorkflowDefinitionRegistry, WorkflowError,
  WorkflowService,
  type WorkflowDefinition, type WorkflowInstanceRecord, type WorkflowWorkItemRecord,
} from "../../worker/workflow";

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
  readonly status: "done" | "current" | "pending";
}
export interface SecondaryJourneyView {
  readonly id: string;
  readonly intent: SecondaryIntent;
  readonly title: string;
  readonly requesterId: string;
  readonly state: "in_progress" | "completed";
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
): SecondaryJourneyView => {
  const intent: SecondaryIntent = instance.definitionKey === CONFIG.moving.definitionKey
    ? "moving" : "pc-replacement";
  const spec = CONFIG[intent];
  const current = spec.steps.findIndex(([key]) => key === instance.currentStepKey);
  return {
    id: instance.id,
    intent,
    title: spec.title,
    requesterId: instance.requesterId,
    state: instance.state === "completed" ? "completed" : "in_progress",
    version: instance.version,
    workItemVersion: item?.version ?? null,
    assignedToMe: item?.assigneePrincipal === principalId,
    submissionKey: instance.submissionKey,
    steps: spec.steps.map(([key, label], index) => ({
      key, label,
      status: instance.state === "completed" || (current >= 0 && index < current)
        ? "done" : index === current ? "current" : "pending",
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
      definitions: new StaticWorkflowDefinitionRegistry(SECONDARY_DEFINITIONS),
      assignees: {
        resolve: async (key, context) =>
          key === "requester" ? context.requesterId
            : key === "corporate" ? "workhub-demo-sora" : null,
      },
    });
  }

  async list(principalId: string, role: string): Promise<readonly SecondaryJourneyView[]> {
    if (role !== "employee" && role !== "corporate") return [];
    const result = await this.db.prepare(`
      SELECT i.id FROM workflow_instances i
      WHERE i.environment = ? AND i.resource_type = ?
        AND (
          (i.requester_id = ? AND ? = 'employee')
          OR (? = 'corporate' AND EXISTS (
            SELECT 1 FROM workflow_work_items w
            WHERE w.workflow_instance_id = i.id AND w.environment = i.environment
              AND w.assignee_principal = ? AND w.status = 'open'
          ))
        )
      ORDER BY i.created_at DESC, i.id DESC LIMIT 25
    `).bind(this.environment, SECONDARY_RESOURCE_TYPE, principalId, role, role, principalId).all<{ id: string }>();
    const views: SecondaryJourneyView[] = [];
    for (const { id } of result.results ?? []) {
      const instance = await this.store.getInstance(id, this.environment);
      if (!instance || !SECONDARY_DEFINITIONS.some(d => d.key === instance.definitionKey)) continue;
      const item = await this.store.getOpenWorkItem(id, this.environment);
      views.push(projectSecondaryJourney(instance, item, principalId));
    }
    return views;
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
    return projectSecondaryJourney(instance, item, principalId);
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
    try {
      const result = await this.workflow.start({
        resourceType: SECONDARY_RESOURCE_TYPE,
        resourceId: key,
        definitionKey: CONFIG[intent].definitionKey,
        definitionVersion: 1,
        requesterId: principalId,
        submissionKey: `workhub-secondary:${principalId}:${key}`,
      });
      return projectSecondaryJourney(result.instance, result.currentWorkItem, principalId);
    } catch (caught) {
      if (caught instanceof WorkflowError && caught.code === "conflict") {
        const concurrentlyCreated = await this.currentOwnedStart(principalId, key, intent);
        if (concurrentlyCreated) return concurrentlyCreated;
      }
      throw caught;
    }
  }

  async advance(
    principalId: string, role: string, id: string,
    version: number, workItemVersion: number,
  ): Promise<SecondaryJourneyView> {
    if (role !== "employee" && role !== "corporate") {
      throw new WorkflowError("forbidden", "Demo workflow access denied");
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
    return projectSecondaryJourney(result.instance, result.currentWorkItem, principalId);
  }
}
