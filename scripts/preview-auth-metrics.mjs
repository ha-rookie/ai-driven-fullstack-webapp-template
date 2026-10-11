#!/usr/bin/env node
/**
 * Issue #521: historical read-only Cloudflare Worker INVOCATION metrics.
 * This is NOT per-Ray tracing or proof of an unattributed 503's source.
 * Never log tokens, account IDs, remote errors, user data, or response bodies.
 */
import assert from "node:assert/strict";

export const INCIDENT = Object.freeze({
  scriptName: "ai-driven-fullstack-webapp-template-preview",
  startUtc: "2026-10-08T22:20:50.000Z",
  endUtc: "2026-10-08T22:21:12.000Z",
});

const graphQLQuery = [
  "query PreviewWorkerIncident($accountTag: string, $scriptName: string, $startUtc: string, $endUtc: string) {",
  "viewer { accounts(filter: {accountTag: $accountTag}) {",
  "workersInvocationsAdaptive(limit: 100, filter: {",
  "scriptName: $scriptName, datetime_geq: $startUtc, datetime_leq: $endUtc",
  "}) {",
  "dimensions { datetime scriptName status }",
  "sum { requests errors }",
  "quantiles { cpuTimeP50 cpuTimeP99 }",
  "} } } }",
].join(" ");

export const summarizeRows = rows => {
  if (!Array.isArray(rows) || rows.length > 100) throw new Error("invalid_analytics_rows");
  const statusTotals = Object.create(null);
  let requests = 0;
  let errors = 0;
  let maxCpuP99 = 0;
  const instants = new Set();
  const timeline = [];
  for (const row of rows) {
    const status = row?.dimensions?.status;
    const script = row?.dimensions?.scriptName;
    const datetime = row?.dimensions?.datetime;
    const count = row?.sum?.requests;
    const failed = row?.sum?.errors;
    const p99 = row?.quantiles?.cpuTimeP99;
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,35}$/u.test(status || "")
      || script !== INCIDENT.scriptName
      || typeof datetime !== "string" || !Number.isFinite(Date.parse(datetime))
      || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
      || typeof failed !== "number" || !Number.isSafeInteger(failed) || failed < 0
      || failed > count
      || (p99 != null && (typeof p99 !== "number" || !Number.isFinite(p99) || p99 < 0))) {
      throw new Error("invalid_analytics_row_shape");
    }
    const instant = new Date(datetime).getTime();
    if (instant < Date.parse(INCIDENT.startUtc) || instant > Date.parse(INCIDENT.endUtc)) {
      throw new Error("analytics_datetime_outside_incident");
    }
    instants.add(datetime);
    timeline.push({
      datetimeUtc: datetime,
      status,
      requests: count,
      errors: failed,
      cpuP99Raw: p99 ?? null,
    });
    statusTotals[status] = (statusTotals[status] ?? 0) + count;
    requests += count;
    errors += failed;
    maxCpuP99 = Math.max(maxCpuP99, p99 ?? 0);
    if (requests > 1e7) throw new Error("implausible_analytics_result");
  }
  return {
    dataset: "workersInvocationsAdaptive",
    timeframeUtc: [INCIDENT.startUtc, INCIDENT.endUtc],
    scriptName: INCIDENT.scriptName,
    sampledRows: rows.length,
    distinctTimesteps: instants.size,
    sampledRequests: requests,
    sampledErrors: errors,
    statusCounts: Object.fromEntries(Object.entries(statusTotals).sort()),
    timeline: timeline.sort((left, right) =>
      left.datetimeUtc.localeCompare(right.datetimeUtc)
      || left.status.localeCompare(right.status)),
    maxReportedCpuP99: maxCpuP99,
    atResponseLimit: rows.length === 100,
    individualRayIdCorrelation: false,
    rootCauseConclusive: false,
    limitation: "Adaptive Worker metrics may be sampled and cannot attribute an individual HTTP response.",
  };
};

export const parseResponse = (status, payload) => {
  if (status === 401 || status === 403) throw new Error("cloudflare_analytics_read_permission_unavailable");
  if (status === 429) throw new Error("cloudflare_analytics_rate_limited");
  if (status !== 200) throw new Error("cloudflare_analytics_http_error");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("cloudflare_analytics_invalid_response");
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error("cloudflare_analytics_schema_or_permission_error");
  }
  const accounts = payload.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) {
    throw new Error("cloudflare_analytics_account_unavailable");
  }
  return summarizeRows(accounts[0]?.workersInvocationsAdaptive);
};

const selfTest = () => {
  const row = (status = "success", count = 2, failed = 0) => ({
    dimensions: {
      datetime: "2026-10-08T22:20:59Z", scriptName: INCIDENT.scriptName, status,
    },
    sum: { requests: count, errors: failed },
    quantiles: { cpuTimeP50: 500, cpuTimeP99: 1200 },
  });
  const result = summarizeRows([row(), row("exceededResources", 1, 1)]);
  assert.equal(result.sampledRequests, 3);
  assert.equal(result.sampledErrors, 1);
  assert.equal(result.statusCounts.exceededResources, 1);
  assert.equal(result.maxReportedCpuP99, 1200);
  assert.equal(result.timeline.length, 2);
  assert.deepEqual(result.timeline.map(item => item.status),
    ["exceededResources", "success"]);
  assert.equal(result.timeline[0].datetimeUtc, "2026-10-08T22:20:59Z");
  assert.equal(result.timeline[0].cpuP99Raw, 1200);
  assert.equal(result.rootCauseConclusive, false);
  assert.equal(result.individualRayIdCorrelation, false);
  assert.deepEqual(summarizeRows([]).statusCounts, {});
  assert.throws(() => summarizeRows([row("invalid status")]), /invalid_analytics_row_shape/u);
  assert.throws(() => summarizeRows([row("error", 1, 2)]), /invalid_analytics_row_shape/u);
  assert.throws(() => summarizeRows([{
    ...row(), dimensions: { ...row().dimensions, datetime: "2026-10-09T04:00:00Z" },
  }]), /analytics_datetime_outside_incident/u);
  assert.throws(() => parseResponse(403, null), /permission/u);
  assert.throws(() => parseResponse(429, null), /rate_limited/u);
  assert.throws(() => parseResponse(200, { errors: [{ message: "sensitive" }] }), /schema_or_permission/u);
  const normal = parseResponse(200, { data: { viewer: { accounts: [{
    workersInvocationsAdaptive: [row()],
  }] } } });
  assert.equal(normal.sampledRequests, 2);
  assert.throws(() => parseResponse(200, { data: { viewer: { accounts: [] } } }),
    /account_unavailable/u);
  console.log("Preview auth metrics self-test passed");
};

const main = async () => {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--query", "--self-test"].includes(mode)) {
    throw new Error("usage: --self-test | --query");
  }
  if (mode === "--self-test") return selfTest();
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountTag) throw new Error("cloudflare_analytics_existing_credentials_unavailable");
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 12_000);
  try {
    const result = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        query: graphQLQuery,
        variables: {
          accountTag,
          scriptName: INCIDENT.scriptName,
          startUtc: INCIDENT.startUtc,
          endUtc: INCIDENT.endUtc,
        },
      }),
    });
    if (result.status === 401 || result.status === 403) {
      throw new Error("cloudflare_analytics_read_permission_unavailable");
    }
    if (result.status === 429) throw new Error("cloudflare_analytics_rate_limited");
    if (!result.ok) throw new Error("cloudflare_analytics_http_error");
    const report = parseResponse(result.status, await result.json());
    console.log("Preview Worker incident metrics (read-only, sanitized):");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("cloudflare_analytics_timeout");
    if (error instanceof Error && /^cloudflare_analytics_[a-z_]+$/u.test(error.message)) {
      throw error;
    }
    throw new Error("cloudflare_analytics_query_failed");
  } finally {
    clearTimeout(deadline);
  }
};

try {
  await main();
} catch (error) {
  console.error("Preview metrics unavailable:", error?.message ?? "unknown");
  process.exitCode = 1;
}
