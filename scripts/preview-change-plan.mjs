#!/usr/bin/env node
/**
 * Read-only Preview change plan. No Cloudflare, deployment, database, or
 * credential access. The caller must provide evidence of both the deployed
 * runtime SHA and the most recent successful fixture-seed SHA.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shaPattern = /^[a-f0-9]{40}$/u;

/**
 * Ignore only a proven test-only change to package.json. Every other package
 * field (dependencies, toolchain, exports, configs) and every non-test script
 * must be structurally identical. Unparseable/missing content fails closed.
 */
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const equivalent = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const testScript = /^(?:test(?::[a-zA-Z0-9:_-]+)?|validate:local(?::[a-zA-Z0-9:_-]+)?)$/u;

export const isTestOnlyPackageChange = (before, after) => {
  if (!before || !after || typeof before !== "object" || typeof after !== "object"
      || Array.isArray(before) || Array.isArray(after)) return false;
  const { scripts: oldScripts, ...oldRuntime } = before;
  const { scripts: newScripts, ...newRuntime } = after;
  if (!equivalent(oldRuntime, newRuntime)) return false;
  if (!oldScripts || !newScripts || typeof oldScripts !== "object" || typeof newScripts !== "object"
      || Array.isArray(oldScripts) || Array.isArray(newScripts)) return false;
  const names = new Set([...Object.keys(oldScripts), ...Object.keys(newScripts)]);
  const changed = [...names].filter(name => !equivalent(oldScripts[name], newScripts[name]));
  return changed.every(name => testScript.test(name));
};

export const packageDiffIsTestOnly = (base, target, cwd = process.cwd()) => {
  try {
    const show = sha => JSON.parse(execFileSync("git",
      ["-C", cwd, "show", sha + ":package.json"], { encoding: "utf8", maxBuffer: 1024 * 1024 }));
    return isTestOnlyPackageChange(show(base), show(target));
  } catch {
    return false; // missing/invalid JSON, absent manifest, git failure
  }
};

export const classifyPreviewPaths = (paths, options = {}) => {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { redeploy: false, reseed: false, seedReview: false, verifyBrowser: false };
  }
  const result = { redeploy: false, reseed: false, seedReview: false, verifyBrowser: false };
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
      return { redeploy: true, reseed: true, seedReview: true, verifyBrowser: true };
    }
    if (path === "package.json" && options.packageTestOnly === true) continue;
    // Fixtures, schema, and the scripts that write WORKHUB demo data.
    const seedData = /^migrations\//u.test(path)
      || /^scripts\/workhub-.*(?:\.sql|seed.*\.mjs)$/u.test(path)
      || /^src\/reference\/workhub\/.*(?:fixture|seed|demo-data)/iu.test(path)
      || path === ".github/workflows/preview-workhub-demo-fixture.yml";
    if (seedData) {
      result.reseed = true;
      result.redeploy ||= /^migrations\//u.test(path) || path.startsWith("src/");
      result.verifyBrowser = true;
      continue;
    }
    if (/^docs\/.*\.md$/u.test(path)
      || ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "LICENSE"].includes(path)
      || /^tests\//u.test(path)) {
      continue;
    }
    if (/^e2e\//u.test(path) || /^playwright(?:\.[^.]+)?\.config\.ts$/u.test(path)) {
      result.verifyBrowser = true;
      continue;
    }
    if (path === "scripts/ci-change-impact.mjs" || path === "scripts/preview-change-plan.mjs") {
      continue;
    }
    if (/^\.github\//u.test(path)) {
      // Workflow changes do not themselves alter the deployed application,
      // but changes to deployment/fixture operations deserve human review.
      if (/^\.github\/workflows\/preview-/u.test(path)) result.seedReview = true;
      continue;
    }
    if (/^scripts\//u.test(path)) result.seedReview = true;
    // All runtime, public assets, config, dependencies and UNKNOWN paths
    // require a Preview build/deployment rather than optimistic omission.
    result.redeploy = true;
    result.verifyBrowser = true;
  }
  return result;
};

const changedPaths = (from, to) => {
  for (const sha of [from, to]) {
    if (!shaPattern.test(sha || "")) throw new Error("Expected two full 40-character commit SHAs");
    execFileSync("git", ["cat-file", "-e", sha + "^{commit}"], { stdio: "pipe" });
  }
  // Reject divergent SHA comparisons; a merge/fork requires a new baseline.
  execFileSync("git", ["merge-base", "--is-ancestor", from, to], { stdio: "pipe" });
  return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", from, to, "--"], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }).split("\0").filter(Boolean);
};

export const planPreview = (runtimePaths, seedPaths = null, options = {}) => {
  const runtime = classifyPreviewPaths(runtimePaths, options);
  const seed = seedPaths === null ? null : classifyPreviewPaths(seedPaths);
  return {
    deploy: runtime.redeploy ? "required" : "skip",
    seed: seed === null ? "unverified"
      : seed.reseed ? "required"
        : seed.seedReview ? "review" : "skip",
    browser: runtime.verifyBrowser ? "recommended" : "skip",
    seedEvidenceKnown: seed !== null,
    note: "Read-only advisory. Never bypass Preview/Production Human Gates. Seed=unverified/review is not permission to write D1.",
  };
};

const selfTest = () => {
  const cases = [
    [["README.md", ".github/workflows/ci.yml"], { redeploy: false, reseed: false, seedReview: false, verifyBrowser: false }],
    [["e2e/preview/login.spec.ts"], { redeploy: false, reseed: false, seedReview: false, verifyBrowser: true }],
    [["src/App.tsx"], { redeploy: true, reseed: false, seedReview: false, verifyBrowser: true }],
    [["src/worker/auth.ts"], { redeploy: true, reseed: false, seedReview: false, verifyBrowser: true }],
    [["public/favicon.ico"], { redeploy: true, reseed: false, seedReview: false, verifyBrowser: true }],
    [["migrations/0016_demo.sql"], { redeploy: true, reseed: true, seedReview: false, verifyBrowser: true }],
    [["scripts/workhub-master-order-preview.sql"], { redeploy: false, reseed: true, seedReview: false, verifyBrowser: true }],
    [["scripts/workhub-demo-seed-preview.mjs"], { redeploy: false, reseed: true, seedReview: false, verifyBrowser: true }],
    [["src/reference/workhub/master/fixtures.ts"], { redeploy: true, reseed: true, seedReview: false, verifyBrowser: true }],
    [["scripts/unknown-data-migrator.mjs"], { redeploy: true, reseed: false, seedReview: true, verifyBrowser: true }],
    [[".github/workflows/preview-deploy.yml"], { redeploy: false, reseed: false, seedReview: true, verifyBrowser: false }],
    [["unknown.bin"], { redeploy: true, reseed: false, seedReview: false, verifyBrowser: true }],
    [["src/App.tsx", "docs/readme.md"], { redeploy: true, reseed: false, seedReview: false, verifyBrowser: true }],
    [[], { redeploy: false, reseed: false, seedReview: false, verifyBrowser: false }],
  ];
  for (const [paths, expected] of cases) assert.deepEqual(classifyPreviewPaths(paths), expected);
  assert.deepEqual(planPreview(["README.md"], ["docs/operations/guide.md"]), {
    deploy: "skip", seed: "skip", browser: "skip", seedEvidenceKnown: true,
    note: "Read-only advisory. Never bypass Preview/Production Human Gates. Seed=unverified/review is not permission to write D1.",
  });
  assert.equal(planPreview(["README.md"]).seed, "unverified");
  assert.equal(planPreview(["e2e/preview/login.spec.ts"], ["README.md"]).browser, "recommended");
  assert.equal(planPreview(["README.md"], ["scripts/unknown-data-migrator.mjs"]).seed, "review");
  const manifest = { name: "demo", scripts: { build: "vite build", test: "node old.js" },
    dependencies: { react: "1.0.0" } };
  const testOnly = { ...manifest, scripts: { ...manifest.scripts, test: "node new.js", "validate:local:core": "node test.js" } };
  assert.equal(isTestOnlyPackageChange(manifest, testOnly), true);
  assert.equal(isTestOnlyPackageChange(manifest, { ...testOnly, dependencies: { react: "2.0.0" } }), false);
  assert.equal(isTestOnlyPackageChange(manifest, { ...testOnly, scripts: { ...testOnly.scripts, build: "vite build --mode prod" } }), false);
  assert.equal(isTestOnlyPackageChange(manifest, { ...testOnly, scripts: { ...testOnly.scripts, postinstall: "node install.js" } }), false);
  assert.equal(isTestOnlyPackageChange(manifest, null), false);
  assert.equal(planPreview(["package.json"], null, { packageTestOnly: true }).deploy, "skip");
  assert.equal(planPreview(["package.json"]).deploy, "required");
  assert.equal(planPreview(["package.json", "src/App.tsx"], null, { packageTestOnly: true }).deploy, "required");

  // Rename must keep the DELETED source path, never just docs destination.
  const scratch = mkdtempSync(join(tmpdir(), "preview-plan-rename-"));
  try {
    execFileSync("git", ["init", "--quiet", scratch]);
    mkdirSync(join(scratch, "src/worker"), { recursive: true });
    writeFileSync(join(scratch, "src/worker/auth.ts"), "export const secure = true;\n");
    const git = (...args) => execFileSync("git", ["-C", scratch, ...args], { encoding: "utf8" }).trim();
    git("add", "-A");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.test", "commit", "-qm", "base");
    const old = git("rev-parse", "HEAD");
    mkdirSync(join(scratch, "docs"), { recursive: true });
    renameSync(join(scratch, "src/worker/auth.ts"), join(scratch, "docs/guide.md"));
    git("add", "-A");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.test", "commit", "-qm", "rename");
    const recent = git("rev-parse", "HEAD");
    const paths = execFileSync("git", ["-C", scratch, "diff", "--name-only", "--no-renames", "-z", old, recent, "--"], { encoding: "utf8" }).split("\0").filter(Boolean);
    assert.deepEqual(paths.sort(), ["docs/guide.md", "src/worker/auth.ts"].sort());
    assert.equal(planPreview(paths, paths).deploy, "required");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  // Exercise the actual git show path, not just the pure comparison helper.
  const packageRepo = mkdtempSync(join(tmpdir(), "preview-plan-package-"));
  try {
    execFileSync("git", ["init", "--quiet", packageRepo]);
    const git = (...args) => execFileSync("git", ["-C", packageRepo, ...args], { encoding: "utf8" }).trim();
    const commit = label => {
      git("add", "-A");
      git("-c", "user.name=CI", "-c", "user.email=ci@example.test", "commit", "-qm", label);
      return git("rev-parse", "HEAD");
    };
    writeFileSync(join(packageRepo, "package.json"), JSON.stringify(manifest) + "\n");
    const base = commit("base");
    writeFileSync(join(packageRepo, "package.json"), JSON.stringify(testOnly) + "\n");
    const testSha = commit("test only");
    assert.equal(packageDiffIsTestOnly(base, testSha, packageRepo), true);
    assert.equal(packageDiffIsTestOnly(testSha, base, packageRepo), true);
    assert.equal(packageDiffIsTestOnly("missing", testSha, packageRepo), false);
    writeFileSync(join(packageRepo, "package.json"), JSON.stringify({ ...testOnly, dependencies: { react: "2.0.0" } }) + "\n");
    const runtimeSha = commit("runtime deps");
    assert.equal(packageDiffIsTestOnly(base, runtimeSha, packageRepo), false);
  } finally {
    rmSync(packageRepo, { recursive: true, force: true });
  }
  console.log("Preview plan self-test: " + cases.length + " impact cases, package test-only semantics, missing seed evidence, protected rename passed");
};

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const option = name => {
    const direct = process.argv.find(x => x.startsWith("--" + name + "="));
    return direct ? direct.split("=", 2)[1] : null;
  };
  const deployed = option("deployed-sha");
  const target = option("target-sha");
  const seeded = option("seeded-sha");
  if (!deployed || !target) throw new Error("Usage: node scripts/preview-change-plan.mjs --deployed-sha=<sha> --target-sha=<sha> [--seeded-sha=<sha>]");
  const runtimePaths = changedPaths(deployed, target);
  const seedPaths = seeded ? changedPaths(seeded, target) : null;
  const packageTestOnly = runtimePaths.includes("package.json") && packageDiffIsTestOnly(deployed, target);
  const result = planPreview(runtimePaths, seedPaths, { packageTestOnly });
  const report = { deployedSha: deployed, targetSha: target, seededSha: seeded,
    packageDiff: runtimePaths.includes("package.json") ? (packageTestOnly ? "test_scripts_only" : "runtime_or_unverified") : "unchanged",
    ...result,
    runtimeChangedPaths: runtimePaths, seedChangedPaths: seedPaths };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "### Read-only Preview impact plan\nDeploy: **" + report.deploy + "**; Seed: **" + report.seed
      + "**; Browser: **" + report.browser + "**.\n" + report.note + "\n");
  }
}
