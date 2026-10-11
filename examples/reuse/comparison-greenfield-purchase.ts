/**
 * #475 comparison arm B: a minimal greenfield purchase approval implementation.
 * Generated within this already-informed ChatGPT session; NOT independent
 * blind-AI evidence, a production workflow library, or a recommended Core.
 *
 * Intentionally imports no Template source and only implements the frozen
 * purchase-approval acceptance surface. No durable store, audit or recovery.
 */

type Role = "employee" | "manager" | "finance" | string;
type Membership = { userId: string; scopeId: string; role: Role };
type Actor = { id: string; membership: Membership | null };
type Purchase = { id: string; scopeId: string; requesterId: string; totalYen: number };
type Phase = "department_review" | "finance_review";
type State = "active" | "completed";
type Item = { assigneePrincipal: string; version: number };
type Instance = {
  id: string;
  resourceType: "purchase_request";
  resourceId: string;
  definitionKey: "purchase_approval";
  state: State;
  version: number;
  currentStepKey: Phase | null;
};
type Result = { instance: Instance; currentWorkItem: Item | null };
type Saved = { instance: Instance; item: Item | null };

class PurchaseError extends Error {
  constructor(public readonly code: "forbidden" | "conflict" | "assignee_unresolved") {
    super(code);
  }
}
const reject = (message: string): never => { throw new Error(message); };

function checkActor(actor: Actor, purchase: Purchase, action: "submit" | "approve"): void {
  const membership = actor.membership;
  if (!membership || membership.userId !== actor.id) reject("actor_membership_mismatch");
  if (membership.scopeId !== purchase.scopeId) reject("membership_scope_mismatch");
  if (action === "submit" && membership.role !== "employee") reject("role_required");
  if (action === "approve" && membership.role !== "manager" && membership.role !== "finance") {
    reject("role_required");
  }
}

export function createPurchaseApprovalSpike(
  options: { departmentManagerId?: string | null; financeReviewerId?: string | null } = {},
) {
  const instances = new Map<string, Saved>();
  const manager = options.departmentManagerId === undefined ? "manager-001" : options.departmentManagerId;
  const finance = options.financeReviewerId === undefined ? "finance-001" : options.financeReviewerId;

  // Copy snapshots so an earlier result cannot change after a later mutation.
  const snapshot = (saved: Saved): Result => ({
    instance: { ...saved.instance },
    currentWorkItem: saved.item ? { ...saved.item } : null,
  });

  async function submit(purchase: Purchase, actor: Actor): Promise<Result> {
    if (actor.id !== purchase.requesterId) reject("requester_mismatch");
    checkActor(actor, purchase, "submit");
    if (!Number.isSafeInteger(purchase.totalYen) || purchase.totalYen <= 0) {
      reject("purchase_amount_invalid");
    }
    if (instances.has(purchase.id)) throw new PurchaseError("conflict");
    if (!manager) throw new PurchaseError("assignee_unresolved");
    const saved: Saved = {
      instance: {
        id: purchase.id,
        resourceType: "purchase_request",
        resourceId: purchase.id,
        definitionKey: "purchase_approval",
        state: "active",
        version: 1,
        currentStepKey: "department_review",
      },
      item: { assigneePrincipal: manager, version: 1 },
    };
    instances.set(purchase.id, saved);
    return snapshot(saved);
  }

  async function approve(purchase: Purchase, actor: Actor, current: Result): Promise<Result> {
    checkActor(actor, purchase, "approve");
    if (current.instance.resourceType !== "purchase_request"
      || current.instance.resourceId !== purchase.id) reject("purchase_workflow_mismatch");
    if (!current.currentWorkItem) reject("no_open_work_item");
    const saved = instances.get(purchase.id);
    if (!saved || !saved.item || saved.instance.state !== "active") {
      throw new PurchaseError("conflict");
    }
    if (saved.instance.version !== current.instance.version
      || saved.item.version !== current.currentWorkItem.version) {
      throw new PurchaseError("conflict");
    }
    if (saved.item.assigneePrincipal !== actor.id) throw new PurchaseError("forbidden");
    // Resolve the second approver before committing the first decision.
    if (saved.instance.currentStepKey === "department_review" && !finance) {
      throw new PurchaseError("assignee_unresolved");
    }
    const nextStep = saved.instance.currentStepKey === "department_review" ? "finance_review" : null;
    const updated: Saved = {
      instance: {
        ...saved.instance,
        version: saved.instance.version + 1,
        state: nextStep ? "active" : "completed",
        currentStepKey: nextStep,
      },
      item: nextStep ? { assigneePrincipal: finance!, version: 1 } : null,
    };
    instances.set(purchase.id, updated);
    return snapshot(updated);
  }

  return {
    submit,
    approve,
    store: {
      async listOpenWorkItems(principal: string, environment: string) {
        if (environment !== "test") return [];
        return [...instances.values()].filter((saved) =>
          saved.item?.assigneePrincipal === principal && saved.instance.state === "active")
          .map((saved) => ({ ...saved.item!, status: "open" }));
      },
    },
  };
}
