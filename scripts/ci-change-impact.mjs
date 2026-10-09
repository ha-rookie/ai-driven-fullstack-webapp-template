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
  } finally {
    rmSync(worktree, { recursive: true, force: true });
  }
  console.log(`CI impact selector self-test: ${checks.length} classification cases + source-to-docs rename passed`);
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
    const reason = full ? "manual_or_scheduled_full" : "conservative_path_classification";
    const summary = `CI impact: **${tier.toUpperCase()}** (${reason}; ${paths.length} changed paths)`;
    console.log(summary);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tier=${tier}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Risk-based validation\n${summary}\n\n` +
      (paths.length ? `Changed paths:\n${paths.map((p) => `- \`${p}\``).join("\n")}\n\n` : "") +
      "The required validate job always runs. Unknown or protected changes use FULL.\n");
  }
}
