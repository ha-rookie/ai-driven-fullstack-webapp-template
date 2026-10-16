/**
 * #724: Provider-neutral, pure Security Finding contract. No scanner, D1, API or UI.
 * Accept only controlled metadata; raw scanner reports are never shared records.
 */
export const SECURITY_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const SECURITY_CATEGORIES = [
  "identity", "configuration", "dependency", "data", "integration",
  "agent", "encryption", "recovery", "application",
] as const;
export const SECURITY_STATUSES = ["open", "resolved", "accepted-risk", "false-positive"] as const;
export const SECURITY_EVIDENCE_KINDS = ["ci", "runtime", "configuration", "dependency"] as const;
export const SECURITY_EVIDENCE_CODES = [
  "control_check_failed", "configuration_gap", "dependency_alert",
  "privileged_access_review", "missing_protection", "provider_unavailable",
  "policy_violation",
] as const;
export const SECURITY_REMEDIATION_CODES = [
  "review_control", "update_dependency", "correct_configuration",
  "review_access", "investigate_incident", "restore_evidence",
] as const;
export const SECURITY_EXCEPTION_REASONS = [
  "mitigation_documented", "temporary_operational_need",
] as const;
export const SECURITY_COVERAGE_STATES = [
  "checked", "not-checked", "unavailable", "not-applicable",
] as const;
export const SECURITY_SOURCE_HEALTH = ["ready", "degraded", "unavailable", "unmonitored"] as const;

export type SecuritySeverity = typeof SECURITY_SEVERITIES[number];
export type SecurityCategory = typeof SECURITY_CATEGORIES[number];
export type SecurityFindingStatus = typeof SECURITY_STATUSES[number];
export type SecurityEvidenceCode = typeof SECURITY_EVIDENCE_CODES[number];
export type SecurityRemediationCode = typeof SECURITY_REMEDIATION_CODES[number];
export type SecurityCoverageState = typeof SECURITY_COVERAGE_STATES[number];
export type SecuritySourceHealth = typeof SECURITY_SOURCE_HEALTH[number];
export type SecurityFreshness = "current" | "stale" | "unknown";

export interface SecurityEvidence {
  readonly kind: typeof SECURITY_EVIDENCE_KINDS[number];
  /** A controlled lookup code; never a raw scanner message or evidence blob. */
  readonly code: SecurityEvidenceCode;
  readonly referenceId?: string;
}

export interface SecurityRiskException {
  readonly reasonCode: typeof SECURITY_EXCEPTION_REASONS[number];
  readonly approvalRef: string;
  readonly expiresAt: string;
}

export interface SecurityFinding {
  readonly ruleId: string;
  readonly sourceId: string;
  readonly category: SecurityCategory;
  readonly severity: SecuritySeverity;
  readonly status: SecurityFindingStatus;
  readonly resourceRef?: string;
  readonly detectedAt: string;
  readonly lastObservedAt: string;
  readonly assessedAt: string;
  readonly evidence: readonly SecurityEvidence[];
  readonly remediationCode?: SecurityRemediationCode;
  /** Validated Audit request ID correlation hint. NOT proof of an existing Audit event. */
  readonly auditRequestId?: string;
  readonly exception?: SecurityRiskException;
  /** Expired accepted risk is NOT an active approval, even if stored status has not changed. */
  readonly riskDisposition: "none" | "accepted-current" | "accepted-expired";
}

export interface SecuritySourceCoverage {
  readonly sourceId: string;
  readonly coverageState: SecurityCoverageState;
  readonly sourceHealth: SecuritySourceHealth;
  readonly lastSuccessfulCheckAt?: string;
  readonly evidenceValidUntil?: string;
  /** Null means no reliable check result. Zero is allowed only when checked. */
  readonly checkedFindingCount: number | null;
  readonly freshness: SecurityFreshness;
  readonly notApplicableReasonCode?: "outside_project_scope" | "unsupported_capability";
}

export interface SecurityFindingAdapter<T> {
  readonly sourceId: string;
  /** Map a provider-specific input to the STRICT controlled finding DTO. */
  readonly map: (raw: T) => unknown;
}

const ID = /^[a-z][a-z0-9_-]{0,47}$/u;
const CREDENTIAL_PREFIX = /^(?:sk_live|sk_test|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|bearer_)/iu;
const AUDIT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const optionalAuditRequestId = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !AUDIT_REQUEST_ID.test(value) || CREDENTIAL_PREFIX.test(value)) {
    throw new TypeError("auditRequestId: invalid correlation ID");
  }
  return value;
};
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label}: expected plain object`);
  }
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new TypeError(`${label}: unknown or raw payload field`);
  }
};
const enumValue = <T extends string>(value: unknown, options: readonly T[], label: string): T => {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new TypeError(`${label}: invalid enum code`);
  }
  return value as T;
};
const id = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ID.test(value) || CREDENTIAL_PREFIX.test(value)) {
    throw new TypeError(`${label}: invalid opaque identifier`);
  }
  return value;
};
const timestamp = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label}: canonical UTC timestamp required`);
  }
  return value;
};
const optionalId = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : id(value, label);
const compareTime = (first: string, second: string): number =>
  Date.parse(first) - Date.parse(second);

/** Fail-closed projection: arbitrary scanner payload and free-form evidence are not accepted. */
export const normalizeSecurityFinding = (
  input: unknown,
  source: string,
  assessedAtInput: string,
): SecurityFinding => {
  const sourceId = id(source, "sourceId");
  const assessedAt = timestamp(assessedAtInput, "assessedAt");
  const raw = record(input, "finding");
  keys(raw, [
    "ruleId", "category", "severity", "status", "resourceRef", "detectedAt",
    "lastObservedAt", "evidence", "remediationCode", "auditRequestId", "exception",
  ], "finding");
  const ruleId = id(raw.ruleId, "ruleId");
  const category = enumValue(raw.category, SECURITY_CATEGORIES, "category");
  const severity = enumValue(raw.severity, SECURITY_SEVERITIES, "severity");
  const status = enumValue(raw.status, SECURITY_STATUSES, "status");
  const resourceRef = optionalId(raw.resourceRef, "resourceRef");
  const detectedAt = timestamp(raw.detectedAt, "detectedAt");
  const lastObservedAt = timestamp(raw.lastObservedAt, "lastObservedAt");
  if (compareTime(detectedAt, lastObservedAt) > 0 || compareTime(lastObservedAt, assessedAt) > 0) {
    throw new RangeError("finding observation chronology is invalid");
  }
  if (!Array.isArray(raw.evidence) || raw.evidence.length === 0 || raw.evidence.length > 8) {
    throw new TypeError("evidence: expected one to eight controlled evidence entries");
  }
  const evidence = Object.freeze(raw.evidence.map((item: unknown) => {
    const entry = record(item, "evidence");
    keys(entry, ["kind", "code", "referenceId"], "evidence");
    const kind = enumValue(entry.kind, SECURITY_EVIDENCE_KINDS, "evidence.kind");
    const code = enumValue(entry.code, SECURITY_EVIDENCE_CODES, "evidence.code");
    const referenceId = optionalId(entry.referenceId, "evidence.referenceId");
    return Object.freeze({ kind, code, ...(referenceId ? { referenceId } : {}) });
  }));
  const auditRequestId = optionalAuditRequestId(raw.auditRequestId);
  const remediationCode = raw.remediationCode === undefined ? undefined
    : enumValue(raw.remediationCode, SECURITY_REMEDIATION_CODES, "remediationCode");
  if ((status === "accepted-risk") !== (raw.exception !== undefined)) {
    throw new TypeError("accepted risk requires exactly one explicit exception");
  }
  let exception: SecurityRiskException | undefined;
  let riskDisposition: SecurityFinding["riskDisposition"] = "none";
  if (raw.exception !== undefined) {
    const approval = record(raw.exception, "exception");
    keys(approval, ["reasonCode", "approvalRef", "expiresAt"], "exception");
    exception = Object.freeze({
      reasonCode: enumValue(approval.reasonCode, SECURITY_EXCEPTION_REASONS, "exception.reasonCode"),
      approvalRef: id(approval.approvalRef, "exception.approvalRef"),
      expiresAt: timestamp(approval.expiresAt, "exception.expiresAt"),
    });
    riskDisposition = compareTime(exception.expiresAt, assessedAt) > 0
      ? "accepted-current" : "accepted-expired";
  }
  return Object.freeze({
    ruleId, sourceId, category, severity, status, detectedAt, lastObservedAt, assessedAt,
    ...(resourceRef ? { resourceRef } : {}),
    evidence, ...(remediationCode ? { remediationCode } : {}),
    ...(auditRequestId ? { auditRequestId } : {}),
    ...(exception ? { exception } : {}), riskDisposition,
  });
};

export const normalizeSecurityFindingFromSource = <T>(
  adapter: SecurityFindingAdapter<T>,
  raw: T,
  assessedAt: string,
): SecurityFinding => normalizeSecurityFinding(adapter.map(raw), adapter.sourceId, assessedAt);

/** Source-health and coverage are separate from risk severity and SCS compliance. */
export const normalizeSecuritySourceCoverage = (
  input: unknown,
  asOfInput: string,
): SecuritySourceCoverage => {
  const asOf = timestamp(asOfInput, "asOf");
  const raw = record(input, "coverage");
  keys(raw, [
    "sourceId", "coverageState", "sourceHealth", "lastSuccessfulCheckAt",
    "evidenceValidUntil", "checkedFindingCount", "notApplicableReasonCode",
  ], "coverage");
  const sourceId = id(raw.sourceId, "sourceId");
  const coverageState = enumValue(raw.coverageState, SECURITY_COVERAGE_STATES, "coverageState");
  const sourceHealth = enumValue(raw.sourceHealth, SECURITY_SOURCE_HEALTH, "sourceHealth");
  const lastSuccessfulCheckAt = raw.lastSuccessfulCheckAt === undefined ? undefined
    : timestamp(raw.lastSuccessfulCheckAt, "lastSuccessfulCheckAt");
  const evidenceValidUntil = raw.evidenceValidUntil === undefined ? undefined
    : timestamp(raw.evidenceValidUntil, "evidenceValidUntil");
  if (lastSuccessfulCheckAt && compareTime(lastSuccessfulCheckAt, asOf) > 0) {
    throw new RangeError("last successful check is in the future");
  }
  if (evidenceValidUntil && (!lastSuccessfulCheckAt
    || compareTime(evidenceValidUntil, lastSuccessfulCheckAt) < 0)) {
    throw new RangeError("invalid evidence freshness interval");
  }
  const count = raw.checkedFindingCount;
  const checked = coverageState === "checked";
  if (checked) {
    if (!lastSuccessfulCheckAt || (sourceHealth !== "ready" && sourceHealth !== "degraded")
      || !Number.isSafeInteger(count) || (count as number) < 0) {
      throw new TypeError("checked coverage requires successful source evidence and count");
    }
  } else if (count !== undefined && count !== null) {
    throw new TypeError("unchecked or unavailable source must not report findings count");
  }
  if (coverageState === "unavailable" && sourceHealth !== "unavailable") {
    throw new TypeError("unavailable source must have unavailable health");
  }
  if ((coverageState === "not-checked" || coverageState === "not-applicable")
    && sourceHealth !== "unmonitored") {
    throw new TypeError("unmonitored coverage requires unmonitored source health");
  }
  const reason = raw.notApplicableReasonCode;
  if (coverageState === "not-applicable") {
    enumValue(reason, ["outside_project_scope", "unsupported_capability"] as const, "notApplicableReasonCode");
  } else if (reason !== undefined) {
    throw new TypeError("notApplicableReasonCode is limited to not-applicable coverage");
  }
  const freshness: SecurityFreshness = checked
    ? evidenceValidUntil === undefined ? "unknown"
      : compareTime(evidenceValidUntil, asOf) >= 0 ? "current" : "stale"
    : "unknown";
  return Object.freeze({
    sourceId, coverageState, sourceHealth,
    checkedFindingCount: checked ? (count as number) : null,
    ...(lastSuccessfulCheckAt ? { lastSuccessfulCheckAt } : {}),
    ...(evidenceValidUntil ? { evidenceValidUntil } : {}),
    ...(reason ? { notApplicableReasonCode: reason as "outside_project_scope" | "unsupported_capability" } : {}),
    freshness,
  });
};
