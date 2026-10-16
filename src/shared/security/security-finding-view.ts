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
        "remediationCode", "exception", "riskDisposition"])) return false;
    const raw = value as Record<string, unknown>;
    const sourceId = raw.sourceId;
    if (typeof sourceId !== "string" || !count.has(sourceId)
      || typeof raw.assessedAt !== "string" || raw.assessedAt > asOf) return false;
    try {
      const normalized = normalizeSecurityFinding({
        ruleId: raw.ruleId, category: raw.category, severity: raw.severity,
        status: raw.status, resourceRef: raw.resourceRef, detectedAt: raw.detectedAt,
        lastObservedAt: raw.lastObservedAt, evidence: raw.evidence,
        remediationCode: raw.remediationCode, exception: raw.exception,
      }, sourceId, raw.assessedAt);
      if (raw.riskDisposition !== normalized.riskDisposition) return false;
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
