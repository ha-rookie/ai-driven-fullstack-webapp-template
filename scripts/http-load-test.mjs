import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";

const HARD_MAX_REQUESTS = 5_000;
const HARD_MAX_CONCURRENCY = 50;
const HARD_MAX_DELAY_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const profiles = Object.freeze({
  smoke: { requests: 40, concurrency: 4, delayMs: 0 },
  load: { requests: 400, concurrency: 10, delayMs: 0 },
  stress: { requests: 1_200, concurrency: 25, delayMs: 0 },
  soak: { requests: 600, concurrency: 5, delayMs: 500 },
});

const scenarios = Object.freeze({
  health: [{ path: "/api/health/database", expectedStatus: 200, name: "database-health" }],
  "auth-boundary": [{ path: "/api/auth/me", expectedStatus: 401, name: "unauthenticated-auth-boundary" }],
  mixed: [
    { path: "/api/health/database", expectedStatus: 200, name: "database-health" },
    { path: "/api/auth/me", expectedStatus: 401, name: "unauthenticated-auth-boundary" },
  ],
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const numericEnv = (name, { min = 0, max = Number.POSITIVE_INFINITY } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
};

const parsePositiveInteger = (value, name, max) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
};

const parseNonNegativeInteger = (value, name, max) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}`);
  }
  return parsed;
};

const parseArgs = argv => {
  const args = {
    mode: null,
    baseUrl: null,
    profile: "smoke",
    scenario: "mixed",
    output: "artifacts/performance/http-load.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--self-test") {
      args.selfTest = true;
      continue;
    }
    const supported = [
      "--mode",
      "--base-url",
      "--profile",
      "--scenario",
      "--output",
      "--requests",
      "--concurrency",
      "--delay-ms",
    ];
    if (!supported.includes(value)) throw new Error(`Unknown argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = next;
    index += 1;
  }
  return args;
};

const normalizeBaseUrl = raw => {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("base URL must not contain credentials, query, or fragment");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("base URL must be an origin without a path");
  return new URL(url.origin);
};

const sameOrigin = (left, right) => {
  if (!left || !right) return false;
  try {
    return normalizeBaseUrl(left).origin === normalizeBaseUrl(right).origin;
  } catch {
    return false;
  }
};

const validateTarget = ({ mode, baseUrl }) => {
  if (!["local", "preview"].includes(mode)) throw new Error("mode must be local or preview");
  const url = normalizeBaseUrl(baseUrl);

  if (mode === "local") {
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("local mode only allows localhost");
    return url;
  }

  if (url.protocol !== "https:") throw new Error("preview mode requires https");
  if (["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("preview mode cannot target localhost");
  if (process.env.LOAD_TEST_CONFIRMATION !== "LOAD_TEST_PREVIEW") {
    throw new Error("preview mode requires LOAD_TEST_CONFIRMATION=LOAD_TEST_PREVIEW");
  }
  if (!process.env.PREVIEW_BASE_URL || !sameOrigin(process.env.PREVIEW_BASE_URL, url.origin)) {
    throw new Error("preview target must exactly match PREVIEW_BASE_URL");
  }
  if (process.env.PRODUCTION_BASE_URL && sameOrigin(process.env.PRODUCTION_BASE_URL, url.origin)) {
    throw new Error("preview target must not match PRODUCTION_BASE_URL");
  }
  return url;
};

const resolvePlan = args => {
  const profile = profiles[args.profile];
  if (!profile) throw new Error(`Unknown profile: ${args.profile}`);
  if (!scenarios[args.scenario]) throw new Error(`Unknown scenario: ${args.scenario}`);

  const requests = args.requests === undefined
    ? profile.requests
    : parsePositiveInteger(args.requests, "requests", HARD_MAX_REQUESTS);
  const concurrency = args.concurrency === undefined
    ? profile.concurrency
    : parsePositiveInteger(args.concurrency, "concurrency", HARD_MAX_CONCURRENCY);
  const delayMs = args.delayMs === undefined
    ? profile.delayMs
    : parseNonNegativeInteger(args.delayMs, "delay-ms", HARD_MAX_DELAY_MS);

  if (requests > HARD_MAX_REQUESTS) throw new Error(`requests exceeds hard safety cap ${HARD_MAX_REQUESTS}`);
  if (concurrency > HARD_MAX_CONCURRENCY) throw new Error(`concurrency exceeds hard safety cap ${HARD_MAX_CONCURRENCY}`);
  if (delayMs > HARD_MAX_DELAY_MS) throw new Error(`delay-ms exceeds hard safety cap ${HARD_MAX_DELAY_MS}`);

  return {
    profile: args.profile,
    scenario: args.scenario,
    requests,
    concurrency,
    delayMs,
  };
};

const readBoundedBody = async response => {
  if (!response.body) return 0;
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
  }
};

const runOne = async ({ baseUrl, scenario, sequence }) => {
  const started = performance.now();
  const url = new URL(scenario.path, baseUrl);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "user-agent": "fullstack-template-load-test/1",
        "x-performance-sequence": String(sequence),
      },
    });
    const responseBytes = await readBoundedBody(response);
    const latencyMs = performance.now() - started;
    return {
      scenario: scenario.name,
      status: response.status,
      expectedStatus: scenario.expectedStatus,
      ok: response.status === scenario.expectedStatus,
      latencyMs,
      responseBytes,
      transportError: null,
    };
  } catch (error) {
    return {
      scenario: scenario.name,
      status: null,
      expectedStatus: scenario.expectedStatus,
      ok: false,
      latencyMs: performance.now() - started,
      responseBytes: 0,
      transportError: error instanceof Error ? error.name : "unknown",
    };
  }
};

const percentile = (values, percent) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, index)].toFixed(3));
};

const executePlan = async ({ baseUrl, plan }) => {
  const scenarioList = scenarios[plan.scenario];
  const results = new Array(plan.requests);
  let nextIndex = 0;
  const started = performance.now();

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= plan.requests) return;
      const scenario = scenarioList[index % scenarioList.length];
      results[index] = await runOne({ baseUrl, scenario, sequence: index + 1 });
      if (plan.delayMs > 0 && index + plan.concurrency < plan.requests) await sleep(plan.delayMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(plan.concurrency, plan.requests) }, worker));
  const durationMs = performance.now() - started;
  return { results, durationMs };
};

const summarize = ({ results, durationMs, plan, baseUrl, mode }) => {
  const failed = results.filter(result => !result.ok);
  const latencies = results.map(result => result.latencyMs);
  const statusCounts = {};
  const scenarioCounts = {};
  let responseBytes = 0;

  for (const result of results) {
    const statusKey = result.status === null ? "transport-error" : String(result.status);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
    scenarioCounts[result.scenario] = (scenarioCounts[result.scenario] ?? 0) + 1;
    responseBytes += result.responseBytes;
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode,
    targetOrigin: baseUrl.origin,
    profile: plan.profile,
    scenario: plan.scenario,
    configured: {
      requests: plan.requests,
      concurrency: plan.concurrency,
      delayMs: plan.delayMs,
    },
    result: {
      requests: results.length,
      successes: results.length - failed.length,
      failures: failed.length,
      errorRate: Number((failed.length / Math.max(1, results.length)).toFixed(6)),
      durationMs: Number(durationMs.toFixed(3)),
      requestsPerSecond: Number((results.length / Math.max(durationMs / 1000, 0.001)).toFixed(3)),
      latencyMs: {
        min: Number(Math.min(...latencies).toFixed(3)),
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: Number(Math.max(...latencies).toFixed(3)),
      },
      statusCounts,
      scenarioCounts,
      responseBytes,
    },
    safety: {
      readOnlyScenarios: true,
      productionTargetSupported: false,
      hardMaxRequests: HARD_MAX_REQUESTS,
      hardMaxConcurrency: HARD_MAX_CONCURRENCY,
    },
  };
};

const assessThresholds = evidence => {
  const maxErrorRate = numericEnv("LOAD_TEST_MAX_ERROR_RATE", { min: 0, max: 1 });
  const maxP95Ms = numericEnv("LOAD_TEST_MAX_P95_MS", { min: 0 });
  const checks = [
    {
      name: "maxErrorRate",
      configured: maxErrorRate !== null,
      actual: evidence.result.errorRate,
      limit: maxErrorRate,
      status: maxErrorRate === null ? "not-configured" : evidence.result.errorRate <= maxErrorRate ? "pass" : "fail",
    },
    {
      name: "maxP95Ms",
      configured: maxP95Ms !== null,
      actual: evidence.result.latencyMs.p95,
      limit: maxP95Ms,
      status: maxP95Ms === null ? "not-configured" : evidence.result.latencyMs.p95 <= maxP95Ms ? "pass" : "fail",
    },
  ];
  return {
    configured: checks.some(check => check.configured),
    status: checks.some(check => check.status === "fail") ? "fail" : "pass",
    checks,
  };
};

const toMarkdown = evidence => [
  "# HTTP load evidence",
  "",
  `- generatedAt: ${evidence.generatedAt}`,
  `- mode: ${evidence.mode}`,
  `- targetOrigin: ${evidence.targetOrigin}`,
  `- profile: ${evidence.profile}`,
  `- scenario: ${evidence.scenario}`,
  `- requests: ${evidence.result.requests}`,
  `- concurrency: ${evidence.configured.concurrency}`,
  `- errorRate: ${evidence.result.errorRate}`,
  `- p95 latency ms: ${evidence.result.latencyMs.p95}`,
  `- requests/sec: ${evidence.result.requestsPerSecond}`,
  `- threshold status: ${evidence.thresholdAssessment.configured ? evidence.thresholdAssessment.status : "not-configured"}`,
  "",
  "## Status counts",
  "",
  "| Status | Count |",
  "| --- | ---: |",
  ...Object.entries(evidence.result.statusCounts).map(([status, count]) => `| ${status} | ${count} |`),
  "",
  "## Thresholds",
  "",
  "| Check | Actual | Limit | Status |",
  "| --- | ---: | ---: | --- |",
  ...evidence.thresholdAssessment.checks.map(check =>
    `| ${check.name} | ${check.actual} | ${check.limit ?? "-"} | ${check.status} |`),
  "",
  "> Template profiles are safety-bounded evidence workloads, not universal SLA/SLO targets.",
  "",
].join("\n");

const writeEvidence = (filename, evidence) => {
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  fs.writeFileSync(filename.replace(/\.json$/i, ".md"), toMarkdown(evidence), "utf8");
};

const selfTest = async () => {
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/health/database")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    if (request.url?.startsWith("/api/auth/me")) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"authenticated":false}');
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = validateTarget({ mode: "local", baseUrl: `http://127.0.0.1:${address.port}` });
    const plan = resolvePlan({
      profile: "smoke",
      scenario: "mixed",
      requests: "12",
      concurrency: "3",
      delayMs: "0",
    });
    const execution = await executePlan({ baseUrl, plan });
    const evidence = summarize({ ...execution, plan, baseUrl, mode: "local" });
    assert.equal(evidence.result.requests, 12);
    assert.equal(evidence.result.failures, 0);
    assert.equal(evidence.result.statusCounts["200"], 6);
    assert.equal(evidence.result.statusCounts["401"], 6);
    assert.ok(evidence.result.latencyMs.p95 >= 0);
    assert.throws(() => validateTarget({ mode: "local", baseUrl: "https://example.com" }), /localhost/);
    console.log("http-load-test self-test: ok");
  } finally {
    server.close();
    await once(server, "close");
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    await selfTest();
    return;
  }

  const plan = resolvePlan(args);
  const baseUrl = validateTarget({ mode: args.mode, baseUrl: args.baseUrl });
  const execution = await executePlan({ baseUrl, plan });
  const evidence = summarize({ ...execution, plan, baseUrl, mode: args.mode });
  evidence.thresholdAssessment = assessThresholds(evidence);
  writeEvidence(args.output, evidence);

  console.log(JSON.stringify({
    mode: evidence.mode,
    profile: evidence.profile,
    requests: evidence.result.requests,
    failures: evidence.result.failures,
    errorRate: evidence.result.errorRate,
    p95Ms: evidence.result.latencyMs.p95,
    requestsPerSecond: evidence.result.requestsPerSecond,
    thresholdStatus: evidence.thresholdAssessment.configured ? evidence.thresholdAssessment.status : "not-configured",
  }));

  if (evidence.result.failures > 0) process.exitCode = 1;
  if (evidence.thresholdAssessment.configured && evidence.thresholdAssessment.status === "fail") process.exitCode = 1;
};

await main();
