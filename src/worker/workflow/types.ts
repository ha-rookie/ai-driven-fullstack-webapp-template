export type WorkflowInstanceState =
  | "active"
  | "awaiting_resubmission"
  | "completed"
  | "rejected"
  | "withdrawn";

export type WorkflowWorkItemStatus =
  | "open"
  | "approved"
  | "returned"
  | "rejected"
  | "cancelled";

export type WorkflowTransitionType =
  | "submit"
  | "approve"
  | "return"
  | "resubmit"
  | "reject"
  | "withdraw";

export type WorkflowReasonPolicy = "required" | "optional" | "forbidden";

export interface WorkflowStepDefinition {
  readonly key: string;
  readonly assigneeResolverKey: string;
  readonly reasonPolicy?: Partial<Record<"approve" | "return" | "reject", WorkflowReasonPolicy>>;
}

export interface WorkflowDefinition {
  readonly key: string;
  readonly version: number;
  readonly steps: readonly WorkflowStepDefinition[];
  readonly allowWithdrawWhileActive?: boolean;
  readonly allowWithdrawWhileAwaitingResubmission?: boolean;
}

export interface WorkflowDefinitionResolver {
  resolve(key: string, version: number): WorkflowDefinition | null;
}

export interface WorkflowAssigneeContext {
  readonly definitionKey: string;
  readonly definitionVersion: number;
  readonly stepKey: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly requesterId: string;
}

export interface WorkflowAssigneeResolver {
  resolve(resolverKey: string, context: WorkflowAssigneeContext): Promise<string | null>;
}

export interface WorkflowInstanceRecord {
  readonly id: string;
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly definitionKey: string;
  readonly definitionVersion: number;
  readonly requesterId: string;
  readonly state: WorkflowInstanceState;
  readonly currentStepKey: string | null;
  readonly returnedStepKey: string | null;
  readonly version: number;
  readonly nextWorkItemSequence: number;
  readonly nextTransitionSequence: number;
  readonly submissionKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface WorkflowWorkItemRecord {
  readonly id: string;
  readonly environment: string;
  readonly workflowInstanceId: string;
  readonly stepKey: string;
  readonly assigneePrincipal: string;
  readonly status: WorkflowWorkItemStatus;
  readonly sequence: number;
  readonly version: number;
  readonly createdAt: string;
  readonly dueAt: string | null;
  readonly completedAt: string | null;
  readonly completedBy: string | null;
}

export interface WorkflowTransitionRecord {
  readonly id: string;
  readonly environment: string;
  readonly workflowInstanceId: string;
  readonly workItemId: string | null;
  readonly sequence: number;
  readonly transition: WorkflowTransitionType;
  readonly actorId: string;
  readonly fromState: WorkflowInstanceState | null;
  readonly toState: WorkflowInstanceState;
  readonly fromStepKey: string | null;
  readonly toStepKey: string | null;
  readonly definitionVersion: number;
  readonly reasonCode: string | null;
  readonly comment: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly occurredAt: string;
}

export interface WorkflowStartBundle {
  readonly instance: WorkflowInstanceRecord;
  readonly workItem: WorkflowWorkItemRecord;
  readonly transition: WorkflowTransitionRecord;
}

export interface WorkflowMutationBundle {
  readonly expectedInstanceVersion: number;
  readonly expectedWorkItemVersion?: number;
  readonly instance: WorkflowInstanceRecord;
  readonly completedWorkItem?: WorkflowWorkItemRecord;
  readonly nextWorkItem?: WorkflowWorkItemRecord;
  readonly transition: WorkflowTransitionRecord;
}

export interface WorkflowStore {
  create(bundle: WorkflowStartBundle): Promise<boolean>;
  getInstance(instanceId: string, environment: string): Promise<WorkflowInstanceRecord | null>;
  getOpenWorkItem(instanceId: string, environment: string): Promise<WorkflowWorkItemRecord | null>;
  apply(bundle: WorkflowMutationBundle): Promise<boolean>;
  listOpenWorkItems(
    assigneePrincipal: string,
    environment: string,
    limit?: number,
  ): Promise<readonly WorkflowWorkItemRecord[]>;
}

export interface WorkflowMutationGate {
  assertMutationAllowed(): Promise<void> | void;
}

export interface WorkflowEventSink {
  emit(event: WorkflowTransitionRecord): Promise<void> | void;
}

export interface WorkflowCommandContext {
  readonly requestId?: string;
  readonly correlationId?: string;
}

export interface StartWorkflowCommand extends WorkflowCommandContext {
  readonly submissionKey: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly definitionKey: string;
  readonly definitionVersion: number;
  readonly requesterId: string;
}

export interface WorkItemActionCommand extends WorkflowCommandContext {
  readonly instanceId: string;
  readonly actorId: string;
  readonly expectedInstanceVersion: number;
  readonly expectedWorkItemVersion: number;
  readonly reasonCode?: string;
  readonly comment?: string;
}

export interface ResubmitWorkflowCommand extends WorkflowCommandContext {
  readonly instanceId: string;
  readonly actorId: string;
  readonly expectedInstanceVersion: number;
}

export interface WithdrawWorkflowCommand extends WorkflowCommandContext {
  readonly instanceId: string;
  readonly actorId: string;
  readonly expectedInstanceVersion: number;
  readonly expectedWorkItemVersion?: number;
  readonly reasonCode?: string;
  readonly comment?: string;
}

export interface WorkflowMutationResult {
  readonly instance: WorkflowInstanceRecord;
  readonly transition: WorkflowTransitionRecord;
  readonly currentWorkItem: WorkflowWorkItemRecord | null;
}
