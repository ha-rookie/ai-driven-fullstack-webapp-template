#!/usr/bin/env node
/**
 * #547 minimal development-loop resumption advisor.
 * Purely read-only: issue/PR/actions GET, never merge, re-run, dispatch,
 * modify GitHub resources, deploy, handle secrets or mutate databases.
 *
 * GitHub is authoritative; an old assistant summary or snapshot is NOT.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const SHA = /^[a-f0-9]{40}$/u;
const REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u;
const REQUIRED = Object.freeze({
  validate: ".github/workflows/ci.yml",
  secrets: ".github/workflows/secret-detection.yml",
});
const MAX_BYTES = 1024 * 1024;

const requirePositive = (value, name) => {
  if (!/^[1-9][0-9]*$/u.test(value || "") || !Number.isSafeInteger(Number(value))) {
    throw new Error(`Invalid ${name}`);
  }
  return Number(value);
};

const parseArgs = argv => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--self-test") { args.selfTest = true; continue; }
    if (!["--repo", "--issue", "--pr", "--previous", "--output"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (args[arg] || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error(`Duplicate or missing argument: ${arg}`);
    }
    args[arg] = argv[++i];
  }
  if (!args.selfTest) {
    args.repo = args["--repo"] || process.env.GITHUB_REPOSITORY;
    if (!REPO.test(args.repo || "")) throw new Error("Expected --repo owner/name");
    args.issue = requirePositive(args["--issue"], "--issue");
    args.pr = args["--pr"] ? requirePositive(args["--pr"], "--pr") : null;
  }
  return args;
};

const boundedGet = async (repo, suffix) => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repo}/${suffix}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) {
    throw new Error("github_response_too_large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("github_response_too_large");
  return JSON.parse(text);
};

// Missing/in-progress/stale-SHA checks never become a green status.
// A check completed for an earlier PR head is deliberately ignored.
export const checkRequiredRuns = (runs, expectedSha) => Object.fromEntries(
  Object.entries(REQUIRED).map(([name, path]) => {
    const matches = (Array.isArray(runs) ? runs : [])
      .filter(run => run?.path === path && run.event === "pull_request"
        && run.head_sha === expectedSha)
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
        || Number(b.run_attempt || 0) - Number(a.run_attempt || 0));
    const run = matches[0];
    if (!run) return [name, { status: "unverified", reason: "exact_sha_run_missing" }];
    const evidence = { runId: run.id, attempt: run.run_attempt || 1 };
    if (run.status !== "completed") return [name, { ...evidence, status: "pending" }];
    if (run.conclusion === "success") return [name, { ...evidence, status: "success" }];
    if (["failure", "cancelled", "timed_out", "startup_failure", "action_required"].includes(run.conclusion)) {
      return [name, { ...evidence, status: "failed", reason: run.conclusion }];
    }
    return [name, { ...evidence, status: "unverified", reason: run.conclusion || "unknown" }];
  }),
);

const plan = (currentStep, nextAction, stopReason = null) => ({
  currentStep, nextAction, stopReason,
});

// This decision tree is a suggestion, NOT permission to bypass repository
// rulesets, PR review or the explicit Preview/Production Human Gate.
export const deriveResume = ({ repository, issueNumber, issue, prNumber = null, pr = null, runs = [], previous = null }) => {
  if (!REPO.test(repository) || !Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new Error("Invalid repository or issue identity");
  }
  if (issue?.number !== issueNumber || !["open", "closed"].includes(issue.state)
      || issue.pull_request) throw new Error("Issue response identity mismatch");
  if (prNumber !== null && (!pr || pr.number !== prNumber)) throw new Error("PR response identity mismatch");

  const prSha = pr?.head?.sha;
  const baseSha = pr?.base?.sha;
  const current = {
    schemaVersion: 1,
    advisoryOnly: true,
    repository,
    issueNumber,
    issueState: issue.state,
    prNumber,
    branch: pr?.head?.ref ?? null,
    baseSha: SHA.test(baseSha || "") ? baseSha : null,
    headSha: SHA.test(prSha || "") ? prSha : null,
    merged: pr?.merged_at != null,
    checks: pr ? checkRequiredRuns(runs, prSha) : null,
    humanGate: "never_auto_authorize_remote_production_secrets_destructive_or_migrations",
  };
  current.runId = `${repository}#${issueNumber}:${prNumber ?? "unassigned"}`;
  current.previousHeadChanged = Boolean(previous && (
    previous.repository !== repository || previous.issueNumber !== issueNumber
    || previous.prNumber !== prNumber || previous.headSha !== current.headSha
  ));

  let decision;
  if (!pr) {
    decision = issue.state === "closed"
      ? plan("complete_unverified", "review_issue_closure", "no_pr_evidence")
      : plan("issue_ready_for_review", "inspect_issue_and_locate_existing_pr_before_branch");
  } else if (pr.base?.repo?.full_name !== repository
      || pr.head?.repo?.full_name !== repository
      || pr.base.ref !== "main" || !SHA.test(prSha || "")
      || !SHA.test(baseSha || "")) {
    decision = plan("blocked", "inspect_pr_identity_and_base", "pr_repository_or_sha_mismatch");
  } else if (pr.merged_at) {
    decision = issue.state === "closed"
      ? plan("completed", "none")
      : plan("merged_needs_sync", "update_linked_issue_roadmap_and_notion");
  } else if (pr.state !== "open" || issue.state !== "open") {
    decision = plan("blocked", "inspect_issue_pr_state", "issue_or_pr_closed_without_merge");
  } else if (pr.draft) {
    decision = plan("draft", "finish_bounded_implementation_and_open_review");
  } else if (!(new RegExp(`(?:^|[^0-9])#${issueNumber}(?![0-9])`, "u")
    .test(`${pr.title || ""}\n${pr.body || ""}`))) {
    decision = plan("blocked", "verify_issue_to_pr_link", "pr_does_not_reference_issue");
  } else if (Object.values(current.checks).some(check => check.status === "failed")) {
    decision = plan("ci_failed", "inspect_failed_check_and_repair_within_budget", "ci_failed");
  } else if (Object.values(current.checks).some(check => check.status === "unverified")) {
    decision = plan("blocked_unverified", "verify_exact_head_sha_required_checks", "missing_or_ambiguous_ci");
  } else if (Object.values(current.checks).some(check => check.status === "pending")) {
    decision = plan("waiting_for_ci", "recheck_required_checks_on_same_head");
  } else if (pr.mergeable !== true) {
    decision = plan("blocked", "inspect_mergeability_and_branch_protection", "mergeability_not_confirmed");
  } else {
    decision = plan("ready_for_merge_review", "review_diff_policy_human_gates_then_merge");
  }
  return { ...current, ...decision, sourceOfTruth: "fresh_github_issue_pr_actions_get" };
};

const fakeSha = char => char.repeat(40);
const issue = { number: 547, state: "open" };
const pr = { number: 100, state: "open", draft: false, title: "fix: restart #547",
  body: "Resolves #547", mergeable: true, merged_at: null,
  base: { ref: "main", sha: fakeSha("a"), repo: { full_name: "example/project" } },
  head: { ref: "feat/resume", sha: fakeSha("b"), repo: { full_name: "example/project" } } };
const goodRuns = Object.values(REQUIRED).map((path, idx) => ({
  id: idx + 1, path, event: "pull_request", head_sha: pr.head.sha,
  status: "completed", conclusion: "success", run_attempt: 1, created_at: "2026-10-11T00:00:00Z",
}));

const selfTest = () => {
  const derive = (values = {}) => deriveResume({
    repository: "example/project", issueNumber: 547, issue, prNumber: pr.number,
    pr, runs: goodRuns, ...values,
  });
  assert.equal(derive().currentStep, "ready_for_merge_review");
  assert.equal(derive({ runs: goodRuns.map(x => ({ ...x, head_sha: fakeSha("c") })) }).currentStep, "blocked_unverified");
  assert.equal(derive({ runs: [{ ...goodRuns[0], status: "in_progress" }, goodRuns[1]] }).currentStep, "waiting_for_ci");
  assert.equal(derive({ runs: [{ ...goodRuns[0], conclusion: "failure" }, goodRuns[1]] }).currentStep, "ci_failed");
  assert.equal(derive({ pr: { ...pr, mergeable: null } }).currentStep, "blocked");
  assert.equal(derive({ pr: { ...pr, head: { ...pr.head, sha: fakeSha("c") } } }).currentStep, "blocked_unverified");
  assert.equal(derive({ pr: { ...pr, merged_at: "2026-10-11T00:00:00Z", state: "closed" } }).currentStep, "merged_needs_sync");
  assert.equal(derive({ issue: { ...issue, state: "closed" }, pr: { ...pr, merged_at: "2026-10-11T00:00:00Z", state: "closed" } }).currentStep, "completed");
  assert.equal(derive({ pr: { ...pr, base: { ...pr.base, ref: "production" } } }).currentStep, "blocked");
  assert.equal(derive({ pr: { ...pr, draft: true } }).currentStep, "draft");
  assert.equal(derive({ pr: { ...pr, title: "unrelated", body: "no issue reference" } }).currentStep, "blocked");
  assert.equal(derive({ previous: { repository: "example/project", issueNumber: 547,
    prNumber: 100, headSha: fakeSha("a") } }).previousHeadChanged, true);
  assert.equal(derive({ pr: null, prNumber: null }).nextAction, "inspect_issue_and_locate_existing_pr_before_branch");
  assert.throws(() => derive({ pr: { ...pr, number: 101 } }), /PR response identity mismatch/u);
  // A newer, unsuccessful run overrides a prior green one for the same SHA.
  assert.equal(derive({ runs: [...goodRuns, { ...goodRuns[0], id: 10, conclusion: "failure",
    created_at: "2026-10-11T01:00:00Z" }] }).currentStep, "ci_failed");
  console.log("Dev-loop read-only resume self-test: 15 cases passed");
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) { selfTest(); return; }
  const [issueValue, prValue] = await Promise.all([
    boundedGet(args.repo, `issues/${args.issue}`),
    args.pr ? boundedGet(args.repo, `pulls/${args.pr}`) : Promise.resolve(null),
  ]);
  const runs = prValue?.head?.sha && SHA.test(prValue.head.sha)
    ? (await boundedGet(args.repo,
      `actions/runs?head_sha=${prValue.head.sha}&per_page=100`)).workflow_runs : [];
  if (prValue && !Array.isArray(runs)) throw new Error("github_runs_not_array");
  let previous = null;
  if (args["--previous"]) {
    previous = JSON.parse(await readFile(args["--previous"], "utf8"));
  }
  const result = deriveResume({ repository: args.repo, issueNumber: args.issue, issue: issueValue,
    prNumber: args.pr, pr: prValue, runs, previous });
  // No raw issue or PR content, credentials, PII or comments are persisted.
  const serialized = JSON.stringify(result, null, 2) + "\n";
  if (args["--output"]) await writeFile(args["--output"], serialized, { mode: 0o600, flag: "wx" });
  process.stdout.write(serialized);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(`dev_loop_resume_error: ${error.message}`); process.exitCode = 1; });
}
