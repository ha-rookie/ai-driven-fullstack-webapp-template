#!/usr/bin/env node
/**
 * Work selection guard (#597) for new pull requests.
 * No network, GitHub token, Notion access, npm install or remote side effects.
 *
 * The focus policy is loaded from the BASE commit. A PR cannot approve itself
 * by altering the focus policy in its own changed files.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const POLICY_PATH = "config/work-selection-policy.json";
const START_MARKER = /<!-- work-selection:v1\s*([\s\S]*?)\s*-->/gu;
const SHA = /^[0-9a-f]{40}$/iu;
const ISSUE_REF = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/[1-9]\d*$/u;
const NOTION_REF = /^https:\/\/(?:app\.)?notion\.(?:com|so)\/\S+$/u;
const GOVERNANCE_PATHS = new Set([
  POLICY_PATH,
  "scripts/work-selection-gate.mjs",
  ".github/workflows/ci.yml",
  ".github/pull_request_template.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/operations/WORK_SELECTION_GATE.md",
]);
const HUMAN_GATE_PATHS = path =>
  path === "wrangler.jsonc" || path.startsWith("migrations/")
  || path.startsWith(".github/workflows/preview-")
  || path.startsWith(".github/workflows/production-");

const meaningful = (value, min = 28) =>
  typeof value === "string"
  && value.trim().length >= min
  && !/^(?:TODO|TBD|REPLACE|N\/A|EXAMPLE)/iu.test(value.trim());

const hasNumber = (array, value) =>
  Array.isArray(array) && array.some(item => item === value);

export const validatePolicy = policy => {
  if (!policy || policy.schemaVersion !== 1
    || !Number.isSafeInteger(policy.roadmapIssue) || policy.roadmapIssue < 1
    || !Number.isSafeInteger(policy.enforceFromPrNumber) || policy.enforceFromPrNumber < 1
    || !Array.isArray(policy.focusIssues) || policy.focusIssues.length === 0
    || policy.focusIssues.some(x => !Number.isSafeInteger(x) || x < 1)
    || !Array.isArray(policy.approvedExceptions)
    || policy.approvedExceptions.some(x =>
      !Number.isSafeInteger(x?.issue) || x.issue < 1 || !meaningful(x.reason))
    || !Array.isArray(policy.governanceChangeIssues)
    || policy.governanceChangeIssues.some(x => !Number.isSafeInteger(x) || x < 1)) {
    throw new Error("invalid_base_work_selection_policy");
  }
  return policy;
};

export const parseSelectionRecord = body => {
  const markers = Array.from((body || "").matchAll(START_MARKER));
  if (markers.length !== 1) throw new Error("one_work_selection_record_required");
  let record;
  try {
    record = JSON.parse(markers[0][1]);
  } catch {
    throw new Error("work_selection_record_invalid_json");
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("work_selection_record_not_object");
  }
  return record;
};

export const evaluate = ({ policy: rawPolicy, pr, changedPaths }) => {
  const policy = validatePolicy(rawPolicy);
  if (!pr || !Number.isSafeInteger(pr.number) || pr.number < 1) {
    throw new Error("pull_request_metadata_missing");
  }
  if (pr.number < policy.enforceFromPrNumber) {
    return { status: "legacy", reason: "pr_created_before_work_selection_enforcement" };
  }
  // Authorship from GitHub event, never from editable body text.
  if (pr.user?.login === "dependabot[bot]" && pr.user?.type === "Bot") {
    return { status: "bot", reason: "verified_dependabot_dependency_updates_follow_existing_policy" };
  }

  if (!SHA.test(pr.base?.sha || "") || !SHA.test(pr.head?.sha || "")
    || pr.base?.ref !== "main" || !Array.isArray(changedPaths)
    || changedPaths.length === 0) {
    throw new Error("missing_base_head_or_changed_paths");
  }
  const body = pr.body || "";
  const record = parseSelectionRecord(body);
  const errors = [];

  if (!Number.isSafeInteger(record.issue) || record.issue < 1) {
    errors.push("valid_implementation_issue_required");
  }
  if (record.roadmap !== policy.roadmapIssue) errors.push("roadmap_issue_mismatch");
  if (record.mainSha !== pr.base.sha) errors.push("stale_or_incorrect_main_baseline");
  if (!meaningful(record.whyNow)) errors.push("why_now_missing_or_placeholder");
  if (!meaningful(record.higherPriorityDisposition)) {
    errors.push("higher_priority_disposition_missing_or_placeholder");
  }
  if (!meaningful(record.acceptanceOutcome)) {
    errors.push("business_acceptance_outcome_missing_or_placeholder");
  }
  if (record.notionCheck === "checked") {
    if (!NOTION_REF.test(record.notionReference || "")) errors.push("notion_reference_missing");
  } else if (record.notionCheck === "not-accessible") {
    if (!ISSUE_REF.test(record.notionReference || "")) {
      errors.push("github_roadmap_reference_required_without_notion");
    }
  } else {
    errors.push("notion_check_status_missing");
  }

  if (!["none", "remote-approval-required"].includes(record.humanGate)) {
    errors.push("human_gate_declaration_missing");
  }
  if (changedPaths.some(HUMAN_GATE_PATHS) && record.humanGate !== "remote-approval-required") {
    errors.push("remote_sensitive_paths_require_explicit_human_gate_declaration");
  }
  if (changedPaths.some(path => typeof path !== "string" || !path || path.startsWith("/"))) {
    errors.push("invalid_changed_path");
  }
  const allowedFocus = hasNumber(policy.focusIssues, record.issue);
  const allowedException = policy.approvedExceptions.some(x => x.issue === record.issue);
  const expectedBasis = allowedFocus ? "focus" : allowedException ? "approved-exception" : null;
  if (!expectedBasis) errors.push("issue_not_in_base_policy_focus_or_approved_exceptions");
  if (record.priorityBasis !== expectedBasis) errors.push("priority_basis_mismatch");

  if (changedPaths.some(path => GOVERNANCE_PATHS.has(path))
    && !hasNumber(policy.governanceChangeIssues, record.issue)) {
    errors.push("governance_paths_require_base_approved_governance_issue");
  }
  // An Issue Change Contract is required by CONTRIBUTING. PR bodies are
  // independently editable: do not infer closure/association from a title.
  if (Number.isSafeInteger(record.issue)
    && !new RegExp("\\b(?:Closes|Fixes|Resolves)\\s+#" + record.issue + "\\b", "iu").test(body)) {
    errors.push("pr_must_close_exactly_selected_issue");
  }
  const otherCloses = Array.from(body.matchAll(/\b(?:Closes|Fixes|Resolves)\s+#([1-9]\d*)\b/giu));
  if (otherCloses.length !== 1 || Number(otherCloses[0][1]) !== record.issue) {
    errors.push("pr_must_close_one_selected_issue_only");
  }

  return { status: errors.length ? "blocked" : "passed", errors, issue: record.issue };
};

const selfTest = () => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const policy = {
    schemaVersion: 1, roadmapIssue: 132, enforceFromPrNumber: 598,
    focusIssues: [521], approvedExceptions: [{
      issue: 597, reason: "Approved user-requested governance exception for controlling future work.",
    }], governanceChangeIssues: [597],
  };
  const record = (issue = 521, basis = "focus") => ({
    issue, roadmap: 132, mainSha: base, priorityBasis: basis,
    whyNow: "This is the current top-priority blocker in the GitHub implementation roadmap.",
    higherPriorityDisposition: "No higher-priority work can be done without an approved remote Human Gate.",
    notionCheck: "checked",
    notionReference: "https://app.notion.com/p/3eed7c109faf810c8e9af72915fdfe85",
    humanGate: "none",
    acceptanceOutcome: "The agreed issue work will reach an independently verifiable acceptance outcome.",
  });
  const pr = (r = record(), opts = {}) => ({
    number: 600, user: { login: "agent", type: "User" },
    base: { sha: base, ref: "main" }, head: { sha: head },
    body: "Closes #" + r.issue + "\n<!-- work-selection:v1\n"
      + JSON.stringify(r, null, 2) + "\n-->", ...opts,
  });
  const result = (p, paths = ["src/worker/workhub-login.ts"], rule = policy) =>
    evaluate({ policy: rule, pr: p, changedPaths: paths });
  assert.equal(result(pr()).status, "passed", "focus PR passes");
  assert.equal(result(pr(record(597, "approved-exception")),
    ["config/work-selection-policy.json", "AGENTS.md"]).status, "passed",
    "governance exception passes");
  assert.deepEqual(result(pr(record(595, "approved-exception"))).errors.includes(
    "issue_not_in_base_policy_focus_or_approved_exceptions"), true,
    "recent backlog item cannot preempt focus");
  assert.equal(result(pr(record(595, "focus")), ["config/work-selection-policy.json"]).status,
    "blocked", "editing branch policy does not authorize own PR");
  assert.equal(result(pr(record(521)), ["config/work-selection-policy.json"]).status,
    "blocked", "normal focus PR cannot edit governance policy");
  assert.equal(result(pr({ ...record(), mainSha: head })).status,
    "blocked", "stale main baseline fails");
  assert.equal(result(pr({ ...record(), notionCheck: "unread" })).status,
    "blocked", "fictitious Notion status fails");
  assert.equal(result(pr({ ...record(), humanGate: "none" }), ["migrations/0099.sql"]).status,
    "blocked", "remote-sensitive paths are declared");
  assert.equal(result(pr({ ...record(), humanGate: "remote-approval-required" }),
    ["migrations/0099.sql"]).status, "passed", "remote approval pending can merge code");
  assert.throws(() => result(pr(record(), { body: "Closes #521" })),
    /one_work_selection_record_required/u, "missing selection record fails");
  assert.equal(result(pr(record(), { body: pr().body + "\nCloses #595" })).status,
    "blocked", "multiple Issues forbidden");
  assert.equal(result(pr(), ["src/worker/workhub-login.ts"],
    { ...policy, focusIssues: [595] }).status, "blocked",
    "a changed focus requires correct Issue");
  assert.equal(result(pr(record(), { number: 510 })).status,
    "legacy", "pre-rollout PR is not broken");
  assert.equal(result(pr(record(), {
    user: { login: "dependabot[bot]", type: "Bot" },
  })).status, "bot", "verified Dependabot has existing route");
  assert.throws(() => result(pr(record(), {
    user: { login: "dependabot[bot]", type: "User" },
    body: "",
  })), /one_work_selection_record_required/u,
  "spoofed author cannot bypass guard");
  assert.equal(result(pr({
    ...record(), notionCheck: "not-accessible",
    notionReference: "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132",
  })).status, "passed", "public contributors can cite GitHub rather than private Notion");
  assert.throws(() => validatePolicy({ ...policy, focusIssues: [] }),
    /invalid_base_work_selection_policy/u);
  console.log("Work Selection Gate: 16 adversarial/normal cases passed");
};

const cli = args => {
  if (args.length === 1 && args[0] === "--self-test") {
    selfTest();
    return;
  }
  const valid = args.length === 5
    && args[0] === "--check" && args[1] === "--base" && args[3] === "--head";
  if (!valid || !SHA.test(args[2]) || !SHA.test(args[4])) {
    throw new Error("usage: --self-test OR --check --base SHA --head SHA");
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH_required");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) {
    console.log("Work Selection Gate: non-PR scheduled/manual validation skipped");
    return;
  }
  if (pr.base?.sha !== args[2] || pr.head?.sha !== args[4]) {
    throw new Error("event_and_diff_sha_mismatch");
  }
  const paths = execFileSync("git",
    ["diff", "--name-only", "--no-renames", args[2], args[4]], {
      encoding: "utf8", maxBuffer: 1024 * 1024,
    }).trim().split("\n").filter(Boolean);

  let policyText;
  try {
    policyText = execFileSync("git", ["show", args[2] + ":" + POLICY_PATH], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // One-time bootstrap only. Fail closed for every other new PR; the
    // bootstrap PR cannot establish a different Issue or focus policy.
    if (pr.number !== 598) throw new Error("base_policy_missing_non_bootstrap_pr");
    policyText = readFileSync(POLICY_PATH, "utf8");
    const bootstrap = validatePolicy(JSON.parse(policyText));
    if (!hasNumber(bootstrap.governanceChangeIssues, 597)
      || !bootstrap.approvedExceptions.some(x => x.issue === 597)
      || !hasNumber(bootstrap.focusIssues, 521)) {
      throw new Error("invalid_work_selection_bootstrap");
    }
  }
  const result = evaluate({ policy: JSON.parse(policyText), pr, changedPaths: paths });
  if (result.status === "blocked") {
    throw new Error("work_selection_blocked: " + result.errors.join(", "));
  }
  console.log("Work Selection Gate: " + result.status
    + " | PR #" + pr.number + " | issue #" + (result.issue || "exempt"));
};

try {
  cli(process.argv.slice(2));
} catch (error) {
  console.error("Work Selection Gate FAILED: " + (error?.message || "unknown"));
  process.exitCode = 1;
}
