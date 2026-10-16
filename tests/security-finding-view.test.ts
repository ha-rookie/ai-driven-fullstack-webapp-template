import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecurityFinding, normalizeSecuritySourceCoverage } from "../src/shared/security/security-finding";
import { isSecurityFindingFeed, selectSecurityFindings } from "../src/shared/security/security-finding-view";

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
