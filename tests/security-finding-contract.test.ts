import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSecurityFinding,
  normalizeSecurityFindingFromSource,
  normalizeSecuritySourceCoverage,
  type SecurityFindingAdapter,
} from "../src/shared/security/security-finding";

const detected = "2026-10-13T00:00:00.000Z";
const observed = "2026-10-14T00:00:00.000Z";
const assessed = "2026-10-16T00:00:00.000Z";
const later = "2026-10-20T00:00:00.000Z";
const earlier = "2026-10-15T00:00:00.000Z";

const finding = () => ({
  ruleId: "authz_guard_missing",
  category: "identity",
  severity: "high",
  status: "open",
  resourceRef: "endpoint_1",
  detectedAt: detected,
  lastObservedAt: observed,
  evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "ci_check_2" }],
  remediationCode: "review_control",
});

test("pure contract emits only declared bounded fields with provider provenance", () => {
  const raw = finding();
  const result = normalizeSecurityFinding(raw, "ci_pipeline", assessed);
  assert.deepEqual(result, {
    ruleId: "authz_guard_missing", sourceId: "ci_pipeline", category: "identity",
    severity: "high", status: "open", detectedAt: detected,
    lastObservedAt: observed, assessedAt: assessed, resourceRef: "endpoint_1",
    evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "ci_check_2" }],
    remediationCode: "review_control", riskDisposition: "none",
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.evidence));
  assert.deepEqual(raw, finding());
});

test("two synthetic source formats normalize to the same vendor-neutral contract", () => {
  const adapterA: SecurityFindingAdapter<{ rule: string; impact: string }> = {
    sourceId: "source_a",
    map: row => ({ ...finding(), ruleId: row.rule, severity: row.impact }),
  };
  const adapterB: SecurityFindingAdapter<{ checkId: string; riskLevel: string }> = {
    sourceId: "source_b",
    map: row => ({ ...finding(), ruleId: row.checkId, severity: row.riskLevel }),
  };
  const a = normalizeSecurityFindingFromSource(adapterA,
    { rule: "authz_guard_missing", impact: "high" }, assessed);
  const b = normalizeSecurityFindingFromSource(adapterB,
    { checkId: "authz_guard_missing", riskLevel: "high" }, assessed);
  assert.deepEqual({ ...a, sourceId: "same" }, { ...b, sourceId: "same" });
  assert.equal(a.sourceId, "source_a");
  assert.equal(b.sourceId, "source_b");
});

test("unknown fields, secret-like identifiers and raw evidence fail closed", () => {
  assert.throws(() => normalizeSecurityFinding({ ...finding(), token: "sensitive" },
    "ci_pipeline", assessed), /unknown or raw payload/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: [{ kind: "ci", code: "control_check_failed", message: "raw details" }],
  }, "ci_pipeline", assessed), /unknown or raw payload/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: [{ kind: "ci", code: "sk_live_sample" }],
  }, "ci_pipeline", assessed), /invalid enum code/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "ghp_badkey" }],
  }, "ci_pipeline", assessed), /invalid opaque identifier/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: [{ kind: "ci", code: "control_check_failed" }], resourceRef: "pii@example.com",
  }, "ci_pipeline", assessed), /invalid opaque identifier/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: Array.from({ length: 9 }, () => ({
      kind: "ci", code: "control_check_failed",
    })),
  }, "ci_pipeline", assessed), /one to eight/u);
});

test("unknown severity/status/category or invalid source evidence cannot be silently accepted", () => {
  for (const field of ["severity", "status", "category"] as const) {
    assert.throws(() => normalizeSecurityFinding({
      ...finding(), [field]: "unrecognized",
    }, "ci_pipeline", assessed), /invalid enum code/u);
  }
  assert.throws(() => normalizeSecurityFinding({ ...finding(), detectedAt: "2026-10-13" },
    "ci_pipeline", assessed), /canonical UTC/u);
  assert.throws(() => normalizeSecurityFinding({ ...finding(), lastObservedAt: later },
    "ci_pipeline", assessed), /chronology/u);
  assert.throws(() => normalizeSecurityFinding(finding(), "sk_live_not_source", assessed),
    /invalid opaque identifier/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), evidence: [],
  }, "ci_pipeline", assessed), /one to eight/u);
});

test("risk exceptions require an explicit expiry and expired acceptance is not current", () => {
  const raw = {
    ...finding(), status: "accepted-risk",
    exception: {
      reasonCode: "mitigation_documented",
      approvalRef: "approval_12",
      expiresAt: later,
    },
  };
  const current = normalizeSecurityFinding(raw, "ci_pipeline", assessed);
  assert.equal(current.riskDisposition, "accepted-current");
  assert.equal(current.exception?.approvalRef, "approval_12");
  const expired = normalizeSecurityFinding({
    ...raw, exception: { ...raw.exception, expiresAt: earlier },
  }, "ci_pipeline", assessed);
  assert.equal(expired.status, "accepted-risk");
  assert.equal(expired.riskDisposition, "accepted-expired");
  assert.throws(() => normalizeSecurityFinding({ ...finding(), status: "accepted-risk" },
    "ci_pipeline", assessed), /requires exactly one/u);
  assert.throws(() => normalizeSecurityFinding({
    ...finding(), exception: raw.exception,
  }, "ci_pipeline", assessed), /requires exactly one/u);
  assert.throws(() => normalizeSecurityFinding({
    ...raw, exception: { ...raw.exception, approvedByEmail: "private@example.com" },
  }, "ci_pipeline", assessed), /unknown or raw payload/u);
});

test("checked zero findings is distinct from unverified, unavailable and stale", () => {
  const checked = normalizeSecuritySourceCoverage({
    sourceId: "scanner_a", coverageState: "checked", sourceHealth: "ready",
    lastSuccessfulCheckAt: observed, evidenceValidUntil: later, checkedFindingCount: 0,
  }, assessed);
  assert.equal(checked.checkedFindingCount, 0);
  assert.equal(checked.freshness, "current");
  assert.equal("isSecure" in checked, false);
  const stale = normalizeSecuritySourceCoverage({
    sourceId: "scanner_a", coverageState: "checked", sourceHealth: "degraded",
    lastSuccessfulCheckAt: observed, evidenceValidUntil: earlier, checkedFindingCount: 0,
  }, assessed);
  assert.equal(stale.freshness, "stale");
  const unverified = normalizeSecuritySourceCoverage({
    sourceId: "scanner_a", coverageState: "not-checked", sourceHealth: "unmonitored",
  }, assessed);
  assert.equal(unverified.checkedFindingCount, null);
  assert.equal(unverified.freshness, "unknown");
  const unavailable = normalizeSecuritySourceCoverage({
    sourceId: "scanner_a", coverageState: "unavailable", sourceHealth: "unavailable",
    lastSuccessfulCheckAt: observed, evidenceValidUntil: later,
  }, assessed);
  assert.equal(unavailable.checkedFindingCount, null);
  assert.equal(unavailable.freshness, "unknown");
});

test("source state must be coherent and unavailable cannot pretend zero or healthy", () => {
  const base = { sourceId: "scanner_a", coverageState: "checked",
    sourceHealth: "ready", lastSuccessfulCheckAt: observed, checkedFindingCount: 0 };
  assert.equal(normalizeSecuritySourceCoverage(base, assessed).freshness, "unknown");
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, sourceHealth: "unavailable",
  }, assessed), /requires successful source evidence/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, coverageState: "not-checked",
  }, assessed), /must not report findings count/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, coverageState: "unavailable", sourceHealth: "unavailable",
  }, assessed), /must not report findings count/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, checkedFindingCount: -1,
  }, assessed), /requires successful source evidence/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, lastSuccessfulCheckAt: later,
  }, assessed), /in the future/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, evidenceValidUntil: detected,
  }, assessed), /invalid evidence freshness interval/u);
  assert.throws(() => normalizeSecuritySourceCoverage({
    ...base, unknown: "raw_scanner_payload",
  }, assessed), /unknown or raw payload/u);
});

test("not-applicable must declare a reason and cannot be counted as zero findings", () => {
  assert.deepEqual(normalizeSecuritySourceCoverage({
    sourceId: "scanner_b", coverageState: "not-applicable",
    sourceHealth: "unmonitored", notApplicableReasonCode: "outside_project_scope",
  }, assessed), {
    sourceId: "scanner_b", coverageState: "not-applicable",
    sourceHealth: "unmonitored", checkedFindingCount: null,
    notApplicableReasonCode: "outside_project_scope", freshness: "unknown",
  });
  assert.throws(() => normalizeSecuritySourceCoverage({
    sourceId: "scanner_b", coverageState: "not-applicable",
    sourceHealth: "unmonitored",
  }, assessed), /invalid enum code/u);
});


test("#420 audited request correlation is optional, bounded, and never a raw provider URL", () => {
  assert.equal(normalizeSecurityFinding({ ...finding(), auditRequestId: "abc123-NRT" },
    "ci_pipeline", assessed).auditRequestId, "abc123-NRT");
  assert.equal(normalizeSecurityFinding(finding(), "ci_pipeline", assessed).auditRequestId, undefined);
  for (const unsafe of [
    "", "request id with spaces", "request\nunsafe", "https://outside.example/test",
    "a".repeat(129), "ghp_secret_value", "github_pat_leak", "abc?query",
  ]) {
    assert.throws(() => normalizeSecurityFinding({ ...finding(), auditRequestId: unsafe },
      "ci_pipeline", assessed), /auditRequestId/u);
  }
  assert.throws(() => normalizeSecurityFinding({ ...finding(), auditRequestId: null },
    "ci_pipeline", assessed), /auditRequestId/u);
});
