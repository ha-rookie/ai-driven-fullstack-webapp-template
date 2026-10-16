import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSecuritySourceSnapshot } from "../src/shared/security/security-source-snapshot";

const sha = "a".repeat(40);
const wrongSha = "b".repeat(40);
const asOf = "2026-10-16T12:00:00.000Z";
const observed = "2026-10-16T10:00:00.000Z";
const validUntil = "2026-10-17T10:00:00.000Z";
const earlier = "2026-10-16T11:00:00.000Z";

const secretCheck = () => ({
  sourceId: "secret_detection",
  sourceKind: "secret-detection",
  checkId: "scan-secrets",
  targetSha: sha,
  observedAt: observed,
  checkStatus: "completed",
  checkConclusion: "success",
  runId: 12345,
});
const dependencyCheck = () => ({
  sourceId: "dependency_audit",
  sourceKind: "dependency-audit",
  checkId: "audit-dependencies",
  targetSha: sha,
  observedAt: observed,
  checkStatus: "completed",
  checkConclusion: "success",
  runId: 23456,
});
const verified = () => ({
  evidenceRefId: "structured_report_1",
  verifiedAt: observed,
  evidenceValidUntil: validUntil,
  checkedFindingCount: 0,
});

// A successful job is only evidence of check execution, not the absence of vulnerabilities.
test("two CI source formats preserve provenance but never invent zero findings", () => {
  for (const input of [secretCheck(), dependencyCheck()]) {
    const result = normalizeSecuritySourceSnapshot(input, sha, asOf);
    assert.equal(result.sourceId, input.sourceId);
    assert.equal(result.checkId, input.checkId);
    assert.equal(result.targetSha, sha);
    assert.equal(result.runId, input.runId);
    assert.equal(result.checkStatus, "completed");
    assert.equal(result.checkConclusion, "success");
    assert.equal(result.coverage.coverageState, "not-checked");
    assert.equal(result.coverage.checkedFindingCount, null);
    assert.equal(result.coverage.freshness, "unknown");
    assert.equal("isSecure" in result, false);
    assert.equal("severity" in result, false);
    assert.equal("scsStatus" in result, false);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.coverage));
  }
});

test("only separately verified structured finding results may establish a bounded zero", () => {
  const result = normalizeSecuritySourceSnapshot({
    ...secretCheck(), verifiedFindings: verified(),
  }, sha, asOf);
  assert.equal(result.coverage.coverageState, "checked");
  assert.equal(result.coverage.checkedFindingCount, 0);
  assert.equal(result.coverage.freshness, "current");
  assert.equal(result.coverage.lastSuccessfulCheckAt, observed);
  assert.equal(result.verifiedFindings?.evidenceRefId, "structured_report_1");
  assert.ok(Object.isFrozen(result.verifiedFindings));
  assert.equal("isSecure" in result, false);
});

test("stale verified evidence never becomes current, including a checked zero", () => {
  const result = normalizeSecuritySourceSnapshot({
    ...dependencyCheck(), verifiedFindings: { ...verified(), evidenceValidUntil: earlier },
  }, sha, asOf);
  assert.equal(result.coverage.checkedFindingCount, 0);
  assert.equal(result.coverage.coverageState, "checked");
  assert.equal(result.coverage.freshness, "stale");
});

test("skipped, pending and missing sources are not checked", () => {
  const missing = normalizeSecuritySourceSnapshot({
    ...secretCheck(), checkStatus: "not-run", checkConclusion: undefined, runId: undefined,
  }, sha, asOf);
  assert.equal(missing.coverage.coverageState, "not-checked");
  assert.equal(missing.coverage.checkedFindingCount, null);
  const queued = normalizeSecuritySourceSnapshot({
    ...secretCheck(), checkStatus: "queued", checkConclusion: undefined, runId: undefined,
  }, sha, asOf);
  assert.equal(queued.coverage.coverageState, "not-checked");
  const skipped = normalizeSecuritySourceSnapshot({
    ...secretCheck(), checkConclusion: "skipped",
  }, sha, asOf);
  assert.equal(skipped.coverage.coverageState, "not-checked");
  assert.equal(skipped.coverage.checkedFindingCount, null);
});

test("unavailable and failed security source cannot claim zero or current freshness", () => {
  for (const input of [
    { ...secretCheck(), checkStatus: "unavailable", checkConclusion: undefined, runId: undefined },
    { ...dependencyCheck(), checkConclusion: "failure" },
    { ...dependencyCheck(), checkConclusion: "timed-out" },
  ]) {
    const result = normalizeSecuritySourceSnapshot(input, sha, asOf);
    assert.equal(result.coverage.coverageState, "unavailable");
    assert.equal(result.coverage.checkedFindingCount, null);
    assert.equal(result.coverage.freshness, "unknown");
  }
});

test("wrong and malformed SHA are rejected even on successful jobs", () => {
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), targetSha: wrongSha }, sha, asOf), /requested HEAD/u);
  assert.throws(() => normalizeSecuritySourceSnapshot(secretCheck(), "short", asOf), /lowercase SHA/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), targetSha: sha.toUpperCase() }, sha, asOf), /lowercase SHA/u);
});

test("unknown source/status/conclusion and incoherent check lifecycle fail closed", () => {
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), sourceKind: "new-scanner" }, sha, asOf), /unknown enum/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkStatus: "pass" }, sha, asOf), /unknown enum/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkConclusion: "secure" }, sha, asOf), /unknown enum/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkStatus: "queued" }, sha, asOf), /exactly for completed/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkConclusion: undefined }, sha, asOf), /exactly for completed/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), runId: 0 }, sha, asOf), /positive safe integer/u);
});

test("false verification cannot be attached to non-success or missing run evidence", () => {
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkConclusion: "failure", verifiedFindings: verified() }, sha, asOf), /completed successful run/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), runId: undefined, verifiedFindings: verified() }, sha, asOf), /completed successful run/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), checkConclusion: "skipped", verifiedFindings: verified() }, sha, asOf), /completed successful run/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), checkedFindingCount: -1 } }, sha, asOf), /nonnegative safe integer/u);
});

test("future, malformed and inconsistent observations are rejected", () => {
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), observedAt: "2026-10-17T00:00:00.000Z" }, sha, asOf), /future source observation/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), observedAt: "2026-10-16" }, sha, asOf), /canonical UTC/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), verifiedAt: validUntil } }, sha, asOf), /evidence timeline invalid/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), evidenceValidUntil: "2026-10-15T00:00:00.000Z" } }, sha, asOf), /evidence timeline invalid/u);
});

test("arbitrary raw payload, secret-like identifiers and accessors are rejected", () => {
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), token: "private" }, sha, asOf), /raw or unsupported field/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), message: "unsafe log details" }, sha, asOf), /raw or unsupported field/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), sourceId: "ghp_hidden" }, sha, asOf), /unsafe opaque identifier/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), rawLog: "secret" } }, sha, asOf), /raw or unsupported field/u);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), evidenceRefId: "https://example.invalid/log" } }, sha, asOf), /unsafe opaque identifier/u);
  const accessor = Object.defineProperty({ ...secretCheck() }, "token", { get() { throw Error("getter invoked"); } });
  assert.throws(() => normalizeSecuritySourceSnapshot(accessor, sha, asOf), /raw or unsupported field/u);
});

test("verification metadata is bounded and cannot stand in for SCS or severity", () => {
  const result = normalizeSecuritySourceSnapshot({ ...dependencyCheck(), verifiedFindings: { ...verified(), checkedFindingCount: 4 } }, sha, asOf);
  assert.equal(result.coverage.checkedFindingCount, 4);
  assert.equal("securityScore" in result, false);
  assert.equal("scsRequirement" in result, false);
  assert.equal("findingStatus" in result, false);
  assert.throws(() => normalizeSecuritySourceSnapshot({ ...secretCheck(), verifiedFindings: { ...verified(), severity: "critical" } }, sha, asOf), /raw or unsupported field/u);
});
