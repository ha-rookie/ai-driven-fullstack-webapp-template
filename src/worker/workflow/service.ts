import type {
  ResubmitWorkflowCommand,
  StartWorkflowCommand,
  WithdrawWorkflowCommand,
  WorkItemActionCommand,
  WorkflowAssigneeContext,
  WorkflowAssigneeResolver,
  WorkflowDefinition,
  WorkflowDefinitionResolver,
  WorkflowEventSink,
  WorkflowInstanceRecord,
  WorkflowMutationBundle,
  WorkflowMutationGate,
  WorkflowMutationResult,
  WorkflowReasonPolicy,
  WorkflowStepDefinition,
  WorkflowStore,
  WorkflowTransitionRecord,
  WorkflowTransitionType,
  WorkflowWorkItemRecord,
  WorkflowWorkItemStatus,
} from "./types";

const MAX_KEY_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const MAX_REASON_LENGTH = 128;
const MAX_COMMENT_LENGTH = 2000;
const DEFAULT_WORK_ITEM_LIMIT = 50;
const MAX_WORK_ITEM_LIMIT = 100;

export type WorkflowErrorCode =
  | "invalid_definition"
  | "invalid_input"
  | "assignee_unresolved"
  | "not_found"
  | "invalid_state"
  | "forbidden"
  | "reason_required"
  | "reason_forbidden"
  | "conflict";

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) return true;
  }
  return false;
};

const assertText = (value: string, name: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || containsControlCharacter(trimmed)) {
    throw new WorkflowError("invalid_input", `${name} is invalid`);
  }
  return trimmed;
};

const normalizeOptionalText = (
  value: string | undefined,
  name: string,
  maxLength: number,
): string | null => {
  if (value === undefined) return null;
  return assertText(value, name, maxLength);
};

const validateDefinition = (definition: WorkflowDefinition): void => {
  assertText(definition.key, "definition.key", MAX_KEY_LENGTH);
  if (!Number.isSafeInteger(definition.version) || definition.version <= 0) {
    throw new WorkflowError("invalid_definition", "definition.version must be a positive integer");
  }
  if (definition.steps.length === 0) {
    throw new WorkflowError("invalid_definition", "workflow must contain at least one step");
  }
  const keys = new Set<string>();
  for (const step of definition.steps) {
    assertText(step.key, "step.key", MAX_KEY_LENGTH);
    assertText(step.assigneeResolverKey, "step.assigneeResolverKey", MAX_KEY_LENGTH);
    if (keys.has(step.key)) {
      throw new WorkflowError("invalid_definition", `duplicate step key: ${step.key}`);
    }
    keys.add(step.key);
  }
};

const getStep = (definition: WorkflowDefinition, stepKey: string): WorkflowStepDefinition => {
  const step = definition.steps.find((candidate) => candidate.key === stepKey);
  if (!step) throw new WorkflowError("invalid_definition", `unknown step: ${stepKey}`);
  return step;
};

const resolveReasonPolicy = (
  step: WorkflowStepDefinition,
  action: "approve" | "return" | "reject",
): WorkflowReasonPolicy => step.reasonPolicy?.[action] ?? "optional";

const enforceReasonPolicy = (
  step: WorkflowStepDefinition,
  action: "approve" | "return" | "reject",
  reasonCode: string | null,
  comment: string | null,
): void => {
  const policy = resolveReasonPolicy(step, action);
  const hasReason = reasonCode !== null || comment !== null;
  if (policy === "required" && !hasReason) {
    throw new WorkflowError("reason_required", `${action} requires a reason`);
  }
  if (policy === "forbidden" && hasReason) {
    throw new WorkflowError("reason_forbidden", `${action} does not accept a reason`);
  }
};

export class StaticWorkflowDefinitionRegistry implements WorkflowDefinitionResolver {
  private readonly definitions = new Map<string, WorkflowDefinition>();

  constructor(definitions: readonly WorkflowDefinition[]) {
    for (const definition of definitions) {
      validateDefinition(definition);
      const compositeKey = `${definition.key}:${definition.version}`;
      if (this.definitions.has(compositeKey)) {
        throw new WorkflowError("invalid_definition", `duplicate workflow definition: ${compositeKey}`);
      }
      this.definitions.set(compositeKey, definition);
    }
  }

  resolve(key: string, version: number): WorkflowDefinition | null {
    return this.definitions.get(`${key}:${version}`) ?? null;
  }
}

export interface WorkflowServiceOptions {
  readonly environment: string;
  readonly store: WorkflowStore;
  readonly definitions: WorkflowDefinitionResolver;
  readonly assignees: WorkflowAssigneeResolver;
  readonly mutationGate?: WorkflowMutationGate;
  readonly eventSink?: WorkflowEventSink;
  readonly onEventFailure?: (event: WorkflowTransitionRecord) => void;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class WorkflowService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: WorkflowServiceOptions) {
    assertText(options.environment, "environment", MAX_KEY_LENGTH);
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  private async assertMutationAllowed(): Promise<void> {
    await this.options.mutationGate?.assertMutationAllowed();
  }

  private getDefinition(key: string, version: number): WorkflowDefinition {
    const definition = this.options.definitions.resolve(key, version);
    if (!definition) throw new WorkflowError("invalid_definition", "workflow definition not found");
    validateDefinition(definition);
    return definition;
  }

  private async resolveAssignee(
    definition: WorkflowDefinition,
    step: WorkflowStepDefinition,
    instanceLike: Pick<WorkflowInstanceRecord, "resourceType" | "resourceId" | "requesterId">,
  ): Promise<string> {
    const context: WorkflowAssigneeContext = {
      definitionKey: definition.key,
      definitionVersion: definition.version,
      stepKey: step.key,
      resourceType: instanceLike.resourceType,
      resourceId: instanceLike.resourceId,
      requesterId: instanceLike.requesterId,
    };
    const assignee = await this.options.assignees.resolve(step.assigneeResolverKey, context);
    if (!assignee) throw new WorkflowError("assignee_unresolved", "workflow assignee could not be resolved");
    return assertText(assignee, "assigneePrincipal", MAX_ID_LENGTH);
  }

  private async emit(event: WorkflowTransitionRecord): Promise<void> {
    if (!this.options.eventSink) return;
    try {
      await this.options.eventSink.emit(event);
    } catch {
      this.options.onEventFailure?.(event);
    }
  }

  async start(command: StartWorkflowCommand): Promise<WorkflowMutationResult> {
    await this.assertMutationAllowed();
    const definition = this.getDefinition(command.definitionKey, command.definitionVersion);
    const resourceType = assertText(command.resourceType, "resourceType", MAX_KEY_LENGTH);
    const resourceId = assertText(command.resourceId, "resourceId", MAX_ID_LENGTH);
    const requesterId = assertText(command.requesterId, "requesterId", MAX_ID_LENGTH);
    const submissionKey = assertText(command.submissionKey, "submissionKey", MAX_ID_LENGTH);
    const firstStep = definition.steps[0];
    if (!firstStep) throw new WorkflowError("invalid_definition", "workflow has no first step");

    const now = this.now().toISOString();
    const instanceId = this.generateId();
    const workItemId = this.generateId();
    const assignee = await this.resolveAssignee(definition, firstStep, {
      resourceType,
      resourceId,
      requesterId,
    });

    const instance: WorkflowInstanceRecord = {
      id: instanceId,
      environment: this.options.environment,
      resourceType,
      resourceId,
      definitionKey: definition.key,
      definitionVersion: definition.version,
      requesterId,
      state: "active",
      currentStepKey: firstStep.key,
      returnedStepKey: null,
      version: 1,
      nextWorkItemSequence: 2,
      nextTransitionSequence: 2,
      submissionKey,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    const workItem: WorkflowWorkItemRecord = {
      id: workItemId,
      environment: this.options.environment,
      workflowInstanceId: instanceId,
      stepKey: firstStep.key,
      assigneePrincipal: assignee,
      status: "open",
      sequence: 1,
      version: 1,
      createdAt: now,
      dueAt: null,
      completedAt: null,
      completedBy: null,
    };
    const transition: WorkflowTransitionRecord = {
      id: this.generateId(),
      environment: this.options.environment,
      workflowInstanceId: instanceId,
      workItemId,
      sequence: 1,
      transition: "submit",
      actorId: requesterId,
      fromState: null,
      toState: "active",
      fromStepKey: null,
      toStepKey: firstStep.key,
      definitionVersion: definition.version,
      reasonCode: null,
      comment: null,
      requestId: command.requestId ?? null,
      correlationId: command.correlationId ?? null,
      occurredAt: now,
    };

    if (!await this.options.store.create({ instance, workItem, transition })) {
      throw new WorkflowError("conflict", "workflow submission already exists or conflicted");
    }
    await this.emit(transition);
    return { instance, transition, currentWorkItem: workItem };
  }

  async approve(command: WorkItemActionCommand): Promise<WorkflowMutationResult> {
    return this.handleWorkItemAction("approve", command);
  }

  async returnForCorrection(command: WorkItemActionCommand): Promise<WorkflowMutationResult> {
    return this.handleWorkItemAction("return", command);
  }

  async reject(command: WorkItemActionCommand): Promise<WorkflowMutationResult> {
    return this.handleWorkItemAction("reject", command);
  }

  private async handleWorkItemAction(
    action: "approve" | "return" | "reject",
    command: WorkItemActionCommand,
  ): Promise<WorkflowMutationResult> {
    await this.assertMutationAllowed();
    const actorId = assertText(command.actorId, "actorId", MAX_ID_LENGTH);
    const instanceId = assertText(command.instanceId, "instanceId", MAX_ID_LENGTH);
    const reasonCode = normalizeOptionalText(command.reasonCode, "reasonCode", MAX_REASON_LENGTH);
    const comment = normalizeOptionalText(command.comment, "comment", MAX_COMMENT_LENGTH);
    const instance = await this.requireInstance(instanceId);
    if (instance.state !== "active" || !instance.currentStepKey) {
      throw new WorkflowError("invalid_state", "workflow is not awaiting an active work item");
    }
    if (instance.version !== command.expectedInstanceVersion) {
      throw new WorkflowError("conflict", "workflow instance version is stale");
    }
    const workItem = await this.requireOpenWorkItem(instance);
    if (workItem.version !== command.expectedWorkItemVersion) {
      throw new WorkflowError("conflict", "workflow work item version is stale");
    }
    if (workItem.assigneePrincipal !== actorId) {
      throw new WorkflowError("forbidden", "actor is not the current assignee");
    }

    const definition = this.getDefinition(instance.definitionKey, instance.definitionVersion);
    const step = getStep(definition, instance.currentStepKey);
    enforceReasonPolicy(step, action, reasonCode, comment);
    const now = this.now().toISOString();
    const completedWorkItem = this.completeWorkItem(workItem, action, actorId, now);

    let nextState: WorkflowInstanceRecord["state"];
    let nextStepKey: string | null = null;
    let returnedStepKey: string | null = null;
    let completedAt: string | null = null;
    let nextWorkItem: WorkflowWorkItemRecord | undefined;
    let nextWorkItemSequence = instance.nextWorkItemSequence;

    if (action === "return") {
      nextState = "awaiting_resubmission";
      returnedStepKey = step.key;
    } else if (action === "reject") {
      nextState = "rejected";
      completedAt = now;
    } else {
      const index = definition.steps.findIndex((candidate) => candidate.key === step.key);
      const nextStep = definition.steps[index + 1];
      if (!nextStep) {
        nextState = "completed";
        completedAt = now;
      } else {
        nextState = "active";
        nextStepKey = nextStep.key;
        const assignee = await this.resolveAssignee(definition, nextStep, instance);
        nextWorkItem = this.newWorkItem(instance, nextStep.key, assignee, nextWorkItemSequence, now);
        nextWorkItemSequence += 1;
      }
    }

    const nextInstance: WorkflowInstanceRecord = {
      ...instance,
      state: nextState,
      currentStepKey: nextStepKey,
      returnedStepKey,
      version: instance.version + 1,
      nextWorkItemSequence,
      nextTransitionSequence: instance.nextTransitionSequence + 1,
      updatedAt: now,
      completedAt,
    };
    const transition = this.newTransition({
      instance,
      workItemId: workItem.id,
      action,
      actorId,
      toState: nextState,
      toStepKey: nextStepKey,
      reasonCode,
      comment,
      context: command,
      occurredAt: now,
    });

    const bundle: WorkflowMutationBundle = {
      expectedInstanceVersion: command.expectedInstanceVersion,
      expectedWorkItemVersion: command.expectedWorkItemVersion,
      instance: nextInstance,
      completedWorkItem,
      nextWorkItem,
      transition,
    };
    if (!await this.options.store.apply(bundle)) {
      throw new WorkflowError("conflict", "workflow transition conflicted with a concurrent update");
    }
    await this.emit(transition);
    return { instance: nextInstance, transition, currentWorkItem: nextWorkItem ?? null };
  }

  async resubmit(command: ResubmitWorkflowCommand): Promise<WorkflowMutationResult> {
    await this.assertMutationAllowed();
    const actorId = assertText(command.actorId, "actorId", MAX_ID_LENGTH);
    const instance = await this.requireInstance(assertText(command.instanceId, "instanceId", MAX_ID_LENGTH));
    if (instance.state !== "awaiting_resubmission" || !instance.returnedStepKey) {
      throw new WorkflowError("invalid_state", "workflow is not awaiting resubmission");
    }
    if (actorId !== instance.requesterId) throw new WorkflowError("forbidden", "only requester can resubmit");
    if (instance.version !== command.expectedInstanceVersion) {
      throw new WorkflowError("conflict", "workflow instance version is stale");
    }
    if (await this.options.store.getOpenWorkItem(instance.id, this.options.environment)) {
      throw new WorkflowError("conflict", "resubmission cannot create a second open work item");
    }

    const definition = this.getDefinition(instance.definitionKey, instance.definitionVersion);
    const step = getStep(definition, instance.returnedStepKey);
    const assignee = await this.resolveAssignee(definition, step, instance);
    const now = this.now().toISOString();
    const nextWorkItem = this.newWorkItem(
      instance,
      step.key,
      assignee,
      instance.nextWorkItemSequence,
      now,
    );
    const nextInstance: WorkflowInstanceRecord = {
      ...instance,
      state: "active",
      currentStepKey: step.key,
      returnedStepKey: null,
      version: instance.version + 1,
      nextWorkItemSequence: instance.nextWorkItemSequence + 1,
      nextTransitionSequence: instance.nextTransitionSequence + 1,
      updatedAt: now,
      completedAt: null,
    };
    const transition = this.newTransition({
      instance,
      workItemId: nextWorkItem.id,
      action: "resubmit",
      actorId,
      toState: "active",
      toStepKey: step.key,
      reasonCode: null,
      comment: null,
      context: command,
      occurredAt: now,
    });
    if (!await this.options.store.apply({
      expectedInstanceVersion: command.expectedInstanceVersion,
      instance: nextInstance,
      nextWorkItem,
      transition,
    })) {
      throw new WorkflowError("conflict", "workflow resubmission conflicted with a concurrent update");
    }
    await this.emit(transition);
    return { instance: nextInstance, transition, currentWorkItem: nextWorkItem };
  }

  async withdraw(command: WithdrawWorkflowCommand): Promise<WorkflowMutationResult> {
    await this.assertMutationAllowed();
    const actorId = assertText(command.actorId, "actorId", MAX_ID_LENGTH);
    const instance = await this.requireInstance(assertText(command.instanceId, "instanceId", MAX_ID_LENGTH));
    if (actorId !== instance.requesterId) throw new WorkflowError("forbidden", "only requester can withdraw");
    if (instance.version !== command.expectedInstanceVersion) {
      throw new WorkflowError("conflict", "workflow instance version is stale");
    }
    const definition = this.getDefinition(instance.definitionKey, instance.definitionVersion);
    const now = this.now().toISOString();
    const reasonCode = normalizeOptionalText(command.reasonCode, "reasonCode", MAX_REASON_LENGTH);
    const comment = normalizeOptionalText(command.comment, "comment", MAX_COMMENT_LENGTH);
    let completedWorkItem: WorkflowWorkItemRecord | undefined;
    let workItemId: string | null = null;

    if (instance.state === "active") {
      if (definition.allowWithdrawWhileActive !== true) {
        throw new WorkflowError("invalid_state", "withdraw is not allowed while workflow is active");
      }
      const workItem = await this.requireOpenWorkItem(instance);
      if (command.expectedWorkItemVersion === undefined || workItem.version !== command.expectedWorkItemVersion) {
        throw new WorkflowError("conflict", "workflow work item version is stale");
      }
      completedWorkItem = {
        ...workItem,
        status: "cancelled",
        version: workItem.version + 1,
        completedAt: now,
        completedBy: actorId,
      };
      workItemId = workItem.id;
    } else if (instance.state === "awaiting_resubmission") {
      if (definition.allowWithdrawWhileAwaitingResubmission !== true) {
        throw new WorkflowError("invalid_state", "withdraw is not allowed while awaiting resubmission");
      }
    } else {
      throw new WorkflowError("invalid_state", "workflow is already terminal");
    }

    const nextInstance: WorkflowInstanceRecord = {
      ...instance,
      state: "withdrawn",
      currentStepKey: null,
      returnedStepKey: null,
      version: instance.version + 1,
      nextTransitionSequence: instance.nextTransitionSequence + 1,
      updatedAt: now,
      completedAt: now,
    };
    const transition = this.newTransition({
      instance,
      workItemId,
      action: "withdraw",
      actorId,
      toState: "withdrawn",
      toStepKey: null,
      reasonCode,
      comment,
      context: command,
      occurredAt: now,
    });
    if (!await this.options.store.apply({
      expectedInstanceVersion: command.expectedInstanceVersion,
      expectedWorkItemVersion: completedWorkItem ? command.expectedWorkItemVersion : undefined,
      instance: nextInstance,
      completedWorkItem,
      transition,
    })) {
      throw new WorkflowError("conflict", "workflow withdrawal conflicted with a concurrent update");
    }
    await this.emit(transition);
    return { instance: nextInstance, transition, currentWorkItem: null };
  }

  async listMyOpenWorkItems(assigneePrincipal: string, limit = DEFAULT_WORK_ITEM_LIMIT) {
    const assignee = assertText(assigneePrincipal, "assigneePrincipal", MAX_ID_LENGTH);
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_WORK_ITEM_LIMIT) {
      throw new WorkflowError("invalid_input", `limit must be between 1 and ${MAX_WORK_ITEM_LIMIT}`);
    }
    return this.options.store.listOpenWorkItems(assignee, this.options.environment, limit);
  }

  private async requireInstance(instanceId: string): Promise<WorkflowInstanceRecord> {
    const instance = await this.options.store.getInstance(instanceId, this.options.environment);
    if (!instance) throw new WorkflowError("not_found", "workflow instance not found");
    return instance;
  }

  private async requireOpenWorkItem(instance: WorkflowInstanceRecord): Promise<WorkflowWorkItemRecord> {
    const item = await this.options.store.getOpenWorkItem(instance.id, this.options.environment);
    if (!item || item.stepKey !== instance.currentStepKey) {
      throw new WorkflowError("invalid_state", "workflow has no matching open work item");
    }
    return item;
  }

  private newWorkItem(
    instance: WorkflowInstanceRecord,
    stepKey: string,
    assigneePrincipal: string,
    sequence: number,
    now: string,
  ): WorkflowWorkItemRecord {
    return {
      id: this.generateId(),
      environment: this.options.environment,
      workflowInstanceId: instance.id,
      stepKey,
      assigneePrincipal,
      status: "open",
      sequence,
      version: 1,
      createdAt: now,
      dueAt: null,
      completedAt: null,
      completedBy: null,
    };
  }

  private completeWorkItem(
    item: WorkflowWorkItemRecord,
    action: "approve" | "return" | "reject",
    actorId: string,
    now: string,
  ): WorkflowWorkItemRecord {
    const statuses: Record<typeof action, WorkflowWorkItemStatus> = {
      approve: "approved",
      return: "returned",
      reject: "rejected",
    };
    return {
      ...item,
      status: statuses[action],
      version: item.version + 1,
      completedAt: now,
      completedBy: actorId,
    };
  }

  private newTransition(input: {
    readonly instance: WorkflowInstanceRecord;
    readonly workItemId: string | null;
    readonly action: WorkflowTransitionType;
    readonly actorId: string;
    readonly toState: WorkflowInstanceRecord["state"];
    readonly toStepKey: string | null;
    readonly reasonCode: string | null;
    readonly comment: string | null;
    readonly context: { readonly requestId?: string; readonly correlationId?: string };
    readonly occurredAt: string;
  }): WorkflowTransitionRecord {
    return {
      id: this.generateId(),
      environment: this.options.environment,
      workflowInstanceId: input.instance.id,
      workItemId: input.workItemId,
      sequence: input.instance.nextTransitionSequence,
      transition: input.action,
      actorId: input.actorId,
      fromState: input.instance.state,
      toState: input.toState,
      fromStepKey: input.instance.currentStepKey ?? input.instance.returnedStepKey,
      toStepKey: input.toStepKey,
      definitionVersion: input.instance.definitionVersion,
      reasonCode: input.reasonCode,
      comment: input.comment,
      requestId: input.context.requestId ?? null,
      correlationId: input.context.correlationId ?? null,
      occurredAt: input.occurredAt,
    };
  }
}
