/**
 * #475 controlled reuse spike: a PURCHASE approval consumer independent of WORKHUB.
 * Demonstrates existing Workflow/Authorization foundation with a new domain.
 * Local/InMemory only. NOT an integrated production purchase workflow or external adoption.
 */
import { authorizeScopedAction, type ScopeMembership, type RolePolicy } from "../../src/worker/authorization";
import {
  InMemoryWorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowService,
  type WorkflowAssigneeResolver,
  type WorkflowDefinition,
  type WorkflowMutationResult,
} from "../../src/worker/workflow";

export interface PurchaseRequest {
  readonly id: string;
  readonly scopeId: string;
  readonly requesterId: string;
  readonly totalYen: number;
}

export interface PurchaseActor {
  readonly id: string;
  readonly membership: ScopeMembership | null;
}

const purchasePolicy: RolePolicy = {
  "purchase:submit": ["employee"],
  "purchase:approve": ["manager", "finance"],
};

const purchaseWorkflow: WorkflowDefinition = {
  key: "purchase_approval",
  version: 1,
  steps: [
    { key: "department_review", assigneeResolverKey: "department_manager", reasonPolicy: { return: "required" } },
    { key: "finance_review", assigneeResolverKey: "finance_reviewer", reasonPolicy: { reject: "required" } },
  ],
};

function requirePurchaseAccess(
  actor: PurchaseActor,
  request: PurchaseRequest,
  action: "purchase:submit" | "purchase:approve",
): void {
  // The membership record is not a login session. Bind it to the claimed actor explicitly.
  if (!actor.membership || actor.membership.userId !== actor.id) {
    throw new Error("actor_membership_mismatch");
  }
  const decision = authorizeScopedAction(purchasePolicy, {
    action,
    requestedScopeId: request.scopeId,
    resourceScopeId: request.scopeId,
    membership: actor.membership,
  });
  if (!decision.allowed) throw new Error(decision.reason);
}

export interface PurchaseApprovalSpikeOptions {
  readonly departmentManagerId?: string | null;
  readonly financeReviewerId?: string | null;
}

export function createPurchaseApprovalSpike(options: PurchaseApprovalSpikeOptions = {}) {
  const store = new InMemoryWorkflowStore();
  let idCounter = 0;

  // This resolver is intentionally specific to the example: real projects must
  // resolve the approver via their directory/approval rules, fail closed on ambiguity.
  const assignees: WorkflowAssigneeResolver = {
    async resolve(key) {
      if (key === "department_manager") {
        return options.departmentManagerId === undefined ? "manager-001" : options.departmentManagerId;
      }
      if (key === "finance_reviewer") {
        return options.financeReviewerId === undefined ? "finance-001" : options.financeReviewerId;
      }
      return null;
    },
  };

  const workflow = new WorkflowService({
    environment: "test",
    store,
    definitions: new StaticWorkflowDefinitionRegistry([purchaseWorkflow]),
    assignees,
    now: () => new Date("2026-10-11T01:00:00.000Z"),
    generateId: () => `purchase-test-${++idCounter}`,
  });

  const submit = (request: PurchaseRequest, actor: PurchaseActor): Promise<WorkflowMutationResult> => {
    if (actor.id !== request.requesterId) throw new Error("requester_mismatch");
    requirePurchaseAccess(actor, request, "purchase:submit");
    if (!Number.isSafeInteger(request.totalYen) || request.totalYen <= 0) {
      throw new Error("purchase_amount_invalid");
    }

    return workflow.start({
      resourceType: "purchase_request",
      resourceId: request.id,
      requesterId: request.requesterId,
      definitionKey: purchaseWorkflow.key,
      definitionVersion: purchaseWorkflow.version,
      submissionKey: `purchase:${request.id}:v1`,
    });
  };

  const approve = (
    request: PurchaseRequest,
    actor: PurchaseActor,
    current: WorkflowMutationResult,
  ): Promise<WorkflowMutationResult> => {
    requirePurchaseAccess(actor, request, "purchase:approve");
    if (current.instance.resourceType !== "purchase_request"
      || current.instance.resourceId !== request.id) {
      throw new Error("purchase_workflow_mismatch");
    }
    if (!current.currentWorkItem) throw new Error("no_open_work_item");
    return workflow.approve({
      instanceId: current.instance.id,
      actorId: actor.id,
      expectedInstanceVersion: current.instance.version,
      expectedWorkItemVersion: current.currentWorkItem.version,
    });
  };

  return { store, workflow, submit, approve };
}
