/**
 * #727: pure read-only projection of trusted, structured security-check observations.
 * No GitHub/Provider API, scanner, persistence, HTTP or UI. A CI job success
 * does NOT imply that its source found zero vulnerabilities.
 */
import {
  normalizeSecuritySourceCoverage,
  type SecuritySourceCoverage,
} from "./security-finding";

export const SECURITY_SOURCE_KINDS = [
  "secret-detection", "dependency-audit", "configuration-check", "scs-control-mapping",
] as const;
export const SECURITY_CHECK_STATUSES = [
  "not-run", "queued", "in-progress", "completed", "unavailable",
] as const;
export const SECURITY_CHECK_CONCLUSIONS = [
  "success", "failure", "cancelled", "skipped", "timed-out", "neutral", "action-required",
] as const;

export type SecuritySourceKind = typeof SECURITY_SOURCE_KINDS[number];
export type SecurityCheckStatus = typeof SECURITY_CHECK_STATUSES[number];
export type SecurityCheckConclusion = typeof SECURITY_CHECK_CONCLUSIONS[number];

/** A claim supplied by a separately trusted, evidence-verifying source adapter. */
export interface VerifiedFindingAssessment {
  readonly evidenceRefId: string;
  readonly verifiedAt: string;
  readonly evidenceValidUntil: string;
  readonly checkedFindingCount: number;
}

export interface SecuritySourceSnapshot {
  readonly sourceId: string;
  readonly sourceKind: SecuritySourceKind;
  readonly checkId: string;
  readonly targetSha: string;
  /** As-of observation (not necessarily a completed check). */
  readonly observedAt: string;
  readonly checkStatus: SecurityCheckStatus;
  readonly checkConclusion?: SecurityCheckConclusion;
  /** Positive GitHub run ID; not a URL or permission to fetch anything. */
  readonly runId?: number;
  /** Verified evidence from a trusted result adapter, never job success alone. */
  readonly verifiedFindings?: VerifiedFindingAssessment;
  readonly coverage: SecuritySourceCoverage;
}

const OPAQUE_ID = /^[a-z][a-z0-9_-]{0,47}$/u;
const SECRET_LIKE = /^(?:sk_live|sk_test|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|bearer_)/iu;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const CANONICAL_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;

const plain = (v: unknown, field: string): Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)
    || Object.getPrototypeOf(v) !== Object.prototype) {
    throw new TypeError(field + ": plain object required");
  }
  return v as Record<string, unknown>;
};
const allowKeys = (v: Record<string, unknown>, permitted: readonly string[], field: string): void => {
  if (Reflect.ownKeys(v).some(k => typeof k !== "string" || !permitted.includes(k))) {
    throw new TypeError(field + ": raw or unsupported field");
  }
  if (Object.values(Object.getOwnPropertyDescriptors(v)).some(d => !("value" in d))) {
    throw new TypeError(field + ": accessors are not permitted");
  }
};
const selection = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new TypeError(field + ": unknown enum value");
  }
  return v as T;
};
const opaqueId = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !OPAQUE_ID.test(v) || SECRET_LIKE.test(v)) {
    throw new TypeError(field + ": unsafe opaque identifier");
  }
  return v;
};
const sha = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !COMMIT_SHA.test(v)) {
    throw new TypeError(field + ": exact lowercase SHA-1 required");
  }
  return v;
};
const time = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !CANONICAL_TIME.test(v)
    || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) {
    throw new TypeError(field + ": canonical UTC timestamp required");
  }
  return v;
};
const positiveRunId = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) {
    throw new TypeError("runId: positive safe integer required");
  }
  return v as number;
};

/**
 * The caller must separately authenticate source metadata and evidence; this
 * pure function validates its shape and chronology, NOT its remote truth.
 * expectedSha binds all observations to exactly one reviewed commit.
 */
export const normalizeSecuritySourceSnapshot = (
  input: unknown,
  expectedShaInput: string,
  asOfInput: string,
): SecuritySourceSnapshot => {
  const expectedSha = sha(expectedShaInput, "expectedSha");
  const asOf = time(asOfInput, "asOf");
  const raw = plain(input, "observation");
  allowKeys(raw, [
    "sourceId", "sourceKind", "checkId", "targetSha", "observedAt",
    "checkStatus", "checkConclusion", "runId", "verifiedFindings",
  ], "observation");
  const sourceId = opaqueId(raw.sourceId, "sourceId");
  const sourceKind = selection(raw.sourceKind, SECURITY_SOURCE_KINDS, "sourceKind");
  const checkId = opaqueId(raw.checkId, "checkId");
  const targetSha = sha(raw.targetSha, "targetSha");
  if (targetSha !== expectedSha) throw new RangeError("targetSha: not the requested HEAD");
  const observedAt = time(raw.observedAt, "observedAt");
  if (Date.parse(observedAt) > Date.parse(asOf)) {
    throw new RangeError("observedAt: future source observation");
  }
  const checkStatus = selection(raw.checkStatus, SECURITY_CHECK_STATUSES, "checkStatus");
  const checkConclusion = raw.checkConclusion === undefined ? undefined
    : selection(raw.checkConclusion, SECURITY_CHECK_CONCLUSIONS, "checkConclusion");
  if ((checkStatus === "completed") !== (checkConclusion !== undefined)) {
    throw new TypeError("checkConclusion: required exactly for completed checks");
  }
  const runId = raw.runId === undefined ? undefined : positiveRunId(raw.runId);
  if (runId !== undefined && checkStatus !== "completed") {
    throw new TypeError("runId: only completed checks can carry run evidence");
  }

  let verifiedFindings: VerifiedFindingAssessment | undefined;
  if (raw.verifiedFindings !== undefined) {
    if (checkStatus !== "completed" || checkConclusion !== "success" || runId === undefined) {
      throw new TypeError("verified findings require completed successful run evidence");
    }
    const v = plain(raw.verifiedFindings, "verifiedFindings");
    allowKeys(v, ["evidenceRefId", "verifiedAt", "evidenceValidUntil", "checkedFindingCount"], "verifiedFindings");
    const evidenceRefId = opaqueId(v.evidenceRefId, "evidenceRefId");
    const verifiedAt = time(v.verifiedAt, "verifiedAt");
    const evidenceValidUntil = time(v.evidenceValidUntil, "evidenceValidUntil");
    const count = v.checkedFindingCount;
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new TypeError("checkedFindingCount: nonnegative safe integer required");
    }
    if (Date.parse(verifiedAt) > Date.parse(observedAt)
      || Date.parse(evidenceValidUntil) < Date.parse(verifiedAt)) {
      throw new RangeError("verifiedFindings: evidence timeline invalid");
    }
    verifiedFindings = Object.freeze({
      evidenceRefId, verifiedAt, evidenceValidUntil, checkedFindingCount: count as number,
    });
  }

  // Crucial: SUCCESS alone never implies a verified count, even zero.
  const coverage = normalizeSecuritySourceCoverage(
    verifiedFindings ? {
      sourceId, coverageState: "checked", sourceHealth: "ready",
      lastSuccessfulCheckAt: verifiedFindings.verifiedAt,
      evidenceValidUntil: verifiedFindings.evidenceValidUntil,
      checkedFindingCount: verifiedFindings.checkedFindingCount,
    } : {
      sourceId,
      coverageState: checkStatus === "unavailable" || (checkStatus === "completed"
        && checkConclusion !== "success" && checkConclusion !== "skipped")
        ? "unavailable" : "not-checked",
      sourceHealth: checkStatus === "unavailable" || (checkStatus === "completed"
        && checkConclusion !== "success" && checkConclusion !== "skipped")
        ? "unavailable" : "unmonitored",
    },
    asOf,
  );
  return Object.freeze({
    sourceId, sourceKind, checkId, targetSha, observedAt, checkStatus,
    ...(checkConclusion === undefined ? {} : { checkConclusion }),
    ...(runId === undefined ? {} : { runId }),
    ...(verifiedFindings ? { verifiedFindings } : {}),
    coverage,
  });
};
