import type {
  WorkflowInstanceRecord,
  WorkflowMutationBundle,
  WorkflowStartBundle,
  WorkflowStore,
  WorkflowWorkItemRecord,
} from "./types";

interface InstanceRow {
  id: string;
  environment: string;
  resource_type: string;
  resource_id: string;
  definition_key: string;
  definition_version: number;
  requester_id: string;
  state: WorkflowInstanceRecord["state"];
  current_step_key: string | null;
  returned_step_key: string | null;
  version: number;
  next_work_item_sequence: number;
  next_transition_sequence: number;
  submission_key: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface WorkItemRow {
  id: string;
  environment: string;
  workflow_instance_id: string;
  step_key: string;
  assignee_principal: string;
  status: WorkflowWorkItemRecord["status"];
  sequence: number;
  version: number;
  created_at: string;
  due_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

const changesOf = (result: D1Result<unknown>): number =>
  typeof result.meta?.changes === "number" ? result.meta.changes : 0;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

const mapInstance = (row: InstanceRow): WorkflowInstanceRecord => ({
  id: row.id,
  environment: row.environment,
  resourceType: row.resource_type,
  resourceId: row.resource_id,
  definitionKey: row.definition_key,
  definitionVersion: row.definition_version,
  requesterId: row.requester_id,
  state: row.state,
  currentStepKey: row.current_step_key,
  returnedStepKey: row.returned_step_key,
  version: row.version,
  nextWorkItemSequence: row.next_work_item_sequence,
  nextTransitionSequence: row.next_transition_sequence,
  submissionKey: row.submission_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

const mapWorkItem = (row: WorkItemRow): WorkflowWorkItemRecord => ({
  id: row.id,
  environment: row.environment,
  workflowInstanceId: row.workflow_instance_id,
  stepKey: row.step_key,
  assigneePrincipal: row.assignee_principal,
  status: row.status,
  sequence: row.sequence,
  version: row.version,
  createdAt: row.created_at,
  dueAt: row.due_at,
  completedAt: row.completed_at,
  completedBy: row.completed_by,
});

const insertWorkItemStatement = (db: D1Database, item: WorkflowWorkItemRecord) => db.prepare(`
  INSERT INTO workflow_work_items (
    id, environment, workflow_instance_id, step_key, assignee_principal,
    status, sequence, version, created_at, due_at, completed_at, completed_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).bind(
  item.id,
  item.environment,
  item.workflowInstanceId,
  item.stepKey,
  item.assigneePrincipal,
  item.status,
  item.sequence,
  item.version,
  item.createdAt,
  item.dueAt,
  item.completedAt,
  item.completedBy,
);

export class WorkflowStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowStoreIntegrityError";
  }
}

export class D1WorkflowStore implements WorkflowStore {
  constructor(private readonly db: D1Database) {}

  async create(bundle: WorkflowStartBundle): Promise<boolean> {
    const { instance, workItem, transition } = bundle;
    try {
      const results = await this.db.batch([
        this.db.prepare(`
          INSERT INTO workflow_instances (
            id, environment, resource_type, resource_id, definition_key, definition_version,
            requester_id, state, current_step_key, returned_step_key, version,
            next_work_item_sequence, next_transition_sequence, submission_key,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          instance.id,
          instance.environment,
          instance.resourceType,
          instance.resourceId,
          instance.definitionKey,
          instance.definitionVersion,
          instance.requesterId,
          instance.state,
          instance.currentStepKey,
          instance.returnedStepKey,
          instance.version,
          instance.nextWorkItemSequence,
          instance.nextTransitionSequence,
          instance.submissionKey,
          instance.createdAt,
          instance.updatedAt,
          instance.completedAt,
        ),
        insertWorkItemStatement(this.db, workItem),
        this.insertTransition(transition),
      ]);
      if (results.length !== 3 || results.some((result) => changesOf(result) !== 1)) {
        throw new WorkflowStoreIntegrityError("workflow create batch did not persist every record");
      }
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw error;
    }
  }

  async getInstance(instanceId: string, environment: string): Promise<WorkflowInstanceRecord | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, resource_type, resource_id, definition_key, definition_version,
             requester_id, state, current_step_key, returned_step_key, version,
             next_work_item_sequence, next_transition_sequence, submission_key,
             created_at, updated_at, completed_at
      FROM workflow_instances
      WHERE id = ? AND environment = ?
    `).bind(instanceId, environment).first<InstanceRow>();
    return row ? mapInstance(row) : null;
  }

  async getOpenWorkItem(instanceId: string, environment: string): Promise<WorkflowWorkItemRecord | null> {
    const row = await this.db.prepare(`
      SELECT id, environment, workflow_instance_id, step_key, assignee_principal,
             status, sequence, version, created_at, due_at, completed_at, completed_by
      FROM workflow_work_items
      WHERE workflow_instance_id = ? AND environment = ? AND status = 'open'
      LIMIT 1
    `).bind(instanceId, environment).first<WorkItemRow>();
    return row ? mapWorkItem(row) : null;
  }

  async apply(bundle: WorkflowMutationBundle): Promise<boolean> {
    const { instance, completedWorkItem, nextWorkItem, transition } = bundle;
    const expectedItemId = completedWorkItem?.id ?? null;
    const expectedItemVersion = bundle.expectedWorkItemVersion ?? null;
    const requireNoOpenItem = nextWorkItem && !completedWorkItem ? 1 : 0;

    const instanceUpdate = this.db.prepare(`
      UPDATE workflow_instances
      SET state = ?, current_step_key = ?, returned_step_key = ?, version = ?,
          next_work_item_sequence = ?, next_transition_sequence = ?,
          updated_at = ?, completed_at = ?
      WHERE id = ? AND environment = ? AND version = ?
        AND (
          ? IS NULL
          OR EXISTS (
            SELECT 1 FROM workflow_work_items wi
            WHERE wi.id = ?
              AND wi.workflow_instance_id = workflow_instances.id
              AND wi.environment = workflow_instances.environment
              AND wi.status = 'open'
              AND wi.version = ?
          )
        )
        AND (
          ? = 0
          OR NOT EXISTS (
            SELECT 1 FROM workflow_work_items wi2
            WHERE wi2.workflow_instance_id = workflow_instances.id
              AND wi2.environment = workflow_instances.environment
              AND wi2.status = 'open'
          )
        )
    `).bind(
      instance.state,
      instance.currentStepKey,
      instance.returnedStepKey,
      instance.version,
      instance.nextWorkItemSequence,
      instance.nextTransitionSequence,
      instance.updatedAt,
      instance.completedAt,
      instance.id,
      instance.environment,
      bundle.expectedInstanceVersion,
      expectedItemId,
      expectedItemId,
      expectedItemVersion,
      requireNoOpenItem,
    );

    const statements: D1PreparedStatement[] = [instanceUpdate];
    if (completedWorkItem) {
      statements.push(this.db.prepare(`
        UPDATE workflow_work_items
        SET status = ?, version = ?, completed_at = ?, completed_by = ?
        WHERE id = ? AND environment = ? AND workflow_instance_id = ?
          AND status = 'open' AND version = ?
          AND EXISTS (
            SELECT 1 FROM workflow_instances i
            WHERE i.id = workflow_work_items.workflow_instance_id
              AND i.environment = workflow_work_items.environment
              AND i.version = ?
          )
      `).bind(
        completedWorkItem.status,
        completedWorkItem.version,
        completedWorkItem.completedAt,
        completedWorkItem.completedBy,
        completedWorkItem.id,
        completedWorkItem.environment,
        completedWorkItem.workflowInstanceId,
        bundle.expectedWorkItemVersion,
        instance.version,
      ));
    }
    if (nextWorkItem) statements.push(insertWorkItemStatement(this.db, nextWorkItem));
    statements.push(this.insertTransition(transition));

    try {
      const results = await this.db.batch(statements);
      const firstChanges = changesOf(results[0] as D1Result<unknown>);
      if (firstChanges === 0) return false;
      if (results.length !== statements.length || results.some((result) => changesOf(result) !== 1)) {
        throw new WorkflowStoreIntegrityError("workflow mutation batch persisted an unexpected number of rows");
      }
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw error;
    }
  }

  async listOpenWorkItems(
    assigneePrincipal: string,
    environment: string,
    limit = 50,
  ): Promise<readonly WorkflowWorkItemRecord[]> {
    const result = await this.db.prepare(`
      SELECT id, environment, workflow_instance_id, step_key, assignee_principal,
             status, sequence, version, created_at, due_at, completed_at, completed_by
      FROM workflow_work_items
      WHERE environment = ? AND assignee_principal = ? AND status = 'open'
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).bind(environment, assigneePrincipal, limit).all<WorkItemRow>();
    return (result.results ?? []).map(mapWorkItem);
  }

  private insertTransition(transition: WorkflowMutationBundle["transition"] | WorkflowStartBundle["transition"]) {
    return this.db.prepare(`
      INSERT INTO workflow_transitions (
        id, environment, workflow_instance_id, work_item_id, sequence, transition,
        actor_id, from_state, to_state, from_step_key, to_step_key,
        definition_version, reason_code, comment, request_id, correlation_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transition.id,
      transition.environment,
      transition.workflowInstanceId,
      transition.workItemId,
      transition.sequence,
      transition.transition,
      transition.actorId,
      transition.fromState,
      transition.toState,
      transition.fromStepKey,
      transition.toStepKey,
      transition.definitionVersion,
      transition.reasonCode,
      transition.comment,
      transition.requestId,
      transition.correlationId,
      transition.occurredAt,
    );
  }
}
