import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecurityFinding, normalizeSecuritySourceCoverage } from "../src/shared/security/security-finding";
import { assessFindingEvidence, isSecurityFindingFeed, selectSecurityFindings } from "../src/shared/security/security-finding-view";

const AS_OF = "2026-10-16T12:00:00.000Z";
const source = (sourceId: string, count: number) =>
  normalizeSecuritySourceCoverage({ sourceId, coverageState: "checked", sourceHealth: "ready",
    checkedFindingCount: count, lastSuccessfulCheckAt: "2026-10-16T11:00:00.000Z",
    evidenceValidUntil: "2026-10-16T15:00:00.000Z" }, AS_OF);
const finding = (ruleId: string, sourceId: string, severity: "high" | "low",
  status: "open" | "accepted-risk", category: "identity" | "dependency") =>
  normalizeSecurityFinding({
    ruleId, category, severity, status,
    detectedAt: "2026-10-16T09:00:00.000Z",
    lastObservedAt: "2026-10-16T10:00:00.000Z",
    evidence: [{ kind: "ci", code: "dependency_alert", referenceId: "evidence_one" }],
    remediationCode: "review_access",
    ...(status === "accepted-risk"
      ? { exception: { reasonCode: "mitigation_documented", approvalRef: "approval_one",
          expiresAt: "2026-10-16T11:00:00.000Z" } } : {}),
  }, sourceId, "2026-10-16T11:30:00.000Z");

const first = finding("rule_a", "secret_detection", "high", "open", "identity");
const second = finding("rule_b", "dependency_audit", "low", "accepted-risk", "dependency");
const checked = [source("secret_detection", 1), source("dependency_audit", 1)];

test("#420 not-connected findings stay null and never synthesize zero", () => {
  assert.equal(isSecurityFindingFeed({ state: "not-connected", items: null, verifiedCount: null }, checked, AS_OF), true);
  assert.equal(isSecurityFindingFeed({ state: "not-connected", items: [], verifiedCount: 0 }, checked, AS_OF), false);
  assert.equal(isSecurityFindingFeed({ state: "verified", items: [], verifiedCount: 0 }, [], AS_OF), false);
});

test("#420 contract-validated Finding view has distinct severity/category/status filters", () => {
  const feed = { state: "verified", items: [first, second], verifiedCount: 2 };
  assert.equal(isSecurityFindingFeed(feed, checked, AS_OF), true);
  assert.deepEqual(selectSecurityFindings(feed.items, { severity: "high", category: "all", status: "all" }), [first]);
  assert.deepEqual(selectSecurityFindings(feed.items, { severity: "all", category: "dependency", status: "all" }), [second]);
  assert.deepEqual(selectSecurityFindings(feed.items, { severity: "all", category: "all", status: "accepted-risk" }), [second]);
  assert.deepEqual(selectSecurityFindings(feed.items, { severity: "high", category: "dependency", status: "open" }), []);
  assert.equal(second.riskDisposition, "accepted-expired");
});

test("#420 verified feed is rejected when source, counts, duplicates or chronology are unsupported", () => {
  const feed = { state: "verified", items: [first, second], verifiedCount: 2 };
  for (const invalid of [
    { ...feed, verifiedCount: 0 },
    { ...feed, items: [first, first] },
    { ...feed, items: [{ ...first, sourceId: "unknown_source" }, second] },
    { ...feed, items: [{ ...first, assessedAt: "2099-10-16T11:30:00.000Z" }, second] },
    { ...feed, items: [{ ...first, riskDisposition: "accepted-current" }, second] },
    { ...feed, items: [{ ...first, evidence: [{ kind: "ci", code: "dependency_alert",
      referenceId: "ghp_secret_example" }] }, second] },
    { ...feed, items: [{ ...first, message: "<script>alert(1)</script>" }, second] },
    { ...feed, items: [{ ...first, evidence: [{ kind: "ci", code: "dependency_alert",
      referenceId: "evidence_one", url: "https://example.test/token" }] }, second] },
    { ...feed, items: [{ ...second, riskDisposition: "accepted-current" }, first] },
  ]) {
    assert.equal(isSecurityFindingFeed(invalid, checked, AS_OF), false);
  }
  assert.equal(isSecurityFindingFeed(feed, [source("secret_detection", 1)], AS_OF), false);
  assert.equal(isSecurityFindingFeed(feed, [source("secret_detection", 2), source("dependency_audit", 0)], AS_OF), false);
});

test("#420 never promotes unknown/stale/not-checked evidence into a trusted source", () => {
  const f = { state: "verified", items: [first], verifiedCount: 1 };
  assert.equal(isSecurityFindingFeed(f, [normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "not-checked", sourceHealth: "unmonitored",
  }, AS_OF)], AS_OF), false);
  assert.equal(isSecurityFindingFeed({ ...f, injected: "unsafe" }, [source("secret_detection", 1)], AS_OF), false);
  assert.equal(isSecurityFindingFeed({ state: "verified", items: [first],
    verifiedCount: 1 }, [source("secret_detection", 1)], AS_OF), true);
});


test("#420 only valid source-reviewed Finding Audit correlation survives UI boundary", () => {
  const valid = normalizeSecurityFinding({
    ruleId: "rule_a", category: "identity", severity: "high", status: "open",
    detectedAt: "2026-10-16T09:00:00.000Z", lastObservedAt: "2026-10-16T10:00:00.000Z",
    evidence: [{ kind: "ci", code: "dependency_alert", referenceId: "evidence_one" }],
    auditRequestId: "trace-xyz.NRT",
  }, "secret_detection", "2026-10-16T11:30:00.000Z");
  const coverage = [source("secret_detection", 1)];
  assert.equal(isSecurityFindingFeed({ state: "verified", items: [valid], verifiedCount: 1 },
    coverage, AS_OF), true);
  for (const wrong of ["ghp_bad_token", "https://evil.test", "trace xyz", "x".repeat(129)]) {
    const tampered = { state: "verified", items: [{ ...valid, auditRequestId: wrong }],
      verifiedCount: 1 };
    assert.equal(isSecurityFindingFeed(tampered, coverage, AS_OF), false);
  }
  assert.equal(isSecurityFindingFeed({ state: "verified", items: [{ ...valid, extraAudit: "evil" }],
    verifiedCount: 1 }, coverage, AS_OF), false);
});

test("#420 / #488 genuine source time is joined per Finding and expires without new provider data", () => {
  const now = "2026-10-16T12:10:00.000Z";
  const checkedSource = source("secret_detection", 1);
  const current = assessFindingEvidence(first, [checkedSource], now);
  assert.equal(current.state, "current");
  assert.equal(current.health, "ready");
  assert.equal(current.lastSuccessfulCheckAt, "2026-10-16T11:00:00.000Z");
  assert.equal(current.evidenceValidUntil, "2026-10-16T15:00:00.000Z");
  assert.equal(current.auditCorrelation, "not-recorded");
  assert.equal(current.remediation, "investigation-hint");
  const expired = assessFindingEvidence(first, [checkedSource], "2026-10-16T15:00:00.000Z");
  assert.equal(expired.state, "stale");
  assert.equal(expired.lastSuccessfulCheckAt, current.lastSuccessfulCheckAt);
  assert.equal(expired.evidenceValidUntil, current.evidenceValidUntil);
  assert.equal(assessFindingEvidence(first, [checkedSource], "2026-10-16T14:59:59.999Z").state, "current");
  assert.equal(assessFindingEvidence(first, [checkedSource], "2026-10-16T14:00:00.000Z").state, "current");
});

test("#420 / #488 source failure, missing TTL and unknown observation never become fresh", () => {
  const now = "2026-10-16T12:10:00.000Z";
  assert.equal(assessFindingEvidence(first, [], now).state, "unavailable");
  assert.equal(assessFindingEvidence(first, [source("dependency_audit", 1)], now).state, "unavailable");
  const unmonitored = normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "not-checked", sourceHealth: "unmonitored",
  }, AS_OF);
  assert.equal(assessFindingEvidence(first, [unmonitored], now).state, "unknown");
  const unavailable = normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "unavailable", sourceHealth: "unavailable",
  }, AS_OF);
  assert.equal(assessFindingEvidence(first, [unavailable], now).state, "unavailable");
  const noTtl = normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "checked", sourceHealth: "ready",
    lastSuccessfulCheckAt: "2026-10-16T11:00:00.000Z", checkedFindingCount: 1,
  }, AS_OF);
  assert.equal(assessFindingEvidence(first, [noTtl], now).state, "unknown");
  assert.equal(assessFindingEvidence(first, [source("secret_detection", 1)], "not-a-timestamp").state, "unknown");
  // Clock skew and stale server snapshots cannot justify current Evidence.
  assert.equal(assessFindingEvidence(first, [source("secret_detection", 1)], "2026-10-16T10:00:00.000Z").state, "unknown");
  const assessedStale = { ...source("secret_detection", 1), freshness: "stale" as const };
  assert.equal(assessFindingEvidence(first, [assessedStale], now).state, "stale");
});

test("#420 remediation and Audit ID are investigation hints until persisted Audit result is checked", () => {
  const audited = normalizeSecurityFinding({
    ruleId: "audit_hint", category: "identity", severity: "high", status: "open",
    detectedAt: "2026-10-16T09:00:00.000Z", lastObservedAt: "2026-10-16T10:00:00.000Z",
    evidence: [{ kind: "ci", code: "control_check_failed" }],
    remediationCode: "investigate_incident", auditRequestId: "req-actual-lookup-required",
  }, "secret_detection", AS_OF);
  const assessment = assessFindingEvidence(audited, [source("secret_detection", 1)], "2026-10-16T12:10:00.000Z");
  assert.equal(assessment.auditCorrelation, "lookup-required");
  assert.equal(assessment.remediation, "investigation-hint");
  assert.equal(assessment.state, "current");
  const withoutRemediation = normalizeSecurityFinding({
    ruleId: "no_action", category: "identity", severity: "low", status: "open",
    detectedAt: "2026-10-16T09:00:00.000Z", lastObservedAt: "2026-10-16T10:00:00.000Z",
    evidence: [{ kind: "ci", code: "control_check_failed" }],
  }, "secret_detection", AS_OF);
  const noAction = assessFindingEvidence(withoutRemediation, [], "2026-10-16T12:10:00.000Z");
  assert.equal(noAction.remediation, "not-recorded");
  assert.equal(noAction.auditCorrelation, "not-recorded");
  assert.equal(noAction.state, "unavailable");
});
