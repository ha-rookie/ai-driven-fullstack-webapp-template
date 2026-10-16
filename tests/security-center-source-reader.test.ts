import assert from "node:assert/strict";
import test from "node:test";
import { createSecurityCenterSourceReader, createSecurityCenterStepReader, unconnectedSecuritySources, SECURITY_REPOSITORY, SECURITY_WORKFLOWS, type SecurityCenterSource } from "../src/worker/administration/security-center-source-reader";

// Synthetic provider metadata only; no live CI or Production evidence is claimed.
const AS_OF = "2026-10-16T12:00:00.000Z";
const SHA = "a".repeat(40);
const policyFor = (url: string) => SECURITY_WORKFLOWS.find(p => url.includes(`/${p.workflow}/runs?`))!;
const run = (workflow: string, overrides: Record<string, unknown> = {}) => ({
  id: 42, repository: { full_name: SECURITY_REPOSITORY }, path: `.github/workflows/${workflow}`,
  head_sha: SHA, event: "pull_request", status: "completed", conclusion: "success",
  created_at: "2026-10-16T09:00:00Z", updated_at: "2026-10-16T10:00:00Z", ...overrides,
});
const list = (runs: unknown[]) => Response.json({ total_count: runs.length, workflow_runs: runs });
const fixtureFetch = (make: (workflow: string) => Response | Promise<Response>): typeof fetch =>
  (async (url: string | URL | Request) => make(policyFor(String(url)).workflow)) as typeof fetch;

test("#420 CI reader projects real-shaped success as unknown findings and only fixed credential-free GETs", async () => {
  const requests: string[] = [];
  const reader = createSecurityCenterSourceReader((async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit"); assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization"), false); assert.equal(headers.has("cookie"), false);
    return list([run(policyFor(url).workflow, { actor: { email: "fixture-private-value" }, logs_url: "fixture-private-value" })]);
  }) as typeof fetch);
  const sources = await reader("preview", AS_OF);
  assert.deepEqual(requests.sort(), SECURITY_WORKFLOWS.map(p =>
    `https://api.github.com/repos/${SECURITY_REPOSITORY}/actions/workflows/${p.workflow}/runs?per_page=5`).sort());
  for (const source of sources) {
    assert.equal(source.ci.state, "available"); assert.equal(source.ci.latest?.checkConclusion, "success");
    assert.equal(source.ci.latest?.targetSha, SHA); assert.equal(source.checkedFindingCount, null);
    assert.equal(source.coverageState, "not-checked"); assert.equal(source.freshness, "unknown");
    assert.equal(source.lastSuccessfulCheckAt, undefined);
    assert.equal(source.ci.latestSuccessfulRun?.updatedAt, "2026-10-16T10:00:00.000Z");
  }
  assert.doesNotMatch(JSON.stringify(sources), /fixture-private-value|logs_url|verifiedFindings/u);
});

test("#420 Local/Test reader is offline even after remote metadata has been cached", async () => {
  let requests = 0;
  const reader = createSecurityCenterSourceReader(fixtureFetch(workflow => { requests++; return list([run(workflow)]); }));
  for (const environment of ["local", "test"] as const) {
    assert.ok((await reader(environment, AS_OF)).every(s => s.ci.state === "not-connected"));
  }
  assert.equal(requests, 0);
  await reader("preview", AS_OF);
  assert.ok((await reader("local", AS_OF)).every(s => s.ci.latest === null));
  assert.equal(requests, 4);
});

test("#420 failure and prior success stay on separate SHA/time axes; one inaccessible source does not hide others", async () => {
  const reader = createSecurityCenterSourceReader(fixtureFetch(workflow => {
    if (workflow === "secret-detection.yml") return list([
      run(workflow, { id: 43, conclusion: "failure", head_sha: "b".repeat(40), updated_at: "2026-10-16T11:00:00Z" }), run(workflow),
    ]);
    if (workflow === "dependency-vulnerability.yml") return new Response("fixture-private-value", { status: 429 });
    return list([]);
  }));
  const sources = await reader("production", AS_OF);
  assert.equal(sources[0].coverageState, "unavailable");
  assert.equal(sources[0].ci.latest?.targetSha, "b".repeat(40));
  assert.equal(sources[0].ci.latestSuccessfulRun?.targetSha, SHA);
  assert.equal(sources[1].ci.state, "unavailable"); assert.equal(sources[1].ci.latestSuccessfulRun, null);
  assert.equal(sources[2].ci.state, "available"); assert.equal(sources[2].ci.latest, null);
  assert.ok(sources.every(s => s.checkedFindingCount === null && s.freshness === "unknown"));
  assert.doesNotMatch(JSON.stringify(sources), /fixture-private-value/u);
});

test("#420 queued/in-progress/skipped runs never become successful Finding evidence", async () => {
  for (const state of [{ status: "queued", conclusion: null }, { status: "in_progress", conclusion: null },
    { status: "waiting", conclusion: null }, { status: "completed", conclusion: "skipped" }]) {
    const reader = createSecurityCenterSourceReader(fixtureFetch(workflow => list([run(workflow, state)])));
    const sources = await reader("preview", AS_OF);
    assert.ok(sources.every(s => s.ci.state === "available" && s.coverageState === "not-checked"
      && s.checkedFindingCount === null && s.ci.latestSuccessfulRun === null));
  }
});

test("#420 untrusted identity, unknown states, future dates and invalid SHA fail closed", async () => {
  const invalid = [{ repository: { full_name: "other/repo" } }, { path: ".github/workflows/other.yml" },
    { id: -1 }, { head_sha: "not-a-sha" }, { event: "untrusted-event" }, { status: "unrecognized" },
    { status: "not-run", conclusion: null }, { status: "unavailable", conclusion: null },
    { status: "completed", conclusion: "unknown" }, { status: "queued", conclusion: "success" },
    { updated_at: "2026-10-17T00:00:00Z" }, { created_at: "2026-10-16T11:00:00Z" },
    { updated_at: "2026-02-30T00:00:00Z" }];
  for (const overrides of invalid) {
    const reader = createSecurityCenterSourceReader(fixtureFetch(workflow => list([run(workflow, overrides)])));
    assert.ok((await reader("preview", AS_OF)).every(s => s.ci.state === "unavailable"), JSON.stringify(overrides));
  }
});

test("#420 oversized, redirected, timeout and malformed responses never reuse security success", async () => {
  const cases: Array<() => Response> = [
    () => Response.json({ workflow_runs: [], total_count: 9 }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(256 * 1024 + 1) } }),
    () => new Response(" ".repeat(256 * 1024 + 1), { headers: { "content-type": "application/json" } }),
    () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { status: 302, headers: { location: "https://untrusted.example" } }),
    () => { throw new DOMException("fixture timeout", "TimeoutError"); },
  ];
  for (const make of cases) {
    const reader = createSecurityCenterSourceReader(fixtureFetch(make));
    const sources = await reader("preview", AS_OF);
    assert.ok(sources.every(s => s.ci.state === "unavailable" && s.sourceHealth === "unavailable"
      && s.ci.latest === null && s.ci.latestSuccessfulRun === null && s.checkedFindingCount === null));
  }
});

test("#420 source cache coalesces requests, retains fetch time, expires and discards success on failed refresh", async () => {
  let requests = 0; let fail = false;
  const reader = createSecurityCenterSourceReader(fixtureFetch(workflow => {
    requests++; return fail ? new Response("unavailable", { status: 503 }) : list([run(workflow)]);
  }));
  await Promise.all([reader("preview", AS_OF), reader("preview", AS_OF)]);
  assert.equal(requests, 4);
  const cached = await reader("preview", "2026-10-16T12:04:59.000Z");
  assert.equal(requests, 4); assert.ok(cached.every(s => s.ci.fetchedAt === AS_OF));
  fail = true;
  const failed = await reader("preview", "2026-10-16T12:05:00.000Z");
  assert.equal(requests, 8); assert.ok(failed.every(s => s.ci.latestSuccessfulRun === null));
  await reader("preview", "2026-10-16T12:09:59.000Z"); assert.equal(requests, 8);
  fail = false;
  const recovered = await reader("preview", "2026-10-16T12:10:00.000Z");
  assert.equal(requests, 12); assert.ok(recovered.every(s => s.ci.state === "available"));
});

const stepSource = (sourceId = "secret_detection"): SecurityCenterSource => {
  const original = unconnectedSecuritySources(AS_OF).find(s => s.sourceId === sourceId)!;
  const latest = {
    runId: 42, targetSha: SHA, checkStatus: "completed" as const,
    checkConclusion: "success" as const, event: "pull_request" as const,
    updatedAt: "2026-10-16T10:00:00.000Z",
  };
  return { ...original, ci: {
    state: "available", fetchedAt: AS_OF, latest, latestSuccessfulRun: latest,
  } };
};
const jobStepList = (sourceId = "secret_detection", overrides: Record<string, unknown> = {}) => {
  const policy = SECURITY_WORKFLOWS.find(p => p.sourceId === sourceId)!;
  return Response.json({ total_count: 1, jobs: [{
    run_id: 42, name: policy.jobName, head_sha: SHA, status: "completed",
    steps: [{ name: policy.stepName, status: "completed", conclusion: "success" }],
    ...overrides,
  }] });
};

test("#420 on-demand CI step reads only the server-owned latest run; returns source-bound outcome, not Finding", async () => {
  let requests = 0;
  const reader = createSecurityCenterStepReader((async (url, init) => {
    requests++;
    assert.equal(String(url), `https://api.github.com/repos/${SECURITY_REPOSITORY}/actions/runs/42/jobs?per_page=20`);
    assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization"), false);
    assert.equal(headers.has("cookie"), false);
    return jobStepList();
  }) as typeof fetch);
  const source = stepSource();
  const evidence = await reader(source, AS_OF);
  assert.deepEqual(evidence, {
    schemaVersion: 1, sourceId: "secret_detection", stepCode: "secret_scan",
    runId: 42, targetSha: SHA, state: "observed", conclusion: "success",
  });
  assert.equal("findings" in evidence, false);
  assert.equal("checkedFindingCount" in evidence, false);
  assert.equal(requests, 1);
  assert.deepEqual(await reader(source, "2026-10-16T12:04:59.000Z"), evidence);
  assert.equal(requests, 1);
  await reader(source, "2026-10-16T12:05:00.000Z"); assert.equal(requests, 2);
});

test("#420 no run/pending run does not trigger a provider request or imply a completed check", async () => {
  let requests = 0;
  const reader = createSecurityCenterStepReader((async () => {
    requests++; throw new Error("Must not fetch absent or unfinished check");
  }) as typeof fetch);
  const notConnected = unconnectedSecuritySources(AS_OF)[0];
  const absent = await reader(notConnected, AS_OF);
  assert.equal(absent.state, "not-run"); assert.equal(absent.runId, null);
  const pending = { ...stepSource(), ci: { ...stepSource().ci,
    latest: { ...stepSource().ci.latest!, checkStatus: "queued" as const,
      checkConclusion: undefined } } } as SecurityCenterSource;
  assert.equal((await reader(pending, AS_OF)).state, "not-run");
  assert.equal(requests, 0);
});

test("#420 source-bound step rejects untrusted jobs/step identity/status and sensitive payloads", async () => {
  const invalid = [
    { run_id: 41 }, { head_sha: "b".repeat(40) }, { name: "unreviewed-job" },
    { status: "in_progress" }, { steps: [] }, { steps: [{ name: "untrusted", status: "completed", conclusion: "success" }] },
    { steps: [{ name: "Scan tracked files for secret candidates", status: "completed", conclusion: "success" },
      { name: "Scan tracked files for secret candidates", status: "completed", conclusion: "success" }] },
    { steps: [{ name: "Scan tracked files for secret candidates", status: "queued", conclusion: null }] },
    { steps: [{ name: "Scan tracked files for secret candidates", status: "completed", conclusion: "weird" }] },
  ];
  for (const overrides of invalid) {
    const reader = createSecurityCenterStepReader((async () => jobStepList("secret_detection", overrides)) as typeof fetch);
    const evidence = await reader(stepSource(), AS_OF);
    assert.equal(evidence.state, "unavailable", JSON.stringify(overrides));
    assert.equal(evidence.conclusion, null);
  }
  const reader = createSecurityCenterStepReader((async () => Response.json({ total_count: 1, jobs: [{
    run_id: 42, name: "scan-secrets", head_sha: SHA, status: "completed",
    actor: { email: "private-test@example.test" },
    steps: [{ name: "Scan tracked files for secret candidates", status: "completed", conclusion: "failure",
      logs_url: "https://secret.test/" }],
  }] })) as typeof fetch);
  const failing = await reader(stepSource(), AS_OF);
  assert.equal(failing.state, "observed"); assert.equal(failing.conclusion, "failure");
  assert.doesNotMatch(JSON.stringify(failing), /private-test|logs_url|secret.test/u);
});

test("#420 GitHub step errors, ambiguous pagination, wrong file and oversized response remain unavailable", async () => {
  const cases = [
    () => new Response("forbidden", { status: 403 }),
    () => Response.json({ total_count: 2, jobs: [] }),
    () => Response.json({ total_count: 0, jobs: [] }),
    () => new Response("x".repeat(256 * 1024 + 1), { headers: { "content-type": "application/json" } }),
    () => new Response("{}", { status: 302, headers: { location: "https://evil.test" } }),
  ];
  for (const c of cases) {
    const reader = createSecurityCenterStepReader((async () => c()) as typeof fetch);
    assert.equal((await reader(stepSource(), AS_OF)).state, "unavailable");
  }
});

test("#420 a real-shaped failed workflow AND failed exact check step produce one bounded CI control Finding", async () => {
  const from = stepSource("secret_detection");
  const latest = { ...from.ci.latest!, checkConclusion: "failure" as const };
  const failingSource: SecurityCenterSource = { ...from,
    ci: { ...from.ci, latest, latestSuccessfulRun: null } };
  const reader = createSecurityCenterStepReader((async () => jobStepList("secret_detection", {
    steps: [{ name: "Scan tracked files for secret candidates", status: "completed", conclusion: "failure",
      log_url: "https://untrusted.test/private?token=secret" }],
    actor: { email: "private-synthetic@example.test" },
  })) as typeof fetch);
  const result = await reader(failingSource, AS_OF);
  assert.equal(result.state, "observed");
  assert.equal(result.conclusion, "failure");
  assert.deepEqual(result.controlFinding, {
    ruleId: "ci_step_failure", sourceId: "secret_detection", category: "data",
    severity: "high", status: "open", detectedAt: latest.updatedAt,
    lastObservedAt: latest.updatedAt, assessedAt: AS_OF,
    resourceRef: "commit_" + SHA.slice(0, 12),
    evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_42" }],
    remediationCode: "review_control", riskDisposition: "none",
  });
  assert.equal("verifiedFindings" in result, false);
  assert.equal("verifiedCount" in result, false);
  assert.doesNotMatch(JSON.stringify(result), /private-synthetic|untrusted.test|log_url|token=/u);
});

test("#420 successful/ambiguous provider check step NEVER creates a zero-Findings claim", async () => {
  const failures = [
    { source: stepSource(), step: "success" },
    { source: stepSource(), step: "failure" },
    { source: { ...stepSource(),
        ci: { ...stepSource().ci,
          latest: { ...stepSource().ci.latest!, checkConclusion: "failure" as const },
          latestSuccessfulRun: null } }, step: "success" },
  ];
  for (const sample of failures) {
    const reader = createSecurityCenterStepReader((async () => jobStepList("secret_detection", {
      steps: [{ name: "Scan tracked files for secret candidates",
        status: "completed", conclusion: sample.step }],
    })) as typeof fetch);
    const result = await reader(sample.source, AS_OF);
    assert.equal(result.controlFinding, undefined);
    assert.equal("verifiedCount" in result, false);
    assert.equal("checkedFindingCount" in result, false);
  }
  const unavailable = createSecurityCenterStepReader((async () => new Response("denied", { status: 403 })) as typeof fetch);
  const missing = await unavailable(failures[2].source, AS_OF);
  assert.equal(missing.state, "unavailable");
  assert.equal(missing.controlFinding, undefined);
});

test("#420 failure mapping preserves approved source-specific classification without inventing vulnerabilities", async () => {
  for (const [sourceId, category, severity] of [
    ["dependency_audit", "dependency", "high"],
    ["configuration_check", "configuration", "medium"],
    ["scs_control_mapping", "configuration", "medium"],
  ] as const) {
    const from = stepSource(sourceId);
    const failing: SecurityCenterSource = { ...from,
      ci: { ...from.ci,
        latest: { ...from.ci.latest!, checkConclusion: "failure" },
        latestSuccessfulRun: null } };
    const policy = SECURITY_WORKFLOWS.find(p => p.sourceId === sourceId)!;
    const reader = createSecurityCenterStepReader((async () => jobStepList(sourceId, {
      steps: [{ name: policy.stepName, status: "completed", conclusion: "failure" }],
    })) as typeof fetch);
    const result = await reader(failing, AS_OF);
    assert.equal(result.controlFinding?.category, category);
    assert.equal(result.controlFinding?.severity, severity);
    assert.equal(result.controlFinding?.sourceId, sourceId);
    assert.equal(result.controlFinding?.ruleId, "ci_step_failure");
  }
});
