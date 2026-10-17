/**
 * #420: browse source-reference paths from the reviewed SCS mapping, not SCS evidence.
 * Paths are untrusted strings at the UI boundary; never accept a host, query, hash,
 * encoded traversal, arbitrary extension or filesystem traversal.
 */
export interface ScsTestSourceLink {
  readonly path: string;
  /** Link to the current repository main only, NOT to the deployed app or a verified check. */
  readonly href: string;
}

const REPO_SOURCE_BASE = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/";
const TEST_FILE = /^tests\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.test\.ts$/u;
const SCRIPT_FILE = /^scripts\/(?:[a-z0-9_-]+\/)*[a-z0-9][a-z0-9._-]*\.(?:mjs|sh)$/u;
const WORKFLOW_FILE = /^\.github\/workflows\/[a-z0-9][a-z0-9._-]*\.ya?ml$/u;

const safePath = (path: string): boolean => path.length <= 160
  && !path.includes("..") && !path.includes("//")
  && (TEST_FILE.test(path) || SCRIPT_FILE.test(path) || WORKFLOW_FILE.test(path));

/**
 * A mapping's semicolon-separated test path field becomes bounded *source links*.
 * An invalid member invalidates the whole field to avoid partial trust promotion.
 */
export const scsTestSourceLinks = (reference: unknown): readonly ScsTestSourceLink[] => {
  if (typeof reference !== "string" || reference.length > 1024 || !reference.trim() || /[\r\n]/u.test(reference)) return [];
  const entries = reference.split(";");
  if (entries.length > 8) return [];
  const paths = entries.map((entry) => entry.trim());
  if (paths.some((path) => !safePath(path)) || new Set(paths).size !== paths.length) return [];
  return paths.map((path) => Object.freeze({ path, href: REPO_SOURCE_BASE + path }));
};

/**
 * #420: The reviewed SCS mapping associates exactly two requirements with
 * the existing dependency CI workflow. Other registered test files are NOT
 * known to be executed by this workflow; never infer their run evidence.
 *
 * This association only allows an explicit, authorized lookup of a CI STEP;
 * the UI still independently validates the resulting run ID/SHA/stepCode.
 * It does not verify the SCS assessment or that a test passed on Production.
 */
export const scsReviewedCiStepSource = (
  requirement: ScsOsvTraceRequirement & { readonly testReference: string | null },
): "dependency_audit" | null => {
  const registered = scsTestSourceLinks(requirement.testReference);
  if ((requirement.id !== "4-4-4" && requirement.id !== "3-2-1")
    || requirement.responsibility !== "Partially Implemented"
    || !requirement.evidenceReference?.split(";").map(value => value.trim())
      .includes("Dependency vulnerability scan")
    || !registered.some(link => link.path === ".github/workflows/dependency-vulnerability.yml")) {
    return null;
  }
  return "dependency_audit";
};

/** #420: The 43-row Requirement → Evidence path is a coverage/provenance
 * status, not a claim that a registered test ran or that SCS evidence is valid.
 * Only an already verified, bounded OSV technical trace can upgrade the
 * observation column. SCS evidence is never promoted by this helper.
 */
export type ScsEvidencePathState =
  | "technical-observation" | "registered-reference-only" | "no-valid-test-reference";
export interface ScsRequirementEvidencePath {
  readonly requirementId: string;
  readonly state: ScsEvidencePathState;
  readonly testLinks: readonly ScsTestSourceLink[];
  readonly scsEvidenceState: "unknown";
  readonly technicalObservation: ScsOsvTechnicalTrace | null;
}
export const scsRequirementEvidencePath = (
  requirement: ScsOsvTraceRequirement & { readonly testReference: string | null },
  technical: ScsOsvTechnicalTrace | null,
): ScsRequirementEvidencePath => {
  const testLinks = scsTestSourceLinks(requirement.testReference);
  const associated = (requirement.id === "4-4-4" || requirement.id === "3-2-1")
    && requirement.responsibility === "Partially Implemented"
    && requirement.evidenceReference?.split(";").map(value => value.trim())
      .includes("Dependency vulnerability scan");
  // Never trust a caller's technical marker for unrelated or unmapped controls.
  const actual = associated && technical?.kind === "scoped-osv-technical-observation"
    && technical.sourceId === "dependency_audit"
    && technical.scsEvidenceState === "unknown"
    && technical.remediationVerified === false
    && technical.auditCorrelationVerified === false
    && testLinks.some(link => link.path === ".github/workflows/dependency-vulnerability.yml")
      ? technical : null;
  return {
    requirementId: requirement.id,
    state: actual ? "technical-observation"
      : testLinks.length > 0 ? "registered-reference-only" : "no-valid-test-reference",
    testLinks,
    scsEvidenceState: "unknown",
    technicalObservation: actual,
  };
};

/** #420 Slice L: a checked OSV observation can be linked to two mapped
 * requirements, but it never upgrades the requirement's SCS Evidence status.
 * No external query, event creation or unverifiable issue/audit correlation.
 */
export interface ScsOsvTraceRequirement {
  readonly id: string;
  readonly responsibility: string;
  readonly evidenceReference: string | null;
}
export interface ScsOsvTraceSource {
  readonly sourceId: string;
  readonly coverageState: string;
  readonly sourceHealth: string;
  readonly lastSuccessfulCheckAt?: string;
  readonly evidenceValidUntil?: string;
  readonly checkedFindingCount: number | null;
}
export interface ScsOsvTraceObservation {
  readonly state: "verified" | "unavailable";
  readonly checkedAt: string | null;
  readonly checkedPackages: number | null;
  readonly advisoryCount: number | null;
  readonly advisories: readonly { readonly packageRef: string; readonly advisoryId: string }[] | null;
}
export interface ScsOsvTechnicalTrace {
  readonly kind: "scoped-osv-technical-observation";
  readonly sourceId: "dependency_audit";
  readonly checkedPackages: 12;
  readonly checkedAt: string;
  readonly validUntil: string;
  readonly freshness: "current" | "stale";
  readonly advisoryCount: number;
  readonly advisories: readonly { readonly packageRef: string; readonly advisoryId: string }[];
  readonly scsEvidenceState: "unknown";
  readonly remediationVerified: false;
  readonly auditCorrelationVerified: false;
}
const OSV_ID = /^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-[0-9]{4}-[0-9]{4,}|OSV-[0-9]{4}-[0-9]+)$/u;
const PACKAGE_REF = /^pkg_(?:0[1-9]|1[0-2])$/u;
const SCS_OSV_REQUIREMENTS = ["4-4-4", "3-2-1"] as const;
const canonicalTime = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
};

/** Never map an unrelated/organizational SCS requirement to a technical OSV result. */
export const scsOsvTechnicalEvidenceTrace = (
  requirement: ScsOsvTraceRequirement,
  source: ScsOsvTraceSource | undefined,
  observation: ScsOsvTraceObservation,
  snapshotAt: string,
  now: string,
): ScsOsvTechnicalTrace | null => {
  if (!SCS_OSV_REQUIREMENTS.some(id => id === requirement.id)
    || requirement.responsibility !== "Partially Implemented"
    || !requirement.evidenceReference?.split(";").map(entry => entry.trim()).includes("Dependency vulnerability scan")
    || !source || source.sourceId !== "dependency_audit"
    || source.coverageState !== "checked" || source.sourceHealth !== "ready"
    || observation.state !== "verified" || observation.checkedPackages !== 12
    || !canonicalTime(observation.checkedAt) || !canonicalTime(source.lastSuccessfulCheckAt)
    || !canonicalTime(source.evidenceValidUntil)
    || !canonicalTime(snapshotAt) || !canonicalTime(now)
    || observation.checkedAt !== source.lastSuccessfulCheckAt
    || Date.parse(source.evidenceValidUntil) !== Date.parse(observation.checkedAt) + 300_000
    || Date.parse(observation.checkedAt) > Date.parse(snapshotAt)
    || Date.parse(snapshotAt) - Date.parse(observation.checkedAt) >= 300_000
    || Date.parse(now) < Date.parse(observation.checkedAt)
    || !Array.isArray(observation.advisories)
    || observation.advisories.length > 64
    || observation.advisoryCount !== observation.advisories.length
    || source.checkedFindingCount !== observation.advisoryCount) return null;
  const seen = new Set<string>();
  for (const advisory of observation.advisories) {
    if (!advisory || !PACKAGE_REF.test(advisory.packageRef) || !OSV_ID.test(advisory.advisoryId)) return null;
    const key = advisory.packageRef + ":" + advisory.advisoryId;
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return Object.freeze({
    kind: "scoped-osv-technical-observation" as const,
    sourceId: "dependency_audit" as const,
    checkedPackages: 12 as const,
    checkedAt: observation.checkedAt,
    validUntil: source.evidenceValidUntil,
    freshness: Date.parse(now) >= Date.parse(source.evidenceValidUntil) ? "stale" as const : "current" as const,
    advisoryCount: observation.advisoryCount,
    advisories: Object.freeze([...observation.advisories]),
    scsEvidenceState: "unknown" as const,
    remediationVerified: false as const,
    auditCorrelationVerified: false as const,
  });
};
