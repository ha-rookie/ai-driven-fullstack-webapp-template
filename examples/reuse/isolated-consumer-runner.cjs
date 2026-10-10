"use strict";
const assert = require("node:assert/strict");
const { createPurchaseApprovalSpike } = require("../../dist/examples/reuse/purchase-approval.js");

// This consumer runs inside an isolated temporary project: it has NO node_modules,
// no WORKHUB, no Wrangler and no Cloudflare configuration.
const request = { id: "printer-001", scopeId: "department-it", requesterId: "employee-001", totalYen: 85000 };
const employee = { id: "employee-001", membership: { userId: "employee-001", scopeId: request.scopeId, role: "employee" } };
const manager = { id: "manager-001", membership: { userId: "manager-001", scopeId: request.scopeId, role: "manager" } };
const finance = { id: "finance-001", membership: { userId: "finance-001", scopeId: request.scopeId, role: "finance" } };

async function main() {
  const app = createPurchaseApprovalSpike();
  const submitted = await app.submit(request, employee);
  assert.equal(submitted.instance.state, "active");
  assert.equal(submitted.currentWorkItem.assigneePrincipal, manager.id);

  await assert.rejects(() => app.approve(request, finance, submitted), (e) => e.code === "forbidden");
  await assert.rejects(
    () => app.approve(request, { ...manager, membership: { ...manager.membership, role: "employee" } }, submitted),
    /role_required/,
  );

  const departmentApproved = await app.approve(request, manager, submitted);
  assert.equal(departmentApproved.currentWorkItem.assigneePrincipal, finance.id);
  await assert.rejects(() => app.approve(request, manager, submitted), (e) =>
    e.code === "conflict" || e.code === "forbidden");

  const completed = await app.approve(request, finance, departmentApproved);
  assert.equal(completed.instance.state, "completed");
  assert.equal(completed.currentWorkItem, null);

  await assert.rejects(() => app.submit(request, employee), (e) => e.code === "conflict");
  await assert.rejects(
    () => createPurchaseApprovalSpike().submit(request, {
      ...employee, membership: { ...employee.membership, scopeId: "other-department" },
    }),
    /membership_scope_mismatch/,
  );
  await assert.rejects(
    () => createPurchaseApprovalSpike().submit(request, {
      ...employee, membership: { ...employee.membership, userId: "forged-user" },
    }),
    /actor_membership_mismatch/,
  );
  await assert.rejects(() => createPurchaseApprovalSpike().submit({ ...request, totalYen: -1 }, employee),
    /purchase_amount_invalid/);
  const noApprover = createPurchaseApprovalSpike({ departmentManagerId: null });
  await assert.rejects(() => noApprover.submit(request, employee), (e) => e.code === "assignee_unresolved");
  assert.equal((await noApprover.store.listOpenWorkItems(manager.id, "test")).length, 0);

  console.log("[isolated-reuse] PASS: purchase approval, role/scope/identity checks, concurrency, duplicate and fail-closed boundaries");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
