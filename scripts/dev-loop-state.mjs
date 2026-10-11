#!/usr/bin/env node
/**
 * #547 — Local one-Issue checkpoint/lock around the existing read-only
 * GitHub resume advisor. No GitHub writes and no autonomous execution.
 * This is NOT a distributed lock: it only excludes processes sharing --state-dir.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, rename, rmdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fetchLiveResume } from "./dev-loop-resume.mjs";

const REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u;
const ATTEMPT_LIMIT = 3;

const parsePositive = value =>
  /^[1-9][0-9]*$/u.test(value || "") && Number.isSafeInteger(Number(value))
    ? Number(value) : null;

const parseArgs = argv => {
  if (argv.length === 1 && argv[0] === "--self-test") return { selfTest: true };
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--record-repair") {
      if (values.recordRepair) throw new Error("duplicate_record_repair");
      values.recordRepair = true;
      continue;
    }
    if (!["--repo", "--issue", "--pr", "--state-dir"].includes(flag)
      || values[flag] || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error("invalid_or_duplicate_flag");
    }
    values[flag] = argv[++i];
  }
  const repository = values["--repo"] || process.env.GITHUB_REPOSITORY;
  const issueNumber = parsePositive(values["--issue"]);
  const prNumber = values["--pr"] === undefined ? null : parsePositive(values["--pr"]);
  if (!REPO.test(repository || "") || !issueNumber
    || (values["--pr"] !== undefined && !prNumber)) throw new Error("invalid_scope");
  return {
    repository, issueNumber, prNumber, recordRepair: !!values.recordRepair,
    stateDir: resolve(values["--state-dir"] || "artifacts/dev-loop"),
  };
};

const statePaths = (root, repository, issueNumber) => {
  // The same Issue receives the same lock even if the PR head/number changes.
  const key = `${repository.replace("/", "--")}--issue-${issueNumber}`;
  return { file: join(root, `${key}.json`), lock: join(root, `${key}.lock`) };
};

const load = async file => {
  let value;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("state_unreadable_or_corrupt");
  }
  if (!value || value.schemaVersion !== 1 || !REPO.test(value.repository || "")
    || !parsePositive(String(value.issueNumber || ""))
    || !(value.prNumber === null || parsePositive(String(value.prNumber || "")))
    || !Number.isSafeInteger(value.repairAttempts) || value.repairAttempts < 0
    || !Number.isSafeInteger(value.checkpointCount) || value.checkpointCount < 1
    || !value.latest || typeof value.latest !== "object"
    || value.latest.repository !== value.repository
    || value.latest.issueNumber !== value.issueNumber
    || value.latest.prNumber !== value.prNumber) throw new Error("state_invalid");
  return value;
};

const persistAtomic = async (file, state) => {
  // Exclusive temporary file + same-directory rename: never leave a partly
  // written checkpoint. The lock is held for the full transaction.
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(state, null, 2) + "\n");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
};

export const checkpoint = async ({
  repository, issueNumber, prNumber = null, stateDir,
  recordRepair = false, resolveLive = fetchLiveResume,
}) => {
  if (!REPO.test(repository || "") || !parsePositive(String(issueNumber))
    || (prNumber !== null && !parsePositive(String(prNumber)))) throw new Error("invalid_scope");
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(stateDir)).isDirectory()) throw new Error("state_dir_not_a_directory");
  const paths = statePaths(stateDir, repository, issueNumber);
  try {
    await mkdir(paths.lock, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("local_issue_locked_manual_review_required");
    throw error;
  }

  try {
    const previous = await load(paths.file);
    if (previous && (previous.repository !== repository || previous.issueNumber !== issueNumber)) {
      throw new Error("state_identity_mismatch");
    }
    if (previous && prNumber !== null && previous.prNumber !== null && previous.prNumber !== prNumber) {
      throw new Error("pr_switch_requires_manual_state_review");
    }

    // A future chat can supply only --issue: recover previous PR number, but
    // never trust previous HEAD/CI as current, always refetch GitHub first.
    const effectivePr = prNumber ?? previous?.prNumber ?? null;
    const latest = await resolveLive({
      repository, issueNumber, prNumber: effectivePr, previous: previous?.latest ?? null,
    });
    if (!latest || latest.repository !== repository || latest.issueNumber !== issueNumber
      || latest.prNumber !== effectivePr || latest.advisoryOnly !== true
      || latest.sourceOfTruth !== "fresh_github_issue_pr_actions_get") {
      throw new Error("live_evidence_invalid_no_state_change");
    }

    let repairAttempts = previous?.repairAttempts ?? 0;
    if (recordRepair) {
      if (latest.currentStep !== "ci_failed" || repairAttempts >= ATTEMPT_LIMIT) {
        throw new Error("repair_recording_not_permitted");
      }
      repairAttempts += 1; // human records a planned/manual attempt, not auto-repair
    }
    const state = {
      schemaVersion: 1,
      repository, issueNumber, prNumber: effectivePr, runId: latest.runId,
      checkpointCount: (previous?.checkpointCount ?? 0) + 1,
      repairAttempts, maxRepairAttempts: ATTEMPT_LIMIT,
      observedAt: new Date().toISOString(),
      latest,
      stateStorage: "local_only_not_distributed",
    };
    if (latest.currentStep === "ci_failed" && repairAttempts >= ATTEMPT_LIMIT) {
      state.latest = {
        ...latest, currentStep: "blocked_repair_budget",
        nextAction: "manual_diagnosis_and_review_before_more_repairs",
        stopReason: "repair_attempt_limit_3",
      };
    }
    await persistAtomic(paths.file, state);
    return { stateFile: paths.file, ...state };
  } finally {
    // Never automatically steal an abandoned lock. If this process created
    // it, release only its empty directory; no recursive deletion.
    await rmdir(paths.lock);
  }
};

const fixture = (repo, issueNumber, prNumber, headSha = "a".repeat(40), status = "waiting_for_ci") => ({
  schemaVersion: 1, advisoryOnly: true, sourceOfTruth: "fresh_github_issue_pr_actions_get",
  repository: repo, issueNumber, prNumber, headSha, baseSha: "b".repeat(40),
  runId: `${repo}#${issueNumber}:${prNumber ?? "unassigned"}`,
  currentStep: status, nextAction: "recheck_required_checks_on_same_head",
  stopReason: null, checks: { validate: { status: "pending" }, secrets: { status: "success" } },
});
const expectReject = async (fn, message) => {
  await assert.rejects(fn, error => error instanceof Error && error.message === message);
};

const selfTest = async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "dev-loop-state-test-"));
  const repository = "example/repo", issueNumber = 547, prNumber = 581;
  let calls = 0;
  let sha = "a".repeat(40), status = "waiting_for_ci";
  const live = async ({ prNumber: received, previous }) => {
    calls += 1;
    assert.equal(received, prNumber);
    if (calls > 1) assert.ok(previous);
    return fixture(repository, issueNumber, prNumber, sha, status);
  };
  const args = { repository, issueNumber, prNumber, stateDir, resolveLive: live };
  try {
    const initial = await checkpoint(args);
    assert.equal(initial.checkpointCount, 1);
    assert.equal(initial.repairAttempts, 0);
    assert.equal(JSON.parse(await readFile(initial.stateFile, "utf8")).latest.headSha, sha);
    sha = "c".repeat(40);
    const resumed = await checkpoint({ ...args, prNumber: null });
    assert.equal(resumed.prNumber, prNumber);
    assert.equal(resumed.latest.headSha, sha);
    assert.equal(resumed.checkpointCount, 2);

    const { file, lock } = statePaths(stateDir, repository, issueNumber);
    await mkdir(lock);
    await expectReject(() => checkpoint(args), "local_issue_locked_manual_review_required");
    await rmdir(lock);
    await expectReject(() => checkpoint({ ...args, prNumber: 999 }), "pr_switch_requires_manual_state_review");

    let unblock;
    const pending = checkpoint({ ...args, resolveLive: () => new Promise(resolve => { unblock = resolve; }) });
    // Start the second after the first has entered its live resolver.
    while (!unblock) await new Promise(resolve => setImmediate(resolve));
    await expectReject(() => checkpoint(args), "local_issue_locked_manual_review_required");
    unblock(fixture(repository, issueNumber, prNumber, sha, status));
    await pending;

    const beforeFailure = await readFile(file, "utf8");
    await expectReject(() => checkpoint({ ...args, resolveLive: async () => { throw new Error("github_down"); } }), "github_down");
    assert.equal(await readFile(file, "utf8"), beforeFailure);

    status = "ci_failed";
    const first = await checkpoint({ ...args, recordRepair: true });
    assert.equal(first.repairAttempts, 1);
    const second = await checkpoint({ ...args, recordRepair: true });
    assert.equal(second.repairAttempts, 2);
    const third = await checkpoint({ ...args, recordRepair: true });
    assert.equal(third.repairAttempts, 3);
    assert.equal(third.latest.currentStep, "blocked_repair_budget");
    await expectReject(() => checkpoint({ ...args, recordRepair: true }), "repair_recording_not_permitted");
    const stopped = await checkpoint(args);
    assert.equal(stopped.latest.stopReason, "repair_attempt_limit_3");

    status = "merged_needs_sync";
    const afterMerge = await checkpoint(args);
    assert.equal(afterMerge.latest.currentStep, "merged_needs_sync");
    assert.equal(afterMerge.repairAttempts, 3);

    await rm(file);
    await open(file, "wx").then(async h => { await h.writeFile("corrupt"); await h.close(); });
    await expectReject(() => checkpoint(args), "state_unreadable_or_corrupt");
    assert.equal(await readFile(file, "utf8"), "corrupt"); // never overwrite a corrupt state
    console.log("Dev-loop local checkpoint self-test: 13 assertions/scenarios passed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
};

const parse = argv => {
  const args = parseArgs(argv);
  if (!args.selfTest && !args.stateDir) throw new Error("missing_state_dir");
  return args;
};

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.selfTest) { await selfTest(); return; }
  const state = await checkpoint(args);
  process.stdout.write(JSON.stringify(state, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(`dev_loop_state_error: ${error.message}`); process.exitCode = 1; });
}
