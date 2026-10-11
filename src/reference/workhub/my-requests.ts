/**
 * WORKHUB MY REQUESTS: read-only projection across independently owned domains.
 * This layer never changes source workflow state, monetary approval, or authority.
 * Callers MUST first obtain owner-scoped rows from the authoritative services.
 */
import type { TravelRequestListItem } from "./travel-request/types";
import type { ExpenseClaim, TravelExpenseSummary } from "./expenses";

export type UnifiedRequestStatus =
  | "draft"
  | "in_progress"
  | "action_required"
  | "completed"
  | "rejected"
  | "withdrawn"
  | "unknown";

export interface TravelJourneyProgress {
  readonly travelStage: string;
  /** Counted ONLY from expense claims explicitly linked to this owned trip. */
  readonly settlementStage: string;
  readonly linkedClaimCount: number;
}

export interface WorkhubMyRequest {
  readonly kind: "travel" | "expense";
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: UnifiedRequestStatus;
  readonly statusLabel: string;
  readonly returnReason: string | null;
  readonly amountYen: number | null;
  readonly updatedAt: string;
  readonly journey: TravelJourneyProgress | null;
}

export type TravelProjectionInput = Pick<
  TravelRequestListItem,
  "id" | "purpose" | "status" | "workflowState" | "returnComment" | "startDate" | "endDate" | "updatedAt"
>;

export type ExpenseProjectionInput = Pick<
  ExpenseClaim,
  "id" | "purpose" | "status" | "returnReason" | "totalYen" | "updatedAt"
>;

const travelStatus = (
  record: TravelProjectionInput,
): Pick<WorkhubMyRequest, "status" | "statusLabel"> => {
  if (record.status === "draft") return { status: "draft", statusLabel: "下書き" };
  if (record.status === "submitting") return { status: "in_progress", statusLabel: "提出処理中" };
  switch (record.workflowState) {
    case "active": return { status: "in_progress", statusLabel: "承認待ち" };
    case "awaiting_resubmission": return { status: "action_required", statusLabel: "差戻し・要修正" };
    case "completed": return { status: "completed", statusLabel: "承認済み" };
    case "rejected": return { status: "rejected", statusLabel: "却下" };
    case "withdrawn": return { status: "withdrawn", statusLabel: "取り下げ" };
    default: return { status: "unknown", statusLabel: "承認状況を確認できません" };
  }
};

const expenseStatus = (
  status: ExpenseProjectionInput["status"],
): Pick<WorkhubMyRequest, "status" | "statusLabel"> => {
  switch (status) {
    case "submitted": return { status: "in_progress", statusLabel: "経理確認待ち" };
    case "returned": return { status: "action_required", statusLabel: "差戻し・要修正" };
    case "approved": return { status: "completed", statusLabel: "経理承認済み" };
  }
};

const travelJourney = (
  travel: TravelProjectionInput,
  summary: TravelExpenseSummary | undefined,
): TravelJourneyProgress => {
  const state = travelStatus(travel);
  const count = summary?.claimCount ?? 0;
  let settlementStage: string;
  if (count === 0) {
    if (state.status === "completed") {
      settlementStage = "紐づいた精算は未登録";
    } else if (state.status === "rejected" || state.status === "withdrawn") {
      settlementStage = "出張申請は終了・精算は未登録";
    } else if (state.status === "unknown") {
      settlementStage = "申請状態を確認できないため精算状況は未確認";
    } else {
      settlementStage = "出張承認後に申請可能";
    }
  } else if ((summary?.returnedCount ?? 0) > 0) {
    settlementStage = `差戻しあり（${count}件）`;
  } else if ((summary?.submittedCount ?? 0) > 0) {
    settlementStage = `経理確認中（${count}件）`;
  } else if ((summary?.approvedCount ?? 0) === count) {
    settlementStage = `経理承認済み（${count}件）`;
  } else {
    settlementStage = "精算状況を確認できません";
  }
  return { travelStage: state.statusLabel, settlementStage, linkedClaimCount: count };
};

/**
 * Fetching is bounded per-source (20 each), merging remains in-memory only,
 * and the final list is bounded to 20 most recently updated requests.
 * This does not provide a cross-domain transaction or a common status owner.
 */
export const projectWorkhubMyRequests = (
  travels: readonly TravelProjectionInput[],
  expenses: readonly ExpenseProjectionInput[],
  limit = 20,
  summaries: readonly TravelExpenseSummary[] = [],
): readonly WorkhubMyRequest[] => {
  const byTravelId = new Map(summaries.map(row => [row.travelRequestId, row]));
  const travelRows: WorkhubMyRequest[] = travels.map(record => ({
    kind: "travel",
    id: record.id,
    title: record.purpose,
    subtitle: `${record.startDate} → ${record.endDate}`,
    ...travelStatus(record),
    returnReason: record.workflowState === "awaiting_resubmission" ? record.returnComment : null,
    amountYen: null,
    updatedAt: record.updatedAt,
    journey: travelJourney(record, byTravelId.get(record.id)),
  }));
  const expenseRows: WorkhubMyRequest[] = expenses.map(record => ({
    kind: "expense",
    id: record.id,
    title: record.purpose,
    subtitle: "経費精算",
    ...expenseStatus(record.status),
    returnReason: record.status === "returned" ? record.returnReason : null,
    amountYen: record.totalYen,
    updatedAt: record.updatedAt,
    journey: null,
  }));
  return [...travelRows, ...expenseRows]
    .sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
      || right.kind.localeCompare(left.kind)
      || right.id.localeCompare(left.id))
    .slice(0, limit);
};

/**
 * HOME / MY WORK reads the same already owner-scoped unified list as MY REQUESTS.
 * Its count is scoped to that bounded list, not a claim of a global total.
 */
export const listActionRequiredMyRequests = <T extends Pick<WorkhubMyRequest, "status">>(
  requests: readonly T[],
): readonly T[] => requests.filter(request => request.status === "action_required");
