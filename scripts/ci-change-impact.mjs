/**
 * Conservative PR impact selection for the required "validate" status check.
 * This intentionally is NOT a dependency graph: unknown paths fail closed to FULL.
 * Workflow dispatch / scheduled runs always use FULL.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const classifyChangedPaths = (paths) => {
  if (!Array.isArray(paths) || paths.length === 0) return "full";
  let tier = "docs";
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
      return "full";
    }
    const docsOnly = (/^docs\/.+\.md$/u.test(path)
      && !/^docs\/(?:security|operations)\//u.test(path)
      && path !== "docs/MASTER_DATA.md")
      || ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"].includes(path);
    if (docsOnly) continue;

    // Only independent UI presentation is cheap. WORKHUB reference fixtures
    // and shared types can be imported by the Worker and must remain FULL.
    const uiOnly = /^src\/reference\/admin\/.+\.(?:tsx|css)$/u.test(path)
      || /^src\/.+\.css$/u.test(path);
    if (uiOnly) {
      tier = "frontend";
      continue;
    }
    // Dependencies, workflows, migrations, tests, auth, domain and unknown
    // assets can alter behavior or controls: do not try to guess their impact.
    return "full";
  }
  return tier;
};


/**
 * Keep lightweight safety contracts in every FULL PR, but run the two slow
 * isolated D1 suites only when the changed area can affect their contracts.
 * This is deliberately an opt-out allowlist, not a general dependency graph.
 * Unknown paths, shared infrastructure, SQL, toolchain and selector changes
 * always run BOTH. Scheduled/manual runs always run BOTH.
 */
export const classifyExpensiveChecks = (paths) => {
  const both = { performance: true, operationMode: true };
  if (!Array.isArray(paths) || paths.length === 0) return both;
  const selected = { performance: false, operationMode: false };
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") || path.startsWith("/")) {
      return both;
    }
    // Known presentation, Preview E2E and documentation changes do not alter
    // the local D1 query-plan or operation-mode persistence contracts.
    if (
      ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"].includes(path)
      || /^docs\/.+\.md$/u.test(path)
      || /^src\/reference\/.+\.(?:ts|tsx|css)$/u.test(path)
      || /^src\/.+\.css$/u.test(path)
      || /^e2e\/.+\.(?:ts|tsx|js|mjs|json)$/u.test(path)
      || /^tests\/(?!fixtures\/)(?!.*(?:operation-mode|performance|benchmark|d1|database)).+\.test\.ts$/u.test(path)
      || path === ".github/workflows/browser-e2e.yml"
    ) continue;

    // Structural changes may affect both suites or their own selection.
    if (
      ["package.json", "package-lock.json", "wrangler.jsonc", ".github/workflows/ci.yml",
        "scripts/ci-change-impact.mjs", "scripts/operation-mode-local-test.mjs",
        "scripts/d1-performance-benchmark.mjs"].includes(path)
      || /^migrations\//u.test(path)
      || /^src\/infrastructure\//u.test(path)
      || /^src\/shared\//u.test(path)
      || /^src\/domain\//u.test(path)
      || /^tests\/fixtures\//u.test(path)
      || /^tests\/.*(?:operation-mode|performance|benchmark|d1|database)/u.test(path)
      || /^tsconfig.*\.json$/u.test(path)
    ) return both;

    if (path === "src/worker.ts") return both;
    // Any Worker SQL/query change can affect D1 performance, but unrelated
    // business endpoints do not exercise the operation-mode control plane.
    if (/^src\/worker\//u.test(path)) {
      selected.performance = true;
      if (/^src\/worker\/(?:auth|http|administration)(?:\/|\.ts$)/u.test(path)) {
        selected.operationMode = true;
      }
      continue;
    }
    // Unreviewed paths must not silently bypass either expensive check.
    return both;
  }
  return selected;
};

const selfTest = () => {
  const checks = [
    [["docs/EXAMPLE.md"], "docs"],
    [["README.md", "docs/MASTER_DATA_GUIDE.md"], "docs"],
    [["src/reference/admin/AdminPortal.tsx"], "frontend"],
    [["src/reference/admin/AdminPortal.tsx", "README.md"], "frontend"],
    [["src/reference/admin/AdminPortal.tsx", "src/worker/auth/login.ts"], "full"],
    [["src/reference/workhub/travel-request/fixtures.ts"], "full"],
    [["src/reference/admin/MasterScheduleDemo.ts"], "full"],
    [["src/shared/runtime.ts"], "full"],
    [["src/worker.ts"], "full"],
    [["migrations/009_master.sql"], "full"],
    [[".github/workflows/ci.yml"], "full"],
    [["package-lock.json"], "full"],
    [["tests/auth.test.ts"], "full"],
    [["docs/security/SECURITY_CONFIGURATION_VALIDATION.md"], "full"],
    [["docs/operations/PRODUCTION_MIGRATION_PREFLIGHT.md"], "full"],
    [["docs/MASTER_DATA.md"], "full"],
    [["LICENSE"], "full"],
    [["unknown.dat"], "full"],
    [[], "full"],
    [["src/reference/admin/UI.tsx", "src/reference/workhub/fixtures.ts"], "full"],
    [["/untrusted/path.md"], "full"],
  ];
  for (const [paths, expected] of checks) {
    assert.equal(classifyChangedPaths(paths), expected, `impact: ${paths.join(", ")}`);
  }

  const expensiveChecks = [
    [["e2e/preview/login.ts", "tests/preview-response-completion.test.ts"], false, false],
    [["src/reference/workhub/travel/fixture.ts"], false, false],
    [["src/worker/jobs/job-api.ts"], true, false],
    [["src/worker/auth/login.ts"], true, true],
    [["src/worker/auth.ts"], true, true],
    [["src/worker/administration/operation-mode-api.ts"], true, true],
    [["src/infrastructure/d1-operation-mode-store.ts"], true, true],
    [["migrations/0012_add_index.sql"], true, true],
    [["src/reference/admin/UI.tsx", "src/worker/auth/login.ts"], true, true],
    [["package-lock.json"], true, true],
    [["docs/operations/RISK_BASED_CI.md"], false, false],
    [[".github/workflows/ci.yml"], true, true],
    [["scripts/ci-change-impact.mjs"], true, true],
    [["unknown.file"], true, true],
    [[], true, true],
    [["/absolute/untrusted.md"], true, true],
  ];
  for (const [paths, performance, operationMode] of expensiveChecks) {
    assert.deepEqual(classifyExpensiveChecks(paths), { performance, operationMode },
      `expensive: ${paths.join(", ")}`);
  }
  // Regression: a rename from privileged source to harmless docs must remain FULL.
  // Git's normal rename detection reports only the new path with --name-only.
  const worktree = mkdtempSync(join(tmpdir(), "ci-impact-rename-"));
  try {
    execFileSync("git", ["init", "--quiet", worktree]);
    mkdirSync(join(worktree, "src/worker"), { recursive: true });
    writeFileSync(join(worktree, "src/worker/auth.ts"), "export const guard = true;\n");
    const git = (...args) => execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
    git("add", "-A");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.test", "commit", "--quiet", "-m", "base");
    const baseSha = git("rev-parse", "HEAD");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    renameSync(join(worktree, "src/worker/auth.ts"), join(worktree, "docs/guide.md"));
    git("add", "-A");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.test", "commit", "--quiet", "-m", "rename");
    const headSha = git("rev-parse", "HEAD");
    const changed = execFileSync("git", ["-C", worktree, "diff", "--name-only", "--no-renames", "-z", baseSha, headSha, "--"], { encoding: "utf8" }).split("\0").filter(Boolean);
    assert.deepEqual(changed.sort(), ["docs/guide.md", "src/worker/auth.ts"].sort());
    assert.equal(classifyChangedPaths(changed), "full");
    assert.deepEqual(classifyExpensiveChecks(changed), { performance: true, operationMode: true });
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
  console.log(`CI impact selector self-test: ${checks.length} tier cases + ${expensiveChecks.length} expensive-check cases + source-to-docs rename passed`);
};

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const full = process.argv.includes("--full");
    const baseIndex = process.argv.indexOf("--base");
    const headIndex = process.argv.indexOf("--head");
    let paths = [];
    if (!full) {
      if (baseIndex < 0 || headIndex < 0) throw new Error("Missing --base or --head; refusing to guess CI impact");
      const base = process.argv[baseIndex + 1];
      const head = process.argv[headIndex + 1];
      const sha = /^[a-f0-9]{40}$/iu;
      if (!sha.test(base) || !sha.test(head)) throw new Error("Expected exact git SHAs");
      paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head, "--"], {
        encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      }).split("\0").filter(Boolean);
    }
    const tier = full ? "full" : classifyChangedPaths(paths);
    const expensive = full ? { performance: true, operationMode: true } : classifyExpensiveChecks(paths);
    const reason = full ? "manual_or_scheduled_full" : "conservative_path_classification";
    const summary = `CI impact: **${tier.toUpperCase()}** (${reason}; ${paths.length} changed paths)`;
    console.log(summary);
    console.log(`Expensive D1 regression: performance=${expensive.performance} operation_mode=${expensive.operationMode}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\nperformance=${expensive.performance}\noperation_mode=${expensive.operationMode}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Risk-based validation\n${summary}\n\nExpensive local D1 suites: performance=${expensive.performance}, operation mode=${expensive.operationMode}\n\n` +
      (paths.length ? `Changed paths:\n${paths.map((p) => `- \`${p}\``).join("\n")}\n\n` : "") +
      "The required validate job always runs. Unknown or protected changes use FULL.\n");
  }
}
