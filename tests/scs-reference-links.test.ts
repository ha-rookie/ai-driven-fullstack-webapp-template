import assert from "node:assert/strict";
import test from "node:test";
import { scsTestSourceLinks, scsOsvTechnicalEvidenceTrace, scsRequirementEvidencePath } from "../src/shared/security/scs-reference-links";

const REPO = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/";

test("#420 SCS requirement's registered tests resolve to bounded source links, never execution evidence", () => {
  const links = scsTestSourceLinks("scripts/generate-sbom.mjs; scripts/validate-lockfile-integrity.mjs");
  assert.deepEqual(links, [
    { path: "scripts/generate-sbom.mjs", href: REPO + "scripts/generate-sbom.mjs" },
    { path: "scripts/validate-lockfile-integrity.mjs", href: REPO + "scripts/validate-lockfile-integrity.mjs" },
  ]);
  assert.deepEqual(scsTestSourceLinks(".github/workflows/dependency-vulnerability.yml"),
    [{ path: ".github/workflows/dependency-vulnerability.yml",
      href: REPO + ".github/workflows/dependency-vulnerability.yml" }]);
  assert.deepEqual(scsTestSourceLinks("tests/admin-api.test.ts"),
    [{ path: "tests/admin-api.test.ts", href: REPO + "tests/admin-api.test.ts" }]);
  assert.equal("passed" in links[0], false);
  assert.equal("freshness" in links[0], false);
});

test("#420 SCS organizational responsibility and missing test references do not invent links", () => {
  for (const field of ["", "  ", null, undefined, 5, [], "Full-stack template CI"]) {
    assert.deepEqual(scsTestSourceLinks(field), []);
  }
});

test("#420 malicious or unverified references fail closed without partial links", () => {
  const unsafe = [
    "https://example.com/evil.test.ts", "javascript:alert(1)", "//example.test",
    "tests/../private.test.ts", "tests/%2e%2e/secret.test.ts",
    "tests/admin-api.test.ts?token=x", "tests/admin-api.test.ts#fragment",
    "tests/../../scripts/generate-sbom.mjs", "scripts/redirect.js",
    "config/scs-control-mapping.json", "tests/foo.test.ts; https://evil.test",
    "tests/a.test.ts; tests/a.test.ts", "tests/missing.test.ts;",
    Array(10).fill("tests/a.test.ts").join("; "), "a".repeat(1025),
    "tests/secret.test.ts\\other", "tests/admin-api.test.ts\n",
  ];
  for (const input of unsafe) assert.deepEqual(scsTestSourceLinks(input), [], JSON.stringify(input));
});

test("#420 all registered SCS test paths remain safely linkable without implying verification", async () => {
  const mapping = (await import("../config/scs-control-mapping.json")).default;
  const linked = mapping.requirements.filter(r => r.test);
  assert.equal(linked.length, 14);
  const all = linked.flatMap(r => scsTestSourceLinks(r.test));
  assert.equal(all.length > linked.length, true);
  assert.ok(linked.every(r => scsTestSourceLinks(r.test).length > 0));
  assert.equal(new Set(all.map(link => link.path)).size, 16);
  assert.ok(all.every(link => link.href.startsWith(REPO)));
});

test("#420 verified OSV observation traces only two reviewed partial SCS requirements without compliance promotion", async () => {
  const mapping = (await import("../config/scs-control-mapping.json")).default;
  const snapshotAt = "2026-10-17T00:04:59.000Z";
  const checkedAt = "2026-10-17T00:00:00.000Z";
  const source = {
    sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
    checkedFindingCount: 2, lastSuccessfulCheckAt: checkedAt,
    evidenceValidUntil: "2026-10-17T00:05:00.000Z",
  };
  const observation = { state: "verified" as const, checkedAt, checkedPackages: 12,
    advisoryCount: 2, advisories: [
      { packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" },
      { packageRef: "pkg_01", advisoryId: "CVE-2026-12345" },
    ] };
  const traced = mapping.requirements.flatMap(requirement => {
    const row = { id: requirement.id, responsibility: requirement.status, evidenceReference: requirement.evidence };
    const result = scsOsvTechnicalEvidenceTrace(row, source, observation, snapshotAt, snapshotAt);
    return result ? [{ requirementId: requirement.id, ...result }] : [];
  });
  assert.deepEqual(traced.map(row => row.requirementId).sort(), ["3-2-1", "4-4-4"]);
  assert.ok(traced.every(row => row.freshness === "current"
    && row.scsEvidenceState === "unknown" && row.remediationVerified === false
    && row.auditCorrelationVerified === false && row.checkedPackages === 12
    && row.advisoryCount === 2 && row.checkedAt === checkedAt));
  // At the exact TTL the technical evidence is stale; SCS compliance stays unknown.
  const stale = scsOsvTechnicalEvidenceTrace(
    { id: "4-4-4", responsibility: "Partially Implemented", evidenceReference: "Lockfile integrity; Dependency vulnerability scan" },
    source, observation, snapshotAt,
    "2026-10-17T00:05:00.000Z");
  assert.equal(stale?.freshness, "stale");
  assert.equal(stale?.scsEvidenceState, "unknown");
  const zero = scsOsvTechnicalEvidenceTrace(
    { id: "3-2-1", responsibility: "Partially Implemented", evidenceReference: "Dependency vulnerability scan; SBOM generation" },
    { ...source, checkedFindingCount: 0 },
    { ...observation, advisoryCount: 0, advisories: [] },
    snapshotAt, snapshotAt);
  assert.equal(zero?.advisoryCount, 0);
  assert.equal(zero?.scsEvidenceState, "unknown");
});

test("#420 OSV SCS linkage fails closed on unverified sources, unrelated mapping, mismatched timestamps and malicious IDs", async () => {
  const mapping = (await import("../config/scs-control-mapping.json")).default;
  const fromMapping = mapping.requirements.find(r => r.id === "4-4-4")!;
  const req = { id: fromMapping.id, responsibility: fromMapping.status, evidenceReference: fromMapping.evidence };
  const checkedAt = "2026-10-17T00:00:00.000Z", snapshotAt = "2026-10-17T00:04:59.000Z";
  const source = { sourceId: "dependency_audit", coverageState: "checked", sourceHealth: "ready",
    checkedFindingCount: 1, lastSuccessfulCheckAt: checkedAt,
    evidenceValidUntil: "2026-10-17T00:05:00.000Z" };
  const observation = { state: "verified" as const, checkedAt, checkedPackages: 12,
    advisoryCount: 1, advisories: [{ packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" }] };
  const valid = scsOsvTechnicalEvidenceTrace(req, source, observation, snapshotAt, snapshotAt);
  assert.ok(valid);
  const deny = (r = req, s = source, o = observation, asOf = snapshotAt) =>
    scsOsvTechnicalEvidenceTrace(r, s, o, asOf, snapshotAt);
  assert.equal(deny({ ...req, id: "4-1-1" }), null);
  assert.equal(deny({ ...req, responsibility: "Organization Responsibility" }), null);
  assert.equal(deny({ ...req, evidenceReference: "Full-stack template CI" }), null);
  assert.equal(deny(req, { ...source, sourceId: "configuration_check" }), null);
  assert.equal(deny(req, { ...source, coverageState: "not-checked" }), null);
  assert.equal(deny(req, { ...source, sourceHealth: "unavailable" }), null);
  assert.equal(deny(req, { ...source, lastSuccessfulCheckAt: "2026-10-17T00:01:00.000Z" }), null);
  assert.equal(deny(req, { ...source, evidenceValidUntil: "2026-10-17T00:10:00.000Z" }), null);
  assert.equal(deny(req, { ...source, checkedFindingCount: 0 }), null);
  assert.equal(deny(req, source, { ...observation, checkedPackages: 11 }), null);
  assert.equal(deny(req, source, { ...observation, advisoryCount: 0 }), null);
  assert.equal(deny(req, source, { ...observation, advisories: [
    { packageRef: "pkg_01", advisoryId: "javascript:alert(1)" },
  ] }), null);
  assert.equal(deny(req, source, { ...observation, advisories: [
    { packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" },
    { packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" },
  ], advisoryCount: 2 }), null);
  assert.equal(deny(req, source, observation, "2026-10-17T00:05:00.000Z"), null);
  assert.equal(scsOsvTechnicalEvidenceTrace(req, source, observation, snapshotAt,
    "2026-10-16T23:59:59.000Z"), null);
});


test("#420 every one of 43 SCS requirements has an explicit fail-closed Evidence path", async () => {
  const mapping = (await import("../config/scs-control-mapping.json")).default;
  const withoutObservation = mapping.requirements.map(r => scsRequirementEvidencePath({
    id: r.id, responsibility: r.status, evidenceReference: r.evidence,
    testReference: r.test,
  }, null));
  assert.equal(withoutObservation.length, 43);
  assert.equal(new Set(withoutObservation.map(r => r.requirementId)).size, 43);
  assert.equal(withoutObservation.filter(r => r.state === "technical-observation").length, 0);
  assert.equal(withoutObservation.filter(r => r.state === "registered-reference-only").length, 14);
  assert.equal(withoutObservation.filter(r => r.state === "no-valid-test-reference").length, 29);
  assert.ok(withoutObservation.every(r => r.scsEvidenceState === "unknown"));
  const source = { sourceId: "dependency_audit", coverageState: "checked",
    sourceHealth: "ready", checkedFindingCount: 1,
    lastSuccessfulCheckAt: "2026-10-17T00:00:00.000Z",
    evidenceValidUntil: "2026-10-17T00:05:00.000Z" };
  const observed = { state: "verified" as const, checkedAt: "2026-10-17T00:00:00.000Z",
    checkedPackages: 12, advisoryCount: 1,
    advisories: [{ packageRef: "pkg_01", advisoryId: "GHSA-aaaa-bbbb-cccc" }] };
  const traced = mapping.requirements.map(r => {
    const requirement = { id: r.id, responsibility: r.status,
      evidenceReference: r.evidence, testReference: r.test };
    const scoped = scsOsvTechnicalEvidenceTrace(requirement, source, observed,
      "2026-10-17T00:04:00.000Z", "2026-10-17T00:04:00.000Z");
    return scsRequirementEvidencePath(requirement, scoped);
  });
  assert.deepEqual(traced.filter(r => r.state === "technical-observation")
    .map(r => r.requirementId).sort(), ["3-2-1", "4-4-4"]);
  assert.equal(traced.filter(r => r.state === "registered-reference-only").length, 12);
  assert.equal(traced.filter(r => r.state === "no-valid-test-reference").length, 29);
  assert.ok(traced.every(r => r.scsEvidenceState === "unknown"));
  assert.ok(traced.filter(r => r.state === "technical-observation")
    .every(r => r.technicalObservation?.scsEvidenceState === "unknown"));
});

test("#420 forged/unsafe technical paths never become SCS evidence", () => {
  const technical = {
    kind: "scoped-osv-technical-observation" as const,
    sourceId: "dependency_audit" as const,
    checkedPackages: 12 as const,
    checkedAt: "2026-10-17T00:00:00.000Z",
    validUntil: "2026-10-17T00:05:00.000Z",
    freshness: "current" as const, advisoryCount: 0, advisories: [],
    scsEvidenceState: "unknown" as const,
    remediationVerified: false as const, auditCorrelationVerified: false as const,
  };
  const good = { id: "4-4-4", responsibility: "Partially Implemented",
    evidenceReference: "Dependency vulnerability scan",
    testReference: ".github/workflows/dependency-vulnerability.yml" };
  assert.equal(scsRequirementEvidencePath(good, technical).state, "technical-observation");
  assert.equal(scsRequirementEvidencePath({ ...good, id: "4-1-1" }, technical).state, "registered-reference-only");
  assert.equal(scsRequirementEvidencePath({ ...good, responsibility: "Organization Responsibility" }, technical).state,
    "registered-reference-only");
  assert.equal(scsRequirementEvidencePath({ ...good,
    testReference: "https://evil.example/scan.yml" }, technical).state, "no-valid-test-reference");
  assert.equal(scsRequirementEvidencePath({ ...good, evidenceReference: "Unverified CI" }, technical).state,
    "registered-reference-only");
  assert.equal(scsRequirementEvidencePath(good, { ...technical, scsEvidenceState: "current" } as never).state,
    "registered-reference-only");
});
