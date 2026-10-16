import { normalizeSecuritySourceCoverage, type SecuritySourceCoverage } from "../../shared/security/security-finding";
import { normalizeSecuritySourceSnapshot, type SecurityCheckStatus, type SecurityCheckConclusion } from "../../shared/security/security-source-snapshot";
import type { RuntimeEnvironment } from "../../shared/runtime";

// WORKHUB reference wiring, not a user-selectable URL or a generic Template policy.
export const SECURITY_REPOSITORY = "ha-rookie/ai-driven-fullstack-webapp-template";
export const SECURITY_WORKFLOWS = [
  { sourceId: "secret_detection", sourceKind: "secret-detection", workflow: "secret-detection.yml" },
  { sourceId: "dependency_audit", sourceKind: "dependency-audit", workflow: "dependency-vulnerability.yml" },
  { sourceId: "configuration_check", sourceKind: "configuration-check", workflow: "security-configuration.yml" },
  { sourceId: "scs_control_mapping", sourceKind: "scs-control-mapping", workflow: "scs-mapping.yml" },
] as const;
type SourcePolicy = typeof SECURITY_WORKFLOWS[number];
const EVENTS = ["pull_request", "pull_request_target", "push", "schedule", "workflow_dispatch"] as const;
const MAX_BYTES = 256 * 1024;
// Four requests per five minutes at most per isolate, including failure backoff.
const CACHE_TTL = 300_000;

export interface SecurityWorkflowExecution {
  readonly runId: number;
  readonly targetSha: string;
  readonly checkStatus: SecurityCheckStatus;
  readonly checkConclusion?: SecurityCheckConclusion;
  readonly event: typeof EVENTS[number];
  readonly updatedAt: string;
}
export interface SecurityCenterSource extends SecuritySourceCoverage {
  readonly ci: {
    readonly state: "not-connected" | "available" | "unavailable";
    readonly fetchedAt: string | null;
    readonly latest: SecurityWorkflowExecution | null;
    readonly latestSuccessfulRun: SecurityWorkflowExecution | null;
  };
}
export type SecurityCenterSourceReader = (
  environment: RuntimeEnvironment, asOf: string,
) => Promise<readonly SecurityCenterSource[]>;

export const unconnectedSecuritySources = (asOf: string): readonly SecurityCenterSource[] =>
  SECURITY_WORKFLOWS.map(({ sourceId }) => ({
    ...normalizeSecuritySourceCoverage({ sourceId, coverageState: "not-checked", sourceHealth: "unmonitored" }, asOf),
    ci: { state: "not-connected", fetchedAt: null, latest: null, latestSuccessfulRun: null },
  }));

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid provider object");
  return value as Record<string, unknown>;
};
const timestamp = (value: unknown, asOf: string): string => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value)) {
    throw new TypeError("Invalid provider time");
  }
  const canonical = new Date(value).toISOString();
  if (canonical.replace(".000Z", "Z") !== value.replace(".000Z", "Z") || canonical > asOf) {
    throw new TypeError("Invalid provider chronology");
  }
  return canonical;
};

const execution = (input: unknown, policy: SourcePolicy, asOf: string): SecurityWorkflowExecution => {
  const run = object(input);
  if (object(run.repository).full_name !== SECURITY_REPOSITORY
    || run.path !== `.github/workflows/${policy.workflow}`
    || !Number.isSafeInteger(run.id) || (run.id as number) <= 0
    || !EVENTS.includes(run.event as typeof EVENTS[number])) throw new TypeError("Untrusted workflow identity");
  const updatedAt = timestamp(run.updated_at, asOf);
  const createdAt = timestamp(run.created_at, asOf);
  if (createdAt > updatedAt) throw new TypeError("Invalid workflow chronology");
  if (!["queued", "in_progress", "requested", "waiting", "pending", "completed"].includes(run.status as string)) {
    throw new TypeError("Unknown workflow state");
  }
  const status = run.status === "in_progress" ? "in-progress"
    : ["requested", "waiting", "pending"].includes(run.status as string) ? "queued" : run.status;
  const conclusion = run.conclusion === "timed_out" ? "timed-out"
    : run.conclusion === "action_required" ? "action-required"
      : run.conclusion === "startup_failure" ? "failure"
        : run.conclusion === "stale" ? "cancelled" : run.conclusion;
  const snapshot = normalizeSecuritySourceSnapshot({
    sourceId: policy.sourceId, sourceKind: policy.sourceKind, checkId: policy.sourceId,
    targetSha: run.head_sha, observedAt: asOf, checkStatus: status,
    ...(status === "completed" ? { checkConclusion: conclusion, runId: run.id }
      : run.conclusion === null ? {} : { checkConclusion: conclusion }),
  }, run.head_sha as string, asOf);
  return {
    runId: run.id as number, targetSha: snapshot.targetSha, checkStatus: snapshot.checkStatus,
    ...(snapshot.checkConclusion ? { checkConclusion: snapshot.checkConclusion } : {}),
    event: run.event as typeof EVENTS[number], updatedAt,
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("json")
    || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) {
    await response.body?.cancel();
    throw new TypeError("Provider unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new RangeError("Provider response too large");
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { await reader.cancel(); }
};

const projectRuns = (input: unknown, policy: SourcePolicy, asOf: string): SecurityCenterSource => {
  const data = object(input);
  if (!Array.isArray(data.workflow_runs) || data.workflow_runs.length > 5
    || !Number.isSafeInteger(data.total_count) || (data.total_count as number) < data.workflow_runs.length
    || (data.workflow_runs.length === 0 && data.total_count !== 0)) throw new TypeError("Invalid workflow list");
  const runs = data.workflow_runs.map(run => execution(run, policy, asOf))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.runId - a.runId);
  if (new Set(runs.map(run => run.runId)).size !== runs.length) throw new TypeError("Duplicate run identity");
  const latest = runs[0] ?? null;
  const coverage = latest ? normalizeSecuritySourceSnapshot({
    sourceId: policy.sourceId, sourceKind: policy.sourceKind, checkId: policy.sourceId,
    targetSha: latest.targetSha, observedAt: asOf, checkStatus: latest.checkStatus,
    ...(latest.checkConclusion ? { checkConclusion: latest.checkConclusion, runId: latest.runId } : {}),
  }, latest.targetSha, asOf).coverage : normalizeSecuritySourceCoverage({
    sourceId: policy.sourceId, coverageState: "not-checked", sourceHealth: "unmonitored",
  }, asOf);
  return {
    ...coverage,
    ci: { state: "available", fetchedAt: asOf, latest,
      latestSuccessfulRun: runs.find(run => run.checkStatus === "completed" && run.checkConclusion === "success") ?? null },
  };
};

/** Public metadata only. Local/Test stays offline; authorization belongs to the API caller. */
export const createSecurityCenterSourceReader = (fetcher: typeof fetch = fetch): SecurityCenterSourceReader => {
  let cache: { at: number; sources: readonly SecurityCenterSource[] } | undefined;
  let pending: Promise<readonly SecurityCenterSource[]> | undefined;
  return async (environment, asOf) => {
    if (environment === "local" || environment === "test") return unconnectedSecuritySources(asOf);
    if (environment !== "preview" && environment !== "production") throw new TypeError("Invalid runtime");
    const at = Date.parse(asOf);
    if (!Number.isFinite(at) || new Date(at).toISOString() !== asOf) throw new TypeError("Invalid observation time");
    if (cache && at >= cache.at && at - cache.at < CACHE_TTL) return cache.sources;
    if (pending) return pending;
    pending = Promise.all(SECURITY_WORKFLOWS.map(async policy => {
      try {
        const response = await fetcher(
          `https://api.github.com/repos/${SECURITY_REPOSITORY}/actions/workflows/${policy.workflow}/runs?per_page=5`,
          { method: "GET", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15000),
            headers: { accept: "application/vnd.github+json", "user-agent": "workhub-security-center",
              "x-github-api-version": "2026-03-10" } },
        );
        return projectRuns(await readJson(response), policy, asOf);
      } catch {
        return { ...normalizeSecuritySourceCoverage({
          sourceId: policy.sourceId, coverageState: "unavailable", sourceHealth: "unavailable",
        }, asOf), ci: { state: "unavailable" as const, fetchedAt: asOf, latest: null, latestSuccessfulRun: null } };
      }
    }));
    try {
      const sources = await pending;
      cache = { at, sources };
      return sources;
    } finally { pending = undefined; }
  };
};

export const readSecurityCenterSources = createSecurityCenterSourceReader();
