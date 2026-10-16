import assert from "node:assert/strict";
import test from "node:test";
import { scsTestSourceLinks } from "../src/shared/security/scs-reference-links";

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
