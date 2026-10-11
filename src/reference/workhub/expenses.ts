/**
 * WORKHUB Reference only: a bounded single-step expense settlement workflow.
 * Amounts are integer JPY, verified and totaled by the Worker. This is not a
 * general ledger, tax engine, payment system, or replacement for Workflow Core.
 */
export const WORKHUB_EXPENSE_EMPLOYEE_ID = "workhub-demo-aoi";
export const WORKHUB_EXPENSE_ACCOUNTANT_ID = "workhub-demo-mei";

export type ExpenseStatus = "submitted" | "returned" | "approved";
export type ExpenseCategory = "TRANSPORT" | "LODGING" | "OTHER";

export interface ExpenseLine {
  readonly expenseDate: string;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly amountYen: number;
}

export interface ExpenseClaim {
  readonly id: string;
  readonly purpose: string;
  readonly requesterId: string;
  readonly travelRequestId: string | null;
  readonly lines: readonly ExpenseLine[];
  readonly totalYen: number;
  readonly status: ExpenseStatus;
  readonly returnReason: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class WorkhubExpenseError extends Error {
  constructor(
    readonly code: "invalid_input" | "forbidden" | "not_found" | "conflict" | "storage_failure",
    message: string,
  ) {
    super(message);
    this.name = "WorkhubExpenseError";
  }
}

const invalid = (message: string): never => {
  throw new WorkhubExpenseError("invalid_input", message);
};

const textValue = (value: unknown, label: string, max: number): string => {
  if (typeof value !== "string") return invalid(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || [...normalized].some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  })) return invalid(`${label} must contain 1-${max} valid characters`);
  return normalized;
};

export const validateExpense = (value: unknown): {
  purpose: string;
  lines: readonly ExpenseLine[];
  totalYen: number;
  travelRequestId: string | null;
} => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("invalid expense");
  const input = value as Record<string, unknown>;
  const purpose = textValue(input.purpose, "purpose", 200);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 5) {
    return invalid("expense requires 1-5 detail lines");
  }
  const lines: ExpenseLine[] = input.lines.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("invalid line");
    const line = raw as Record<string, unknown>;
    if (typeof line.expenseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(line.expenseDate)) {
      return invalid("expenseDate must be YYYY-MM-DD");
    }
    const [year, month, day] = line.expenseDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      return invalid("expenseDate is not a calendar date");
    }
    if (!["TRANSPORT", "LODGING", "OTHER"].includes(String(line.category))) {
      return invalid("invalid expense category");
    }
    const description = textValue(line.description, "description", 200);
    if (typeof line.amountYen !== "number" || !Number.isSafeInteger(line.amountYen)
      || line.amountYen < 1 || line.amountYen > 1_000_000) {
      return invalid("amountYen must be an integer between 1 and 1000000");
    }
    return {
      expenseDate: line.expenseDate,
      category: line.category as ExpenseCategory,
      description,
      amountYen: line.amountYen,
    };
  });
  const totalYen = lines.reduce((sum, line) => sum + line.amountYen, 0);
  if (totalYen > 2_000_000) return invalid("totalYen exceeds the reference limit");
  const travelRequestId = input.travelRequestId === null || input.travelRequestId === undefined
    || input.travelRequestId === "" ? null : textValue(input.travelRequestId, "travelRequestId", 256);
  return { purpose, lines, totalYen, travelRequestId };
};

interface ExpenseRow {
  id: string;
  purpose: string;
  requester_id: string;
  travel_request_id: string | null;
  lines_json: string;
  total_yen: number;
  status: ExpenseStatus;
  return_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: ExpenseRow): ExpenseClaim => ({
  id: row.id,
  purpose: row.purpose,
  requesterId: row.requester_id,
  travelRequestId: row.travel_request_id,
  lines: JSON.parse(row.lines_json) as ExpenseLine[],
  totalYen: row.total_yen,
  status: row.status,
  returnReason: row.return_reason,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Server-side owner-scoped counts for the journey view. No expense rows or
 * requester identities are disclosed by this read model.
 */
export interface TravelExpenseSummary {
  readonly travelRequestId: string;
  readonly claimCount: number;
  readonly submittedCount: number;
  readonly returnedCount: number;
  readonly approvedCount: number;
}

interface TravelExpenseSummaryRow {
  travel_request_id: string;
  claim_count: number;
  submitted_count: number;
  returned_count: number;
  approved_count: number;
}

export class D1WorkhubExpenseStore {
  constructor(private readonly db: D1Database, private readonly environment: string) {}

  private checkReader(principalId: string): void {
    if (principalId !== WORKHUB_EXPENSE_EMPLOYEE_ID && principalId !== WORKHUB_EXPENSE_ACCOUNTANT_ID) {
      throw new WorkhubExpenseError("forbidden", "expense access is not granted");
    }
  }

  async listLinkedSummaries(
    principalId: string,
    ownedTravelRequestIds: readonly string[],
  ): Promise<readonly TravelExpenseSummary[]> {
    // The caller first reads only this user's travel IDs. Recheck principal
    // here and constrain every aggregate to this user and environment.
    if (principalId !== WORKHUB_EXPENSE_EMPLOYEE_ID) {
      throw new WorkhubExpenseError("forbidden", "expense journey access is not granted");
    }
    const ids = [...new Set(ownedTravelRequestIds)].slice(0, 20);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.db.prepare(`
      SELECT travel_request_id,
             COUNT(*) AS claim_count,
             SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
             SUM(CASE WHEN status = 'returned' THEN 1 ELSE 0 END) AS returned_count,
             SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_count
      FROM workhub_expense_claims
      WHERE environment = ? AND requester_id = ?
        AND travel_request_id IN (${placeholders})
      GROUP BY travel_request_id
    `).bind(this.environment, principalId, ...ids).all<TravelExpenseSummaryRow>();
    return (rows.results ?? []).map(row => ({
      travelRequestId: row.travel_request_id,
      claimCount: row.claim_count,
      submittedCount: row.submitted_count,
      returnedCount: row.returned_count,
      approvedCount: row.approved_count,
    }));
  }

  async list(principalId: string): Promise<readonly ExpenseClaim[]> {
    this.checkReader(principalId);
    const finance = principalId === WORKHUB_EXPENSE_ACCOUNTANT_ID;
    const rows = await this.db.prepare(`
      SELECT id, purpose, requester_id, travel_request_id, lines_json,
             total_yen, status, return_reason, version, created_at, updated_at
      FROM workhub_expense_claims
      WHERE environment = ? AND (? = 1 OR requester_id = ?)
      ORDER BY updated_at DESC, id DESC
      LIMIT 20
    `).bind(this.environment, finance ? 1 : 0, principalId).all<ExpenseRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async get(principalId: string, id: string): Promise<ExpenseClaim> {
    this.checkReader(principalId);
    const row = await this.db.prepare(`
      SELECT id, purpose, requester_id, travel_request_id, lines_json,
             total_yen, status, return_reason, version, created_at, updated_at
      FROM workhub_expense_claims WHERE environment = ? AND id = ?
    `).bind(this.environment, id).first<ExpenseRow>();
    if (!row || (row.requester_id !== principalId && principalId !== WORKHUB_EXPENSE_ACCOUNTANT_ID)) {
      throw new WorkhubExpenseError("not_found", "expense is unavailable");
    }
    return fromRow(row);
  }

  private async assertApprovedTravel(principalId: string, travelRequestId: string | null): Promise<void> {
    if (!travelRequestId) return;
    const trip = await this.db.prepare(`
      SELECT tr.id FROM reference_travel_requests tr
      JOIN workflow_instances wi ON wi.id = tr.workflow_instance_id
        AND wi.environment = tr.environment AND wi.resource_id = tr.id
        AND wi.resource_type = 'workhub.travel_request' AND wi.requester_id = tr.requester_id
      WHERE tr.environment = ? AND tr.id = ? AND tr.requester_id = ?
        AND tr.status = 'submitted' AND wi.state = 'completed'
    `).bind(this.environment, travelRequestId, principalId).first<{ id: string }>();
    if (!trip) throw new WorkhubExpenseError("invalid_input", "linked travel request must be approved and owned");
  }

  async submit(principalId: string, input: unknown): Promise<ExpenseClaim> {
    if (principalId !== WORKHUB_EXPENSE_EMPLOYEE_ID) {
      throw new WorkhubExpenseError("forbidden", "only the employee can submit expenses");
    }
    const data = validateExpense(input);
    await this.assertApprovedTravel(principalId, data.travelRequestId);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const result = await this.db.prepare(`
      INSERT INTO workhub_expense_claims (
        id, environment, requester_id, purpose, travel_request_id, lines_json,
        total_yen, status, return_reason, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', NULL, 1, ?, ?)
    `).bind(id, this.environment, principalId, data.purpose, data.travelRequestId,
      JSON.stringify(data.lines), data.totalYen, now, now).run();
    if (result.meta?.changes !== 1) {
      throw new WorkhubExpenseError("storage_failure", "expense could not be saved");
    }
    return this.get(principalId, id);
  }

  async resubmit(principalId: string, id: string, input: unknown, expectedVersion: number): Promise<ExpenseClaim> {
    if (principalId !== WORKHUB_EXPENSE_EMPLOYEE_ID) {
      throw new WorkhubExpenseError("forbidden", "only the employee can resubmit expenses");
    }
    const current = await this.get(principalId, id);
    if (current.status !== "returned") throw new WorkhubExpenseError("conflict", "expense is not returned");
    const data = validateExpense(input);
    await this.assertApprovedTravel(principalId, data.travelRequestId);
    const result = await this.db.prepare(`
      UPDATE workhub_expense_claims SET purpose = ?, travel_request_id = ?, lines_json = ?,
        total_yen = ?, status = 'submitted', return_reason = NULL, version = version + 1,
        updated_at = ?
      WHERE id = ? AND environment = ? AND requester_id = ? AND status = 'returned' AND version = ?
    `).bind(data.purpose, data.travelRequestId, JSON.stringify(data.lines), data.totalYen,
      new Date().toISOString(), id, this.environment, principalId, expectedVersion).run();
    if (result.meta?.changes !== 1) throw new WorkhubExpenseError("conflict", "expense was modified; reload it");
    return this.get(principalId, id);
  }

  async decide(
    principalId: string,
    id: string,
    expectedVersion: number,
    action: unknown,
    reason: unknown,
  ): Promise<ExpenseClaim> {
    if (principalId !== WORKHUB_EXPENSE_ACCOUNTANT_ID) {
      throw new WorkhubExpenseError("forbidden", "only Accounting can review expenses");
    }
    if (action !== "approve" && action !== "return") return invalid("invalid accounting action");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return invalid("invalid version");
    const comment = action === "return" ? textValue(reason, "return reason", 500) : null;
    const status = action === "approve" ? "approved" : "returned";
    const result = await this.db.prepare(`
      UPDATE workhub_expense_claims SET status = ?, return_reason = ?,
        version = version + 1, updated_at = ?
      WHERE id = ? AND environment = ? AND status = 'submitted' AND version = ?
    `).bind(status, comment, new Date().toISOString(), id, this.environment, expectedVersion).run();
    if (result.meta?.changes !== 1) throw new WorkhubExpenseError("conflict", "expense is already processed or stale");
    return this.get(principalId, id);
  }
}
