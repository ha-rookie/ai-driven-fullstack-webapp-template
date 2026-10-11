import assert from "node:assert/strict";
import test from "node:test";
import { projectWorkhubMyRequests, type TravelProjectionInput, type ExpenseProjectionInput } from "../src/reference/workhub/my-requests";

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
