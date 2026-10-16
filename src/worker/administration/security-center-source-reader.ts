import { normalizeSecuritySourceCoverage, type SecuritySourceCoverage } from "../../shared/security/security-finding";
import { normalizeSecuritySourceSnapshot, type SecurityCheckStatus, type SecurityCheckConclusion } from "../../shared/security/security-source-snapshot";
import type { RuntimeEnvironment } from "../../shared/runtime";

// WORKHUB reference wiring, not a user-selectable URL or a generic Template policy.
export const SECURITY_REPOSITORY = "ha-rookie/ai-driven-fullstack-webapp-template";
export const SECURITY_WORKFLOWS = [
  { sourceId: "secret_detection", sourceKind: "secret-detection", workflow: "secret-detection.yml", jobName: "scan-secrets", stepName: "Scan tracked files for secret candidates", stepCode: "secret_scan" },
  { sourceId: "dependency_audit", sourceKind: "dependency-audit", workflow: "dependency-vulnerability.yml", jobName: "audit-dependencies", stepName: "Audit production dependencies", stepCode: "dependency_production_audit" },
  { sourceId: "configuration_check", sourceKind: "configuration-check", workflow: "security-configuration.yml", jobName: "validate-security-configuration", stepName: "Validator self-test", stepCode: "configuration_validation_self_test" },
  { sourceId: "scs_control_mapping", sourceKind: "scs-control-mapping", workflow: "scs-mapping.yml", jobName: "validate-scs-mapping", stepName: "Validate SCS mapping contract", stepCode: "scs_mapping_validation" },
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

/**
 * Exact GitHub Actions job-step metadata on demand. This is a control step
 * observation, NOT a vulnerability Finding, result artifact or certification.
 */
export interface SecurityControlStepEvidence {
  readonly schemaVersion: 1;
  readonly sourceId: SourcePolicy["sourceId"];
  readonly stepCode: SourcePolicy["stepCode"];
  readonly runId: number | null;
  readonly targetSha: string | null;
  readonly state: "observed" | "unavailable" | "not-run";
  readonly conclusion: SecurityCheckConclusion | null;
}
export type SecurityCenterStepReader = (
  source: SecurityCenterSource, asOf: string,
) => Promise<SecurityControlStepEvidence>;

const projectStepOutcome = (
  data: unknown, policy: SourcePolicy, run: SecurityWorkflowExecution,
): SecurityCheckConclusion => {
  const list = object(data);
  // Exactly one known job is expected in these four reviewed Workflows.
  // Ambiguous reruns/pagination are not a valid single-step proof.
  if (list.total_count !== 1 || !Array.isArray(list.jobs) || list.jobs.length !== 1) {
    throw new TypeError("Ambiguous or incomplete CI job record");
  }
  const job = object(list.jobs[0]);
  if (job.run_id !== run.runId || job.head_sha !== run.targetSha
    || job.name !== policy.jobName || job.status !== "completed"
    || !Array.isArray(job.steps) || job.steps.length > 64) {
    throw new TypeError("Untrusted CI job identity");
  }
  const matching = job.steps.map(object).filter(step => step.name === policy.stepName);
  if (matching.length !== 1) throw new TypeError("Missing or duplicate expected control step");
  const step = matching[0];
  const allowed: readonly string[] = ["success", "failure", "cancelled", "skipped",
    "timed-out", "neutral", "action-required"];
  const conclusion = step.conclusion === "timed_out" ? "timed-out"
    : step.conclusion === "action_required" ? "action-required" : step.conclusion;
  if (step.status !== "completed" || typeof conclusion !== "string"
    || !allowed.includes(conclusion)) throw new TypeError("Untrusted control step outcome");
  return conclusion as SecurityCheckConclusion;
};

export const createSecurityCenterStepReader = (fetcher: typeof fetch = fetch): SecurityCenterStepReader => {
  const cache = new Map<string, { at: number; value: SecurityControlStepEvidence }>();
  const pending = new Map<string, Promise<SecurityControlStepEvidence>>();
  return async (source, asOf) => {
    const policy = SECURITY_WORKFLOWS.find(candidate => candidate.sourceId === source.sourceId);
    if (!policy) throw new TypeError("Unrecognized security source");
    const at = Date.parse(asOf);
    if (!Number.isFinite(at) || new Date(at).toISOString() !== asOf) {
      throw new TypeError("Invalid observation timestamp");
    }
    const latest = source.ci.latest;
    const base = {
      schemaVersion: 1 as const, sourceId: policy.sourceId, stepCode: policy.stepCode,
      runId: latest?.runId ?? null, targetSha: latest?.targetSha ?? null,
    };
    if (source.ci.state !== "available" || !latest || latest.checkStatus !== "completed") {
      return { ...base, state: "not-run", conclusion: null };
    }
    if (!Number.isSafeInteger(latest.runId) || latest.runId <= 0
      || !/^[a-f0-9]{40}$/u.test(latest.targetSha)) {
      throw new TypeError("Unsafe source Run ID or SHA");
    }
    const key = policy.sourceId + ":" + latest.runId + ":" + latest.targetSha;
    const cached = cache.get(policy.sourceId);
    if (cached && at >= cached.at && at - cached.at < CACHE_TTL
      && cached.value.runId === latest.runId && cached.value.targetSha === latest.targetSha) {
      return cached.value;
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = (async (): Promise<SecurityControlStepEvidence> => {
      try {
        const response = await fetcher(
          `https://api.github.com/repos/${SECURITY_REPOSITORY}/actions/runs/${latest.runId}/jobs?per_page=20`,
          { method: "GET", redirect: "error", credentials: "omit",
            signal: AbortSignal.timeout(15000),
            headers: { accept: "application/vnd.github+json",
              "user-agent": "workhub-security-center", "x-github-api-version": "2026-03-10" } },
        );
        const conclusion = projectStepOutcome(await readJson(response), policy, latest);
        return { ...base, state: "observed", conclusion };
      } catch {
        return { ...base, state: "unavailable", conclusion: null };
      }
    })();
    pending.set(key, request);
    try {
      const result = await request;
      cache.set(policy.sourceId, { at, value: result });
      return result;
    } finally { pending.delete(key); }
  };
};
export const readSecurityCenterStep = createSecurityCenterStepReader();
