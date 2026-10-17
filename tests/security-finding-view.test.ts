import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecurityFinding, normalizeSecuritySourceCoverage } from "../src/shared/security/security-finding";
import { assessFindingEvidence, assessFindingSourceLineage, getFindingTriageRoute, isSecurityFindingFeed, readVerifiedAuditRequestMatch, correlateFindingAuditResource, selectSecurityFindings } from "../src/shared/security/security-finding-view";

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

test("#420 genuine scoped D1 Audit lookup proves only persisted Request-ID existence, not remediation", () => {
  const now = "2026-10-17T01:00:00.000Z";
  const requestId = "CF-123.NRT";
  const realApiShape = {
    items: [{
      id: "d1-immutable-event-001", environment: "test", timestamp: "2026-10-17T00:10:00.000Z",
      requestId, category: "system", action: "security.review", outcome: "success",
      actorId: "fixture-admin", scopeId: "workhub-company", resourceType: "example",
      resourceId: "resource-1", reason: null,
    }],
    // Existing D1 viewer may return a cursor for the limit=1 first page.
    nextCursor: "opaque_cursor-for-more-pages",
  };
  const result = readVerifiedAuditRequestMatch(realApiShape, requestId, "workhub-company", now);
  assert.equal(result.state, "request-id-found");
  if (result.state !== "request-id-found") throw new Error("stored Audit Request-ID not found");
  assert.equal(result.record.environment, "test");
  assert.equal(result.record.timestamp, "2026-10-17T00:10:00.000Z");
  assert.equal(result.record.action, "security.review");
  assert.equal(result.record.outcome, "success");
  assert.equal("remediationVerified" in result.record, false);
  assert.equal("findingMatched" in result.record, false);
  const none = readVerifiedAuditRequestMatch(
    { items: [], nextCursor: null }, requestId, "workhub-company", now);
  assert.equal(none.state, "no-record");
});

test("#420 malformed, cross-scope, unsafe and future Audit responses fail closed", () => {
  const now = "2026-10-17T01:00:00.000Z";
  const requestId = "CF-123.NRT";
  const item = {
    id: "d1-event-001", environment: "test", timestamp: "2026-10-17T00:10:00.000Z",
    requestId, category: "system", action: "security.review", outcome: "success",
    actorId: "fixture-admin", scopeId: "workhub-company", resourceType: null,
    resourceId: null, reason: null,
  };
  const response = { items: [item], nextCursor: null };
  const read = (data: unknown = response, id = requestId, scope = "workhub-company") =>
    readVerifiedAuditRequestMatch(data, id, scope, now).state;
  assert.equal(read(), "request-id-found");
  const invalid = [
    { ...response, items: [{ ...item, requestId: "other-request" }] },
    { ...response, items: [{ ...item, scopeId: "another-company" }] },
    { ...response, items: [{ ...item, environment: "injected-prod" }] },
    { ...response, items: [{ ...item, timestamp: "2099-01-01T00:00:00.000Z" }] },
    { ...response, items: [{ ...item, timestamp: "not-a-date" }] },
    { ...response, items: [{ ...item, id: "unsafe/id" }] },
    { ...response, items: [{ ...item, action: "" }] },
    { ...response, items: [{ ...item, category: "hidden-category" }] },
    { ...response, items: [{ ...item, outcome: "remediated" }] },
    { ...response, items: [{ ...item, evidenceHtml: "<script>alert(1)</script>" }] },
    { ...response, items: [item, item] },
    { items: [], nextCursor: "unexpected-next-page" },
    { ...response, nextCursor: 123 },
    { ...response, extra: true },
    null,
  ];
  for (const entry of invalid) assert.equal(read(entry), "invalid");
  assert.equal(read(response, "ghp_sensitive"), "invalid");
  assert.equal(read(response, "https://other-site.test"), "invalid");
  assert.equal(read(response, requestId, "other-company"), "invalid");
});

test("#488 source declared unknown freshness does not become current solely because TTL is in future", () => {
  const known = source("secret_detection", 1);
  const declaredUnknown = { ...known, freshness: "unknown" as const };
  const now = "2026-10-16T12:10:00.000Z";
  assert.equal(assessFindingEvidence(first, [declaredUnknown], now).state, "unknown");
  assert.equal(assessFindingEvidence(first, [known], now).state, "current");
  assert.equal(assessFindingEvidence(first, [{ ...known, freshness: "stale" as const }], now).state, "stale");
});


test("#420 / #488 only a matching actual CI run and full SHA establishes per-Finding lineage", () => {
  const observedAt = "2026-10-16T11:59:00.000Z";
  const sha = "a".repeat(40);
  const checked = normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "checked",
    sourceHealth: "degraded", checkedFindingCount: 1,
    lastSuccessfulCheckAt: AS_OF,
    evidenceValidUntil: "2026-10-16T12:05:00.000Z",
  }, AS_OF);
  const ciSource = { ...checked, ci: { state: "available" as const, fetchedAt: AS_OF,
    latest: { runId: 1084, targetSha: sha, updatedAt: observedAt,
      checkStatus: "completed", checkConclusion: "failure" } } };
  const ciFinding = normalizeSecurityFinding({
    ruleId: "ci_step_failure", category: "data", severity: "high", status: "open",
    resourceRef: "commit_" + sha.slice(0, 12),
    detectedAt: observedAt, lastObservedAt: observedAt,
    evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_1084" }],
  }, "secret_detection", AS_OF);
  const current = assessFindingSourceLineage(ciFinding, [ciSource], AS_OF);
  assert.equal(current.relation, "ci-run-matched");
  assert.equal(current.sourceFreshness, "current");
  assert.equal(current.findingObservedAt, observedAt);
  assert.equal(current.ciTargetSha, sha);
  assert.equal(current.deployedCommitSha, null);
  assert.equal(current.scsEvidenceState, "unknown");
  const stale = assessFindingSourceLineage(ciFinding, [ciSource], "2026-10-16T12:05:00.000Z");
  assert.equal(stale.relation, "ci-run-matched");
  assert.equal(stale.sourceFreshness, "stale");
  for (const altered of [
    { ...ciFinding, resourceRef: "commit_" + "b".repeat(12) },
    { ...ciFinding, lastObservedAt: "2026-10-16T11:58:00.000Z" },
    { ...ciFinding, evidence: [{ kind: "ci" as const, code: "control_check_failed" as const, referenceId: "run_1085" }] },
  ]) {
    assert.equal(assessFindingSourceLineage(altered, [ciSource], AS_OF).relation, "unverified");
  }
  for (const changed of [
    { ...ciSource, ci: { ...ciSource.ci, latest: { ...ciSource.ci.latest, targetSha: "b".repeat(40) } } },
    { ...ciSource, ci: { ...ciSource.ci, latest: { ...ciSource.ci.latest, checkConclusion: "success" } } },
    { ...ciSource, ci: { ...ciSource.ci, latest: { ...ciSource.ci.latest, runId: 0 } } },
    { ...ciSource, ci: { ...ciSource.ci, latest: { ...ciSource.ci.latest, updatedAt: AS_OF } } },
    { ...ciSource, ci: { ...ciSource.ci, state: "unavailable" } },
  ]) assert.equal(assessFindingSourceLineage(ciFinding, [changed], AS_OF).relation, "unverified");
  assert.equal(assessFindingSourceLineage(ciFinding, [], AS_OF).relation, "unverified");
  assert.equal(assessFindingSourceLineage(ciFinding, [ciSource], "garbage").relation, "unverified");
});

test("#420 / #488 scoped OSV origin requires same reviewed source observation, not just source TTL", () => {
  const sourceTime = "2026-10-16T12:00:00.000Z";
  const checked = normalizeSecuritySourceCoverage({
    sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
    lastSuccessfulCheckAt: sourceTime, evidenceValidUntil: "2026-10-16T12:05:00.000Z",
    checkedFindingCount: 1,
  }, sourceTime);
  const osvFinding = normalizeSecurityFinding({
    ruleId: "osv_advisory_0", category: "dependency", severity: "info", status: "open",
    resourceRef: "pkg_01", detectedAt: sourceTime, lastObservedAt: sourceTime,
    evidence: [{ kind: "dependency", code: "dependency_alert" }],
  }, "dependency_audit", sourceTime);
  const verified = assessFindingSourceLineage(osvFinding, [checked], "2026-10-16T12:04:59.999Z");
  assert.equal(verified.relation, "osv-observation-matched");
  assert.equal(verified.sourceFreshness, "current");
  assert.equal(verified.findingObservedAt, sourceTime);
  assert.equal(verified.ciTargetSha, null);
  assert.equal(verified.deployedCommitSha, null);
  assert.equal(assessFindingSourceLineage(osvFinding, [checked], "2026-10-16T12:05:00.000Z").sourceFreshness, "stale");
  const otherTime = "2026-10-16T11:59:00.000Z";
  assert.equal(assessFindingSourceLineage({
    ...osvFinding, detectedAt: otherTime, lastObservedAt: otherTime,
  }, [checked], sourceTime).relation, "unverified");
  assert.equal(assessFindingSourceLineage({
    ...osvFinding, evidence: [{ kind: "ci", code: "control_check_failed" }],
  }, [checked], sourceTime).relation, "unverified");
  assert.equal(assessFindingSourceLineage({
    ...osvFinding, resourceRef: "pkg_99",
  }, [checked], sourceTime).relation, "unverified");
  assert.equal(assessFindingSourceLineage(osvFinding, [
    { ...checked, sourceHealth: "unavailable" },
  ], sourceTime).relation, "unverified");
  assert.equal(assessFindingSourceLineage(osvFinding, [
    { ...checked, freshness: "unknown" },
  ], sourceTime).relation, "unverified");
});


test("#420 remediation route binds only matched CI Run/SHA and refuses altered evidence", () => {
  const now = "2026-10-17T00:00:00.000Z", seen = "2026-10-16T23:59:00.000Z", sha = "a".repeat(40);
  const coverage = normalizeSecuritySourceCoverage({
    sourceId: "secret_detection", coverageState: "checked", sourceHealth: "degraded",
    checkedFindingCount: 1, lastSuccessfulCheckAt: now,
    evidenceValidUntil: "2026-10-17T00:05:00.000Z",
  }, now);
  const source = { ...coverage, ci: { state: "available", fetchedAt: now,
    latest: { runId: 8071, targetSha: sha, updatedAt: seen,
      checkStatus: "completed", checkConclusion: "failure" } } };
  const finding = normalizeSecurityFinding({
    ruleId: "ci_step_failure", category: "data", severity: "high", status: "open",
    resourceRef: "commit_" + sha.slice(0, 12), detectedAt: seen, lastObservedAt: seen,
    evidence: [{ kind: "ci", code: "control_check_failed", referenceId: "run_8071" }],
    remediationCode: "review_control",
  }, "secret_detection", now);
  const route = getFindingTriageRoute(finding, [source], now);
  assert.equal(route.state, "ci-run");
  assert.equal(route.href, "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/actions/runs/8071");
  assert.equal(route.remediationVerified, false);
  assert.equal(route.auditCorrelation, "not-recorded");
  assert.equal(getFindingTriageRoute(finding, [source], "2026-10-17T00:06:00.000Z").state, "ci-run");
  assert.equal(getFindingTriageRoute({ ...finding, resourceRef: "commit_" + "b".repeat(12) }, [source], now).href, null);
  assert.equal(getFindingTriageRoute({ ...finding, evidence: [{ kind: "ci", code: "control_check_failed",
    referenceId: "run_9090" }] }, [source], now).href, null);
  assert.equal(getFindingTriageRoute(finding, [{ ...source, ci: { ...source.ci,
    latest: { ...source.ci.latest, targetSha: "b".repeat(40) } } }], now).href, null);
  assert.equal(getFindingTriageRoute(finding, [], now).href, null);
});

test("#420 OSV remediation original link rejects cross-package, unsafe IDs and missing snapshot", () => {
  const at = "2026-10-17T00:00:00.000Z";
  const coverage = normalizeSecuritySourceCoverage({
    sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
    checkedFindingCount: 1, lastSuccessfulCheckAt: at,
    evidenceValidUntil: "2026-10-17T00:05:00.000Z",
  }, at);
  const finding = normalizeSecurityFinding({
    ruleId: "osv_advisory_0", category: "dependency", severity: "info", status: "open",
    resourceRef: "pkg_01", detectedAt: at, lastObservedAt: at,
    evidence: [{ kind: "dependency", code: "dependency_alert" }],
    remediationCode: "update_dependency",
  }, "dependency_audit", at);
  const data = [{ packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" }];
  const route = getFindingTriageRoute(finding, [coverage], at, data);
  assert.equal(route.state, "osv-advisory");
  assert.equal(route.href, "https://osv.dev/vulnerability/GHSA-aaaa-bbbb-cccc");
  assert.equal(route.remediationVerified, false);
  for (const bad of [
    [], [{ packageRef: "pkg_02", advisoryId: "GHSA-aaaa-bbbb-cccc" }],
    [{ packageRef: "pkg_01", advisoryId: "https://evil.invalid" }],
    [{ packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc?x=1" }],
    Array.from({ length: 65 }, () => data[0]),
  ]) assert.equal(getFindingTriageRoute(finding, [coverage], at, bad).href, null);
  assert.equal(getFindingTriageRoute({ ...finding, lastObservedAt: "2026-10-16T23:59:00.000Z" },
    [coverage], at, data).href, null);
  assert.equal(getFindingTriageRoute(finding, [], at, data).href, null);
});

test("#420 existing incident playbook and Audit request hint are not remediation proof", () => {
  const now = "2026-10-17T00:00:00.000Z";
  const finding = normalizeSecurityFinding({
    ruleId: "incident_1", category: "identity", severity: "high", status: "open",
    detectedAt: now, lastObservedAt: now, auditRequestId: "request_100",
    evidence: [{ kind: "runtime", code: "policy_violation" }],
    remediationCode: "investigate_incident",
  }, "secret_detection", now);
  const triage = getFindingTriageRoute(finding, [], now);
  assert.equal(triage.state, "incident-playbook");
  assert.equal(triage.auditCorrelation, "lookup-required");
  assert.equal(triage.remediationVerified, false);
  assert.equal(triage.href, "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/docs/security/SECURITY_INCIDENT_RESPONSE.md");
  assert.equal(getFindingTriageRoute({ ...finding, remediationCode: undefined }, [], now).href, null);
});


test("#420 persisted scoped Audit matches the same resource mutation, not just request ID", () => {
  const now = "2026-10-17T01:00:00.000Z";
  const requestId = "req-420-resource";
  const finding = normalizeSecurityFinding({
    ruleId: "resource_review", category: "identity", severity: "high", status: "open",
    resourceRef: "account-007",
    detectedAt: "2026-10-17T00:10:00.000Z",
    lastObservedAt: "2026-10-17T00:11:00.000Z",
    evidence: [{ kind: "runtime", code: "policy_violation" }],
    remediationCode: "review_access", auditRequestId: requestId,
  }, "secret_detection", now);
  const event = {
    id: "event-420", environment: "test", timestamp: "2026-10-17T00:15:00.000Z",
    requestId, category: "mutation", action: "membership.update", outcome: "success",
    actorId: "fixture-admin", scopeId: "workhub-company",
    resourceType: "user", resourceId: "account-007", reason: null,
  };
  const proof = readVerifiedAuditRequestMatch(
    { items: [event], nextCursor: null }, requestId, "workhub-company", now);
  assert.equal(proof.state, "request-id-found");
  assert.equal(correlateFindingAuditResource(finding, proof, now), "same-resource-successful-mutation");
  assert.equal(correlateFindingAuditResource({ ...finding, resourceRef: "other-account" }, proof, now), "request-id-only");
  assert.equal(correlateFindingAuditResource({ ...finding, auditRequestId: "another-request" }, proof, now), "request-id-only");
  assert.equal(correlateFindingAuditResource({ ...finding, remediationCode: undefined }, proof, now), "request-id-only");
  assert.equal(correlateFindingAuditResource({ ...finding, auditRequestId: undefined }, proof, now), "not-recorded");
  assert.equal(correlateFindingAuditResource(finding, { state: "no-record" }, now), "request-id-only");
  assert.equal(correlateFindingAuditResource(finding, proof, "invalid"), "request-id-only");
  assert.equal(correlateFindingAuditResource(finding, proof, "2026-10-17T00:12:00.000Z"), "request-id-only");
  for (const changed of [
    { category: "system" }, { outcome: "failure" },
    { resourceId: "another-account" }, { resourceType: null },
    { timestamp: "2026-10-17T00:05:00.000Z" },
  ]) {
    const badProof = readVerifiedAuditRequestMatch(
      { items: [{ ...event, ...changed }], nextCursor: null },
      requestId, "workhub-company", now);
    assert.equal(correlateFindingAuditResource(finding, badProof, now), "request-id-only");
  }
});
