import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowError } from "../src/worker/workflow";
import {
  createPurchaseApprovalSpike, type PurchaseActor, type PurchaseRequest,
} from "../examples/reuse/purchase-approval";

const purchase: PurchaseRequest = {
  id: "office-printer-001",
  scopeId: "department-engineering",
  requesterId: "employee-001",
  totalYen: 85_000,
};
const employee: PurchaseActor = {
  id: "employee-001", membership: { userId: "employee-001", role: "employee", scopeId: purchase.scopeId },
};
const manager: PurchaseActor = {
  id: "manager-001", membership: { userId: "manager-001", role: "manager", scopeId: purchase.scopeId },
};
const finance: PurchaseActor = {
  id: "finance-001", membership: { userId: "finance-001", role: "finance", scopeId: purchase.scopeId },
};

test("non-WORKHUB purchase approval reuses generic WorkflowService for two different approvers", async () => {
  const app = createPurchaseApprovalSpike();
  const submitted = await app.submit(purchase, employee);
  assert.equal(submitted.instance.resourceType, "purchase_request");
  assert.equal(submitted.instance.definitionKey, "purchase_approval");
  assert.equal(submitted.currentWorkItem?.assigneePrincipal, "manager-001");

  const departmentApproved = await app.approve(purchase, manager, submitted);
  assert.equal(departmentApproved.instance.state, "active");
  assert.equal(departmentApproved.currentWorkItem?.assigneePrincipal, "finance-001");

  const financeApproved = await app.approve(purchase, finance, departmentApproved);
  assert.equal(financeApproved.instance.state, "completed");
  assert.equal(financeApproved.currentWorkItem, null);
  assert.equal((await app.store.listOpenWorkItems("finance-001", "test")).length, 0);
});

test("project-defined department scope and actor membership must match before workflow starts", async () => {
  const app = createPurchaseApprovalSpike();
  const otherScope: PurchaseActor = {
    id: employee.id, membership: { ...employee.membership!, scopeId: "department-sales" },
  };
  await assert.rejects(() => app.submit(purchase, otherScope), /membership_scope_mismatch/u);
  const forgedActor: PurchaseActor = {
    id: employee.id, membership: { userId: "another-employee", role: "employee", scopeId: purchase.scopeId },
  };
  await assert.rejects(() => app.submit(purchase, forgedActor), /actor_membership_mismatch/u);
  await assert.rejects(
    () => app.submit(purchase, { ...employee, membership: null }),
    /actor_membership_mismatch/u,
  );
  assert.equal((await app.store.listOpenWorkItems("manager-001", "test")).length, 0);
});

test("requester and amount are domain decisions that cannot be inherited from a generic workflow", async () => {
  const app = createPurchaseApprovalSpike();
  await assert.rejects(
    () => app.submit(purchase, { ...employee, id: "another-employee" }),
    /requester_mismatch/u,
  );
  await assert.rejects(() => app.submit({ ...purchase, totalYen: 0 }, employee), /purchase_amount_invalid/u);
  await assert.rejects(() => app.submit({ ...purchase, totalYen: 1.1 }, employee), /purchase_amount_invalid/u);
});

test("non-assignee, stale update and duplicate purchase submissions fail closed without copied TravelRequest logic", async () => {
  const app = createPurchaseApprovalSpike();
  const submitted = await app.submit(purchase, employee);
  await assert.rejects(
    () => app.approve(purchase, finance, submitted),
    (e: unknown) => e instanceof WorkflowError && e.code === "forbidden",
  );
  const departmentApproved = await app.approve(purchase, manager, submitted);
  await assert.rejects(
    () => app.approve(purchase, manager, submitted),
    (e: unknown) => e instanceof WorkflowError && (e.code === "conflict" || e.code === "forbidden"),
  );
  await assert.rejects(
    () => app.submit(purchase, employee),
    (e: unknown) => e instanceof WorkflowError && e.code === "conflict",
  );
  assert.equal(departmentApproved.instance.version, 2);
  assert.equal((await app.store.listOpenWorkItems("finance-001", "test")).length, 1);
});

test("unresolved department approver must halt before persisted workflow creation", async () => {
  const app = createPurchaseApprovalSpike({ departmentManagerId: null });
  await assert.rejects(
    () => app.submit(purchase, employee),
    (e: unknown) => e instanceof WorkflowError && e.code === "assignee_unresolved",
  );
  assert.equal((await app.store.listOpenWorkItems("manager-001", "test")).length, 0);
});

test("approval is denied when project role is missing even if the actor is assigned", async () => {
  const app = createPurchaseApprovalSpike();
  const submitted = await app.submit(purchase, employee);
  await assert.rejects(
    () => app.approve(purchase, { id: manager.id, membership: { ...manager.membership!, role: "employee" } }, submitted),
    /role_required/u,
  );
  assert.equal((await app.store.listOpenWorkItems("manager-001", "test")).length, 1);
});
