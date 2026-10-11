import assert from "node:assert/strict";
import test from "node:test";
import { listActionRequiredMyRequests, projectWorkhubMyRequests, type TravelProjectionInput, type ExpenseProjectionInput } from "../src/reference/workhub/my-requests";
import type { TravelExpenseSummary } from "../src/reference/workhub/expenses";

const travel = (overrides: Partial<TravelProjectionInput> = {}): TravelProjectionInput => ({
  id: "trip-1",
  purpose: "東京出張",
  status: "submitted",
  workflowState: "active",
  returnComment: null,
  startDate: "2026-10-10",
  endDate: "2026-10-12",
  updatedAt: "2026-10-10T08:00:00.000Z",
  ...overrides,
});

const expense = (overrides: Partial<ExpenseProjectionInput> = {}): ExpenseProjectionInput => ({
  id: "expense-1",
  purpose: "交通費精算",
  status: "submitted",
  returnReason: null,
  totalYen: 13400,
  updatedAt: "2026-10-11T10:00:00.000Z",
  ...overrides,
});

test("unified list combines independently authorized sources and orders newest first", () => {
  const rows = projectWorkhubMyRequests(
    [travel()],
    [expense()],
  );
  assert.deepEqual(rows.map(row => [row.kind, row.id, row.status]), [
    ["expense", "expense-1", "in_progress"],
    ["travel", "trip-1", "in_progress"],
  ]);
  assert.equal(rows[0]?.amountYen, 13400);
  assert.equal(rows[0]?.statusLabel, "経理確認待ち");
  assert.equal(rows[1]?.statusLabel, "承認待ち");
});

test("returned workflow and expense states share action_required but preserve reasons and source identity", () => {
  const rows = projectWorkhubMyRequests(
    [travel({ workflowState: "awaiting_resubmission", returnComment: "予定を直してください" })],
    [expense({ status: "returned", returnReason: "領収書を確認してください" })],
  );
  assert.equal(rows[0]?.status, "action_required");
  assert.equal(rows[0]?.returnReason, "領収書を確認してください");
  assert.equal(rows[1]?.status, "action_required");
  assert.equal(rows[1]?.returnReason, "予定を直してください");
  assert.notEqual(rows[0]?.kind, rows[1]?.kind);
});

test("final approval, rejection, and a missing workflow are never inferred from submitted status", () => {
  const rows = projectWorkhubMyRequests([
    travel({ id: "unknown", workflowState: null }),
    travel({ id: "rejected", workflowState: "rejected" }),
    travel({ id: "approved", workflowState: "completed" }),
  ], [
    expense({ status: "approved", returnReason: "outdated reason" }),
  ]);
  assert.equal(rows.find(row => row.id === "unknown")?.status, "unknown");
  assert.equal(rows.find(row => row.id === "rejected")?.status, "rejected");
  assert.equal(rows.find(row => row.id === "approved")?.status, "completed");
  assert.equal(rows.find(row => row.kind === "expense")?.status, "completed");
  assert.equal(rows.find(row => row.kind === "expense")?.returnReason, null);
});

test("projection is bounded and deterministic across equal timestamps", () => {
  const rows = projectWorkhubMyRequests(
    [travel({ id: "one", updatedAt: "2026-10-10T00:00:00.000Z" })],
    [expense({ id: "two", updatedAt: "2026-10-10T00:00:00.000Z" })],
    1,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.kind, "travel");
});

const summary = (overrides: Partial<TravelExpenseSummary>): TravelExpenseSummary => ({
  travelRequestId: "trip-1",
  claimCount: 1,
  submittedCount: 1,
  returnedCount: 0,
  approvedCount: 0,
  ...overrides,
});

test("journey does not mistake unlinked expenses for this trip's settlement", () => {
  const item = projectWorkhubMyRequests(
    [travel({ workflowState: "completed" })],
    [expense({ status: "approved" })],
  ).find(row => row.kind === "travel");
  assert.equal(item?.journey?.travelStage, "承認済み");
  assert.equal(item?.journey?.settlementStage, "紐づいた精算は未登録");
  assert.equal(item?.journey?.linkedClaimCount, 0);
  const pending = projectWorkhubMyRequests([travel()], [], 20)[0];
  assert.equal(pending?.journey?.settlementStage, "出張承認後に申請可能");
});

test("journey uses linked ALL-claims counts, never the truncated expense feed", () => {
  const rows = [travel({ workflowState: "completed" })];
  const cases = [
    [summary({ claimCount: 3, returnedCount: 1, approvedCount: 2, submittedCount: 0 }), "差戻しあり（3件）"],
    [summary({ claimCount: 3, returnedCount: 0, approvedCount: 2, submittedCount: 1 }), "経理確認中（3件）"],
    [summary({ claimCount: 3, returnedCount: 0, approvedCount: 3, submittedCount: 0 }), "経理承認済み（3件）"],
  ] as const;
  for (const [linked, expected] of cases) {
    const item = projectWorkhubMyRequests(rows, [], 20, [linked])[0];
    assert.equal(item?.journey?.settlementStage, expected);
    assert.equal(item?.journey?.linkedClaimCount, 3);
  }
});

test("journey ignores unrelated linked-claim summaries and never implies payment was made", () => {
  const item = projectWorkhubMyRequests(
    [travel({ workflowState: "completed" })], [], 20,
    [summary({ travelRequestId: "someone-else-trip", approvedCount: 1, submittedCount: 0 })],
  )[0];
  assert.equal(item?.journey?.linkedClaimCount, 0);
  assert.ok(!item?.journey?.settlementStage.includes("支払"));
});

test("HOME MY WORK derives actionable returned travel and expenses without selecting a request first", () => {
  const rows = projectWorkhubMyRequests(
    [
      travel({ id: "returned", workflowState: "awaiting_resubmission", returnComment: "日程修正" }),
      travel({ id: "approved", workflowState: "completed" }),
    ],
    [
      expense({ id: "expense-returned", status: "returned", returnReason: "領収書の確認" }),
      expense({ id: "expense-pending", status: "submitted" }),
    ],
  );
  const actionable = listActionRequiredMyRequests(rows);
  assert.deepEqual(actionable.map(row => row.id).sort(), ["expense-returned", "returned"]);
  assert.equal(actionable.find(row => row.id === "returned")?.returnReason, "日程修正");
  assert.equal(actionable.find(row => row.id === "expense-returned")?.kind, "expense");
  assert.equal(rows.length, 4, "deriving the HOME summary does not mutate the owner-scoped source");
});

test("HOME MY WORK shows empty only for an actually resolved owner-scoped empty or non-actionable list", () => {
  assert.deepEqual(listActionRequiredMyRequests([]), []);
  assert.deepEqual(listActionRequiredMyRequests(projectWorkhubMyRequests(
    [travel({ workflowState: "completed" })], [expense({ status: "approved" })],
  )), []);
});
