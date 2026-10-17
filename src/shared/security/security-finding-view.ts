/**
 * #420: strict UI-boundary projection for previously verified #724 Finding records.
 * Current Worker intentionally only sends "not-connected"; this creates no scan data.
 */
import {
  normalizeSecurityFinding,
  SECURITY_SEVERITIES, SECURITY_CATEGORIES, SECURITY_STATUSES,
  type SecurityFinding, type SecuritySeverity, type SecurityCategory,
  type SecurityFindingStatus, type SecuritySourceCoverage,
} from "./security-finding";

export type SecurityFindingFeed =
  | { readonly state: "not-connected"; readonly items: null; readonly verifiedCount: null }
  | { readonly state: "verified"; readonly items: readonly SecurityFinding[]; readonly verifiedCount: number };

const allowedKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key));

/** A missing/malformed or cross-source record invalidates the *whole* feed. */
export const isSecurityFindingFeed = (
  input: unknown, sources: readonly SecuritySourceCoverage[], asOf: string,
): input is SecurityFindingFeed => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const feed = input as Record<string, unknown>;
  if (!allowedKeys(feed, ["state", "items", "verifiedCount"])) return false;
  if (feed.state === "not-connected") {
    return feed.items === null && feed.verifiedCount === null;
  }
  if (feed.state !== "verified" || !Array.isArray(feed.items)
    || feed.items.length > 64 || !Number.isSafeInteger(feed.verifiedCount)
    || feed.verifiedCount !== feed.items.length) return false;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(asOf)
    || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString() !== asOf) return false;
  const checked = sources.filter(source => source.coverageState === "checked");
  if (checked.length === 0) return false;
  const count = new Map(checked.map(source => [source.sourceId, 0]));
  const seen = new Set<string>();
  for (const value of feed.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !allowedKeys(value, ["ruleId", "sourceId", "category", "severity", "status",
        "resourceRef", "detectedAt", "lastObservedAt", "assessedAt", "evidence",
        "remediationCode", "auditRequestId", "exception", "riskDisposition"])) return false;
    const raw = value as Record<string, unknown>;
    const sourceId = raw.sourceId;
    if (typeof sourceId !== "string" || !count.has(sourceId)
      || typeof raw.assessedAt !== "string" || raw.assessedAt > asOf) return false;
    try {
      const normalized = normalizeSecurityFinding({
        ruleId: raw.ruleId, category: raw.category, severity: raw.severity,
        status: raw.status, resourceRef: raw.resourceRef, detectedAt: raw.detectedAt,
        lastObservedAt: raw.lastObservedAt, evidence: raw.evidence,
        remediationCode: raw.remediationCode, auditRequestId: raw.auditRequestId,
        exception: raw.exception,
      }, sourceId, raw.assessedAt);
      if (raw.riskDisposition !== normalized.riskDisposition
        || raw.auditRequestId !== normalized.auditRequestId) return false;
      const key = [normalized.sourceId, normalized.ruleId, normalized.resourceRef ?? ""].join(":");
      if (seen.has(key)) return false;
      seen.add(key);
      count.set(sourceId, (count.get(sourceId) ?? 0) + 1);
    } catch { return false; }
  }
  // No unknown source count can be promoted into a verified global count.
  return checked.every(source => source.checkedFindingCount === count.get(source.sourceId))
    && checked.reduce((sum, source) => sum + (source.checkedFindingCount ?? 0), 0) === feed.verifiedCount;
};

/**
 * #420 / #488: distinguish a validated source's *technical observation*
 * from SCS compliance and from a real, separately verified Audit event.
 * This reads only provenance already authorized and normalized in the snapshot.
 */
export interface FindingEvidenceAssessment {
  readonly state: "current" | "stale" | "unknown" | "unavailable";
  readonly health: SecuritySourceCoverage["sourceHealth"] | "not-connected";
  readonly lastSuccessfulCheckAt: string | null;
  readonly evidenceValidUntil: string | null;
  readonly auditCorrelation: "lookup-required" | "not-recorded";
  readonly remediation: "investigation-hint" | "not-recorded";
}
const canonicalUtc = (value: unknown): value is string =>
  typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/**
 * A verified Finding stays historically observable after its provider TTL
 * expires, but it cannot be presented as a *currently verified* control.
 * An auditRequestId is only a lookup hint until the existing Audit viewer
 * independently returns a scoped, integrity-checked stored record.
 */
export const assessFindingEvidence = (
  finding: SecurityFinding,
  sources: readonly SecuritySourceCoverage[],
  now: string,
): FindingEvidenceAssessment => {
  const source = sources.find(item => item.sourceId === finding.sourceId);
  const health: FindingEvidenceAssessment["health"] = source?.sourceHealth ?? "not-connected";
  const base = {
    health,
    lastSuccessfulCheckAt: source?.lastSuccessfulCheckAt ?? null,
    evidenceValidUntil: source?.evidenceValidUntil ?? null,
    auditCorrelation: finding.auditRequestId ? "lookup-required" as const : "not-recorded" as const,
    remediation: finding.remediationCode ? "investigation-hint" as const : "not-recorded" as const,
  };
  if (!source || source.coverageState === "unavailable" || source.sourceHealth === "unavailable") {
    return { ...base, state: "unavailable" };
  }
  if (source.coverageState !== "checked" || source.checkedFindingCount === null
    || !canonicalUtc(now)
    || !canonicalUtc(source.lastSuccessfulCheckAt)
    || Date.parse(source.lastSuccessfulCheckAt) > Date.parse(now)
    || !canonicalUtc(source.evidenceValidUntil)) {
    return { ...base, state: "unknown" };
  }
  if (source.freshness === "unknown") return { ...base, state: "unknown" };
  return { ...base, state: source.freshness === "stale"
    || Date.parse(now) >= Date.parse(source.evidenceValidUntil) ? "stale" : "current" };
};


/**
 * #420 / #488: Source TTL and a particular Finding's origin are independent
 * checks. A source may be current yet a Finding cannot be tied to that run.
 *
 * Only two existing, strictly projected feeds have a reviewed association:
 * fixed GitHub CI control-step failures and the scoped runtime-lock OSV feed.
 * No generic scanner Finding, deployment SHA or SCS Evidence is inferred.
 */
export interface FindingSourceLineage {
  readonly relation: "ci-run-matched" | "osv-observation-matched" | "unverified";
  readonly sourceFreshness: FindingEvidenceAssessment["state"];
  /** A matched Finding observation timestamp, NOT an SCS evidence file timestamp. */
  readonly findingObservedAt: string | null;
  /** Target SHA of the matching CI run only; not a deployed version. */
  readonly ciTargetSha: string | null;
  readonly deployedCommitSha: null;
  readonly scsEvidenceState: "unknown";
}

interface LineageCiRun {
  readonly runId: number;
  readonly targetSha: string;
  readonly updatedAt: string;
  readonly checkStatus: string;
  readonly checkConclusion?: string;
}
interface LineageSource extends SecuritySourceCoverage {
  readonly ci?: {
    readonly state: string;
    readonly fetchedAt: string | null;
    readonly latest: LineageCiRun | null;
  };
}
export const assessFindingSourceLineage = (
  finding: SecurityFinding,
  sources: readonly LineageSource[],
  now: string,
): FindingSourceLineage => {
  const source = sources.find(item => item.sourceId === finding.sourceId);
  const sourceFreshness = assessFindingEvidence(finding, sources, now).state;
  const unverified: FindingSourceLineage = {
    relation: "unverified", sourceFreshness, findingObservedAt: null,
    ciTargetSha: null, deployedCommitSha: null, scsEvidenceState: "unknown",
  };
  if (!source || source.coverageState !== "checked"
    || (source.sourceHealth !== "ready" && source.sourceHealth !== "degraded")
    || sourceFreshness === "unknown" || sourceFreshness === "unavailable"
    || !canonicalUtc(finding.lastObservedAt) || !canonicalUtc(now)
    || Date.parse(finding.lastObservedAt) > Date.parse(now)) return unverified;

  const ev = finding.evidence.length === 1 ? finding.evidence[0] : undefined;
  const run = source.ci?.latest;
  if (finding.ruleId === "ci_step_failure"
    && ev?.kind === "ci" && ev.code === "control_check_failed"
    && source.sourceHealth === "degraded"
    && source.ci?.state === "available"
    && canonicalUtc(source.ci.fetchedAt) && Date.parse(source.ci.fetchedAt) <= Date.parse(now)
    && run && Number.isSafeInteger(run.runId) && run.runId > 0
    && /^[a-f0-9]{40}$/u.test(run.targetSha)
    && canonicalUtc(run.updatedAt) && run.checkStatus === "completed"
    && run.checkConclusion === "failure"
    && finding.lastObservedAt === run.updatedAt
    && ev.referenceId === "run_" + run.runId
    && finding.resourceRef === "commit_" + run.targetSha.slice(0, 12)) {
    return { relation: "ci-run-matched", sourceFreshness,
      findingObservedAt: run.updatedAt, ciTargetSha: run.targetSha,
      deployedCommitSha: null, scsEvidenceState: "unknown" };
  }
  if (finding.sourceId === "dependency_audit"
    && /^osv_advisory_(?:0|[1-9]\d*)$/u.test(finding.ruleId)
    && ev?.kind === "dependency" && ev.code === "dependency_alert"
    && ev.referenceId === undefined
    && source.sourceHealth === "ready"
    && /^pkg_(?:0[1-9]|1[0-2])$/u.test(finding.resourceRef ?? "")
    && source.lastSuccessfulCheckAt === finding.lastObservedAt) {
    return { relation: "osv-observation-matched", sourceFreshness,
      findingObservedAt: finding.lastObservedAt, ciTargetSha: null,
      deployedCommitSha: null, scsEvidenceState: "unknown" };
  }
  return unverified;
};


/** A read-only remediation next action, never an approved or completed fix. */
export interface FindingTriageRoute {
  readonly state: "ci-run" | "osv-advisory" | "incident-playbook" | "manual-review" | "not-recorded";
  readonly action: string;
  readonly href: string | null;
  readonly auditCorrelation: "lookup-required" | "not-recorded";
  readonly remediationVerified: false;
}
interface OsvFindingAdvisory {
  readonly packageRef: string;
  readonly advisoryId: string;
}
const TRIAGE_GITHUB = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
const TRIAGE_ADVISORY =
  /^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-[0-9]{4}-[0-9]{4,}|OSV-[0-9]{4}-[0-9]+)$/u;

/** Bind a URL only to an existing matched CI/OSV observation or fixed playbook. */
export const getFindingTriageRoute = (
  finding: SecurityFinding,
  sources: readonly LineageSource[],
  now: string,
  verifiedOsvAdvisories: readonly OsvFindingAdvisory[] = [],
): FindingTriageRoute => {
  const auditCorrelation = finding.auditRequestId ? "lookup-required" : "not-recorded";
  const route = (state: FindingTriageRoute["state"], action: string, href: string | null): FindingTriageRoute =>
    ({ state, action, href, auditCorrelation, remediationVerified: false });
  if (!finding.remediationCode) return route("not-recorded", "対応コード未登録。担当者が事象を確認", null);
  const lineage = assessFindingSourceLineage(finding, sources, now);
  if (finding.remediationCode === "review_control" && lineage.relation === "ci-run-matched") {
    const source = sources.find(item => item.sourceId === finding.sourceId);
    const run = source?.ci?.latest;
    if (run && Number.isSafeInteger(run.runId) && run.runId > 0) {
      return route("ci-run", "失敗したCI Runの検査Stepと差分を確認",
        TRIAGE_GITHUB + "/actions/runs/" + run.runId);
    }
  }
  if (finding.remediationCode === "update_dependency" && lineage.relation === "osv-observation-matched"
    && verifiedOsvAdvisories.length <= 64) {
    const match = /^osv_advisory_(0|[1-9]\d*)$/u.exec(finding.ruleId);
    const index = match ? Number(match[1]) : -1;
    const advisory = verifiedOsvAdvisories[index];
    if (Number.isSafeInteger(index) && index >= 0 && advisory
      && advisory.packageRef === finding.resourceRef
      && TRIAGE_ADVISORY.test(advisory.advisoryId)) {
      return route("osv-advisory", "OSV原票で対象依存・影響範囲・修正版を調査",
        "https://osv.dev/vulnerability/" + encodeURIComponent(advisory.advisoryId));
    }
  }
  if (finding.remediationCode === "investigate_incident") {
    return route("incident-playbook", "既存インシデント対応手順に従い初動を整理",
      TRIAGE_GITHUB + "/blob/main/docs/security/SECURITY_INCIDENT_RESPONSE.md");
  }
  return route("manual-review", "ソースと対応方法を担当者が再確認（証跡不十分）", null);
};

/** A verified, bounded request-ID match in the existing integrity-checked D1 Audit viewer.
 * This proves a persisted Audit event *with this request ID*, not remediation or
 * causal linkage between the event and the Security Finding itself.
 */
export type AuditRequestLookupEvidence =
  | { readonly state: "request-id-found"; readonly record: {
      readonly id: string; readonly timestamp: string; readonly environment: "local" | "test" | "preview" | "production";
      readonly category: "authentication" | "authorization" | "mutation" | "system";
      readonly action: string; readonly outcome: "success" | "failure";
      readonly requestId: string; readonly resourceType: string | null; readonly resourceId: string | null;
    } }
  | { readonly state: "no-record" }
  | { readonly state: "invalid" };

const AUDIT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const UNSAFE_PREFIX = /^(?:sk_live|sk_test|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|bearer_)/iu;
const AUDIT_ENVIRONMENTS = ["local", "test", "preview", "production"] as const;
const AUDIT_CATEGORIES = ["authentication", "authorization", "mutation", "system"] as const;
const AUDIT_OUTCOMES = ["success", "failure"] as const;

/** Validate only minimal controlled fields from the independently authorized
 * exact-request-ID/scope API; any forged, cross-scope, or malformed result is
 * invalid, not a claim of stored proof. Runtime and D1 integrity are checked
 * by the existing Audit API before this client projection is reached.
 */
export const readVerifiedAuditRequestMatch = (
  payload: unknown, requestId: string, scopeId: string, now: string,
): AuditRequestLookupEvidence => {
  if (!AUDIT_REQUEST_ID.test(requestId) || UNSAFE_PREFIX.test(requestId)
    || scopeId !== "workhub-company" || !canonicalUtc(now)
    || !payload || typeof payload !== "object" || Array.isArray(payload)) return { state: "invalid" };
  const data = payload as Record<string, unknown>;
  if (Object.keys(data).sort().join(",") !== "items,nextCursor"
    || !Array.isArray(data.items) || data.items.length > 1
    || !(data.nextCursor === null || typeof data.nextCursor === "string")) return { state: "invalid" };
  if (data.items.length === 0) {
    return data.nextCursor === null ? { state: "no-record" } : { state: "invalid" };
  }
  const candidate: unknown = data.items[0];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { state: "invalid" };
  const item = candidate as Record<string, unknown>;
  const names = ["id", "environment", "timestamp", "requestId", "category", "action", "outcome",
    "actorId", "scopeId", "resourceType", "resourceId", "reason"].sort().join(",");
  if (Object.keys(item).sort().join(",") !== names
    || typeof item.id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.id)
    || !AUDIT_ENVIRONMENTS.some(x => x === item.environment)
    || !canonicalUtc(item.timestamp) || item.timestamp > now
    || item.scopeId !== scopeId || item.requestId !== requestId
    || !AUDIT_CATEGORIES.some(x => x === item.category)
    || typeof item.action !== "string" || item.action.length === 0 || item.action.length > 128
    || !AUDIT_OUTCOMES.some(x => x === item.outcome)
    || ![item.actorId, item.resourceType, item.resourceId, item.reason]
      .every(x => x === null || typeof x === "string")) return { state: "invalid" };
  return { state: "request-id-found", record: {
    id: item.id,
    timestamp: item.timestamp,
    environment: item.environment as "local" | "test" | "preview" | "production",
    category: item.category as "authentication" | "authorization" | "mutation" | "system",
    action: item.action,
    outcome: item.outcome as "success" | "failure",
    requestId, resourceType: item.resourceType as string | null,
    resourceId: item.resourceId as string | null,
  } };
};

/** A stored audit event can be associated with the same resource, but cannot certify remediation. */
export type FindingAuditResourceCorrelation =
  | "not-recorded" | "request-id-only" | "same-resource-successful-mutation";

export const correlateFindingAuditResource = (
  finding: SecurityFinding,
  proof: AuditRequestLookupEvidence,
  now: string,
): FindingAuditResourceCorrelation => {
  if (!finding.auditRequestId) return "not-recorded";
  if (proof.state !== "request-id-found") return "request-id-only";
  const event = proof.record;
  if (!canonicalUtc(now) || !canonicalUtc(finding.detectedAt)
    || !canonicalUtc(event.timestamp) || event.timestamp > now
    || event.timestamp < finding.detectedAt || !finding.remediationCode
    || event.requestId !== finding.auditRequestId
    || event.category !== "mutation" || event.outcome !== "success"
    || typeof finding.resourceRef !== "string" || !AUDIT_REQUEST_ID.test(finding.resourceRef)
    || !event.resourceType || event.resourceType.length > 64
    || event.resourceId !== finding.resourceRef) return "request-id-only";
  return "same-resource-successful-mutation";
};

export interface FindingViewFilters {
  readonly severity: SecuritySeverity | "all";
  readonly category: SecurityCategory | "all";
  readonly status: SecurityFindingStatus | "all";
}
export const selectSecurityFindings = (
  items: readonly SecurityFinding[], filters: FindingViewFilters,
): readonly SecurityFinding[] => items.filter(item =>
  (filters.severity === "all" || SECURITY_SEVERITIES.includes(filters.severity) && item.severity === filters.severity)
  && (filters.category === "all" || SECURITY_CATEGORIES.includes(filters.category) && item.category === filters.category)
  && (filters.status === "all" || SECURITY_STATUSES.includes(filters.status) && item.status === filters.status));
