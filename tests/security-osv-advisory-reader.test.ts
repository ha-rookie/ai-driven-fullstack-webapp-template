import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import inventory from "../config/security-runtime-dependency-inventory.json";
import { createRuntimeOsvReader, createRuntimeOsvFindingReader, type RuntimeOsvResult } from "../src/worker/administration/security-osv-advisory-reader";

const AS_OF = "2026-10-17T01:00:00.000Z";
const sample = () => ({ results: inventory.packages.map(() => ({})) });
const fetcher = (payload: unknown, capture?: (url: string, init?: RequestInit) => void): typeof fetch =>
  (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capture?.(String(url), init);
    return Response.json(payload);
  }) as typeof fetch;

test("#420 OSV inventory lists precisely all non-dev/non-optional locked production packages", () => {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    lockfileVersion: number; packages: Record<string, {
      version?: string; dev?: boolean; devOptional?: boolean; optional?: boolean
    }>;
  };
  assert.equal(lock.lockfileVersion, 3);
  const expected = Object.entries(lock.packages)
    .filter(([path, item]) => path.startsWith("node_modules/")
      && !item.dev && !item.devOptional && !item.optional)
    .map(([path, item]) => ({ path, version: item.version }));
  assert.equal(expected.length, 12);
  assert.deepEqual(inventory.packages.map(({ path, version }) => ({ path, version })), expected);
  assert.equal(new Set(inventory.packages.map(item => item.ref)).size, 12);
  for (const item of inventory.packages) {
    const name = item.path.split("/node_modules/").at(-1)?.replace(/^node_modules\//u, "");
    assert.equal(item.name, name);
  }
});

test("#420 OSV querybatch uses one fixed public endpoint and all 12 reviewed versions", async () => {
  let called = 0;
  const reader = createRuntimeOsvReader(fetcher(sample(), (url, init) => {
    called++;
    assert.equal(url, "https://api.osv.dev/v1/querybatch");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    const sent = JSON.parse(String(init?.body)) as {
      queries: Array<{ package: { name: string; ecosystem: string }; version: string }>;
    };
    assert.deepEqual(sent.queries, inventory.packages.map(item => ({
      version: item.version, package: { name: item.name, ecosystem: "npm" },
    })));
  }));
  const result = await reader("preview", AS_OF);
  assert.deepEqual(result, {
    schemaVersion: 1, scope: "runtime-lock-only", source: "OSV",
    state: "verified", checkedAt: AS_OF, checkedPackages: 12,
    advisoryCount: 0, advisories: [],
  });
  assert.equal(called, 1);
  assert.deepEqual(await reader("preview", "2026-10-17T01:00:01.000Z"), result);
  assert.equal(called, 1, "cache reuses actual check time; it is not a new scan");
});

test("#420 only matched real OSV identifiers and reviewed package refs survive projection", async () => {
  const data = sample();
  data.results[0] = { vulns: [
    { id: "GHSA-vqj2-4v8m-8vrq", modified: "2026-10-16T21:00:00Z" },
  ] } as never;
  data.results[6] = { vulns: [
    { id: "CVE-2026-12345", modified: "2026-10-16T21:00:00Z" },
  ] } as never;
  const result = await createRuntimeOsvReader(fetcher(data))("preview", AS_OF);
  assert.equal(result.state, "verified");
  if (result.state !== "verified") throw Error("expected synthetic verified scan");
  assert.equal(result.checkedPackages, 12);
  assert.deepEqual(result.advisories, [
    { packageRef: "pkg_01", advisoryId: "GHSA-vqj2-4v8m-8vrq" },
    { packageRef: "pkg_07", advisoryId: "CVE-2026-12345" },
  ]);
});

test("#420 fail closed for malformed, partial, paginated, duplicate, or injected OSV advisories", async () => {
  const base = sample();
  const cases: unknown[] = [
    { results: [{}] },
    { results: Array.from({length: 13}, () => ({})) },
    { results: Array.from({length: 12}, (_, i) => i === 0 ? { next_page_token: "next" } : {}) },
    { results: Array.from({length: 12}, (_, i) => i === 0 ? { vulns: [
      {id:"GHSA-vqj2-4v8m-8vrq",modified:"2026-10-16T21:00:00Z"},
      {id:"GHSA-vqj2-4v8m-8vrq",modified:"2026-10-16T21:00:00Z"}] } : {}) },
    { results: Array.from({length: 12}, (_, i) => i === 0
      ? { vulns: [{ id: "https://evil.test/token", modified: "2026-10-16T21:00:00Z" }] } : {}) },
    { results: Array.from({length: 12}, (_, i) => i === 0 ? { vulns: [
      { id: "GHSA-vqj2-4v8m-8vrq", modified: "not-a-time" }] } : {}) },
    { ...base, results: Array.from({length: 12}, (_, i) => i === 0
      ? { vulns: [], extra: "provider raw content" } : {}) },
    { results: Array.from({length: 12}, (_, i) => i === 0 ? { vulns:
      Array.from({length: 65}, () => ({id:"GHSA-vqj2-4v8m-8vrq",modified:"2026-10-16T21:00:00Z"})) } : {}) },
  ];
  for (const value of cases) {
    const outcome = await createRuntimeOsvReader(fetcher(value))("preview", AS_OF);
    assert.deepEqual(outcome, {
      schemaVersion: 1, scope: "runtime-lock-only", source: "OSV",
      state: "unavailable", checkedAt: null, checkedPackages: null,
      advisoryCount: null, advisories: null,
    });
  }
});

test("#420 provider failure, non-JSON, oversized bodies or offline runtime never become zero", async () => {
  let calls = 0;
  const neverCall = (async () => { calls++; throw Error("must stay offline"); }) as typeof fetch;
  const offline = createRuntimeOsvReader(neverCall);
  for (const env of ["local", "test"] as const) {
    const result = await offline(env, AS_OF);
    assert.equal(result.state, "unavailable");
    assert.equal(result.advisoryCount, null);
  }
  assert.equal(calls, 0);
  for (const response of [
    new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
    Response.json({ raw: "private upstream data" }, { status: 503 }),
    Response.json({ results: Array.from({length: 12}, () => ({raw:"x".repeat(15000)})) }),
  ]) {
    const reader = createRuntimeOsvReader((async () => response.clone()) as typeof fetch);
    const outcome = await reader("preview", AS_OF);
    assert.equal(outcome.state, "unavailable");
    assert.equal(outcome.advisoryCount, null);
    assert.equal(JSON.stringify(outcome).includes("private upstream data"), false);
  }
  const failed = await createRuntimeOsvReader(
    (async () => { throw Error("provider token details must not leak"); }) as typeof fetch,
  )("preview", AS_OF);
  assert.equal(failed.state, "unavailable");
  assert.equal(JSON.stringify(failed).includes("token"), false);
});

const baseOsv = (advisories: Array<{ packageRef: string; advisoryId: string }>): RuntimeOsvResult => ({
  schemaVersion: 1, scope: "runtime-lock-only", source: "OSV",
  state: "verified", checkedAt: AS_OF, checkedPackages: 12,
  advisoryCount: advisories.length, advisories,
});
const record = (overrides: Record<string, unknown> = {}) => ({
  id: "GHSA-vqj2-4v8m-8vrq", modified: "2026-10-16T22:00:00Z",
  affected: [{ package: { ecosystem: "npm", name: "react" } }],
  database_specific: { severity: "HIGH" }, ...overrides,
});
const oneAdvisory = () => baseOsv([{ packageRef: "pkg_08", advisoryId: "GHSA-vqj2-4v8m-8vrq" }]);

test("#420 a real source-scoped OSV Finding requires exact advisory ID, npm package and source severity", async () => {
  let calls = 0; let advisoryQueries = 0;
  const reader = createRuntimeOsvFindingReader(async () => { advisoryQueries++; return oneAdvisory(); },
    (async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.osv.dev/v1/vulns/GHSA-vqj2-4v8m-8vrq");
      assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("authorization"), false); assert.equal(headers.has("cookie"), false);
      return Response.json(record({ summary: "<script>untrusted provider detail</script>" }));
    }) as typeof fetch);
  const output = await reader("preview", AS_OF);
  assert.equal(calls, 1); assert.equal(advisoryQueries, 1);
  assert.equal(output.state, "verified");
  if (output.state !== "verified" || output.findings.state !== "verified") throw Error("expected source verification");
  assert.equal(output.coverage.sourceId, "dependency_audit");
  assert.equal(output.coverage.freshness, "current");
  assert.equal(output.coverage.checkedFindingCount, 1);
  const finding = output.findings.items[0];
  assert.equal(finding.ruleId, "osv_ghsa_vqj2_4v8m_8vrq");
  assert.equal(finding.resourceRef, "pkg_08");
  assert.equal(finding.severity, "high");
  assert.equal(finding.status, "open");
  assert.equal(finding.category, "dependency");
  assert.equal(finding.evidence[0].referenceId, "pkg_08_ghsa_vqj2_4v8m_8vrq");
  assert.equal(finding.remediationCode, "update_dependency");
  assert.doesNotMatch(JSON.stringify(output), /script|summary|raw|description/u);
});

test("#420 OSV Finding zero is strictly for a fully checked reviewed 12-package lock scope", async () => {
  let calls = 0;
  const reader = createRuntimeOsvFindingReader(async () => baseOsv([]),
    (async () => { calls++; throw Error("OSV details must not be fetched for zero advisories"); }) as typeof fetch);
  const data = await reader("preview", AS_OF);
  assert.equal(data.state, "verified");
  if (data.state !== "verified" || data.findings.state !== "verified") throw Error("expected known scoped zero");
  assert.equal(data.checkedPackages, 12);
  assert.equal(data.coverage.checkedFindingCount, 0);
  assert.equal(data.findings.verifiedCount, 0);
  assert.equal(calls, 0);
});

test("#420 OSV source severity missing/malformed, withdrawn, wrong package or identity => unknown not fake low", async () => {
  for (const partial of [
    { database_specific: {} },
    { database_specific: { severity: "UNKNOWN" } },
    { database_specific: { severity: "INFO" } },
    { database_specific: { severity: "LOW", raw: "sensitive token" }, id: "GHSA-other-other-other" },
    { withdrawn: "2026-10-16T12:00:00Z" },
    { affected: [{ package: { ecosystem: "npm", name: "unrelated" } }] },
    { affected: [] },
    { modified: "2099-01-01T00:00:00Z" },
    { modified: "bad date" },
  ]) {
    const fetcher = (async () => Response.json(record(partial))) as typeof fetch;
    const result = await createRuntimeOsvFindingReader(async () => oneAdvisory(), fetcher)("preview", AS_OF);
    assert.equal(result.state, "unavailable", JSON.stringify(partial));
    assert.equal(result.findings, null);
    assert.equal(JSON.stringify(result).includes("sensitive token"), false);
  }
});

test("#420 OSV Finding detail reader is bounded and fail-closed for offline, partial and oversized cases", async () => {
  let requests = 0;
  const fetcher = (async () => { requests++; return Response.json(record()); }) as typeof fetch;
  const reader = createRuntimeOsvFindingReader(async () => { requests++; return oneAdvisory(); }, fetcher);
  for (const env of ["local", "test"] as const) {
    const r = await reader(env, AS_OF);
    assert.equal(r.state, "unavailable");
  }
  assert.equal(requests, 0);
  for (const advisory of [
    { ...oneAdvisory(), checkedPackages: 11 },
    { ...oneAdvisory(), advisoryCount: 2 },
    { ...oneAdvisory(), checkedAt: "2026-10-16T20:00:00.000Z" },
    baseOsv(Array.from({ length: 13 }, () => ({ packageRef: "pkg_08", advisoryId: "GHSA-vqj2-4v8m-8vrq" }))),
  ] as RuntimeOsvResult[]) {
    const r = await createRuntimeOsvFindingReader(async () => advisory, fetcher)("preview", AS_OF);
    assert.equal(r.state, "unavailable");
  }
  const huge = createRuntimeOsvFindingReader(async () => oneAdvisory(),
    (async () => Response.json({ ...record(), details: "x".repeat(140_000) })) as typeof fetch);
  assert.equal((await huge("preview", AS_OF)).state, "unavailable");
});
