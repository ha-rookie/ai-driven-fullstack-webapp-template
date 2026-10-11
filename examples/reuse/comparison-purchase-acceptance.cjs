"use strict";
/**
 * Frozen common purchase-approval acceptance for A (reused Foundation)
 * and B (small greenfield baseline). This is not a full Workflow conformance
 * suite: no durable storage, audit, notifications or real authentication.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const candidate = process.argv[2];
if (!candidate || !/^[a-zA-Z0-9_./-]+\.js$/u.test(candidate)) {
  throw new Error("Expected relative candidate .js path");
}
const { createPurchaseApprovalSpike } = require(path.resolve(process.cwd(), candidate));
if (typeof createPurchaseApprovalSpike !== "function") throw new Error("Candidate entrypoint is missing");

const purchase = { id: "printer-001", scopeId: "department-it", requesterId: "employee-001", totalYen: 85000 };
const actor = (id, role, scopeId = purchase.scopeId) => ({
  id, membership: { userId: id, scopeId, role },
});
const employee = actor("employee-001", "employee");
const manager = actor("manager-001", "manager");
const finance = actor("finance-001", "finance");
const results = [];
async function verify(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: String(error && error.message || error) });
  }
}
const code = (...values) => (error) => values.includes(error && error.code);

async function main() {
  await verify("two-step-and-complete", async () => {
    const app = createPurchaseApprovalSpike();
    const first = await app.submit(purchase, employee);
    assert.equal(first.instance.state, "active");
    assert.equal(first.currentWorkItem?.assigneePrincipal, manager.id);
    const second = await app.approve(purchase, manager, first);
    assert.equal(second.instance.state, "active");
    assert.equal(second.currentWorkItem?.assigneePrincipal, finance.id);
    const completed = await app.approve(purchase, finance, second);
    assert.equal(completed.instance.state, "completed");
    assert.equal(completed.currentWorkItem, null);
    assert.equal((await app.store.listOpenWorkItems(finance.id, "test")).length, 0);
  });

  await verify("wrong-assignee-denied", async () => {
    const app = createPurchaseApprovalSpike();
    const first = await app.submit(purchase, employee);
    await assert.rejects(() => app.approve(purchase, finance, first), code("forbidden"));
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 1);
  });

  await verify("assigned-but-role-denied", async () => {
    const app = createPurchaseApprovalSpike();
    const first = await app.submit(purchase, employee);
    await assert.rejects(() => app.approve(purchase, actor(manager.id, "employee"), first), /role_required/u);
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 1);
  });

  await verify("other-scope-denied", async () => {
    const app = createPurchaseApprovalSpike();
    await assert.rejects(
      () => app.submit(purchase, actor(employee.id, "employee", "department-other")),
      /membership_scope_mismatch/u,
    );
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 0);
  });

  await verify("actor-membership-forgery-denied", async () => {
    const app = createPurchaseApprovalSpike();
    await assert.rejects(
      () => app.submit(purchase, { ...employee, membership: { ...employee.membership, userId: "other-id" } }),
      /actor_membership_mismatch/u,
    );
    await assert.rejects(() => app.submit(purchase, { ...employee, membership: null }), /actor_membership_mismatch/u);
  });

  await verify("requester-mismatch-denied", async () => {
    const app = createPurchaseApprovalSpike();
    await assert.rejects(() => app.submit(purchase, actor("somebody-else", "employee")), /requester_mismatch/u);
  });

  await verify("invalid-amount-denied", async () => {
    for (const totalYen of [0, -1, 1.3, Number.MAX_SAFE_INTEGER + 1]) {
      const app = createPurchaseApprovalSpike();
      await assert.rejects(() => app.submit({ ...purchase, totalYen }, employee), /purchase_amount_invalid/u);
    }
  });

  await verify("stale-action-rejected", async () => {
    const app = createPurchaseApprovalSpike();
    const first = await app.submit(purchase, employee);
    await app.approve(purchase, manager, first);
    await assert.rejects(() => app.approve(purchase, manager, first), code("conflict", "forbidden"));
    assert.equal((await app.store.listOpenWorkItems(finance.id, "test")).length, 1);
  });

  await verify("duplicate-submit-rejected", async () => {
    const app = createPurchaseApprovalSpike();
    await app.submit(purchase, employee);
    await assert.rejects(() => app.submit(purchase, employee), code("conflict"));
  });

  await verify("unresolved-first-assignee-rollback", async () => {
    const app = createPurchaseApprovalSpike({ departmentManagerId: null });
    await assert.rejects(() => app.submit(purchase, employee), code("assignee_unresolved"));
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 0);
  });

  await verify("unresolved-next-assignee-no-mutation", async () => {
    const app = createPurchaseApprovalSpike({ financeReviewerId: null });
    const first = await app.submit(purchase, employee);
    await assert.rejects(() => app.approve(purchase, manager, first), code("assignee_unresolved"));
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 1);
  });

  await verify("cross-resource-approval-denied", async () => {
    const app = createPurchaseApprovalSpike();
    const first = await app.submit(purchase, employee);
    await assert.rejects(
      () => app.approve({ ...purchase, id: "another-purchase" }, manager, first),
      /purchase_workflow_mismatch/u,
    );
    assert.equal((await app.store.listOpenWorkItems(manager.id, "test")).length, 1);
  });

  const passed = results.filter((result) => result.ok).length;
  console.log("PURCHASE_COMPARISON_RESULT " + JSON.stringify({
    candidate, passed, total: results.length, results,
  }));
  if (passed !== results.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
