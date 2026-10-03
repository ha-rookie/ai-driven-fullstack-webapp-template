import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const workflowPolicies = Object.freeze({
  ci: {
    path: ".github/workflows/ci.yml",
    label: "Full-stack template CI",
  },
  browserE2E: {
    path: ".github/workflows/browser-e2e.yml",
    label: "Browser E2E",
  },
  previewRecovery: {
    path: ".github/workflows/d1-recovery-rehearsal.yml",
    label: "D1 Preview Recovery Rehearsal",
  },
  previewPerformance: {
    path: ".github/workflows/d1-performance-benchmark.yml",
    label: "D1 Preview Performance Benchmark",
  },
});

const capabilityPolicies = Object.freeze({
  runtimeHttpSecurity: {
    label: "Shared Runtime / HTTP / Security",
    paths: [
      "src/shared/runtime",
      "src/worker.ts",
      "docs/SECURITY_HEADERS.md",
      "docs/BOUNDARY_TESTING.md",
    ],
    verificationWorkflow: "ci",
  },
  dataMigrationSchema: {
    label: "Data / Migration / Schema",
    paths: [
      "migrations",
      "scripts/production-migration-workflow.mjs",
      "scripts/verify-production-schema.mjs",
      "docs/DATA_DESIGN.md",
    ],
    verificationWorkflow: "ci",
  },
  authAuthorizationIntegrityAudit: {
    label: "Auth / Authorization / Integrity / Audit",
    paths: [
      "src/worker/auth",
      "src/worker/authorization",
      "src/worker/audit",
      "docs/AUTH_DESIGN.md",
      "docs/AUTHORIZATION_DESIGN.md",
      "docs/RUNTIME_INTEGRITY.md",
      "docs/AUDIT_OBSERVABILITY.md",
    ],
    verificationWorkflow: "ci",
  },
  apiGovernance: {
    label: "API Contract / Collection Query / Versioning",
    paths: [
      "src/shared/api/collection-query.ts",
      "src/shared/api/versioning.ts",
      "docs/API_GOVERNANCE.md",
    ],
    verificationWorkflow: "ci",
  },
  frontendBrowserSafety: {
    label: "Frontend Shell / Browser E2E",
    paths: [
      "src/frontend",
      "e2e",
      "playwright.config.ts",
      ".github/workflows/browser-e2e.yml",
    ],
    verificationWorkflow: "browserE2E",
  },
  recoverySafety: {
    label: "Recovery Safety",
    paths: [
      "scripts/validate-recovery-safety.mjs",
      "scripts/d1-recovery-rehearsal.sh",
      ".github/workflows/d1-recovery-rehearsal.yml",
      "docs/RECOVERY_OPERATIONS.md",
    ],
    verificationWorkflow: "ci",
  },
  performanceSafety: {
    label: "Performance Safety",
    paths: [
      "scripts/validate-performance-safety.mjs",
      "scripts/d1-performance-benchmark.mjs",
      ".github/workflows/d1-performance-benchmark.yml",
      "docs/PERFORMANCE_CAPACITY.md",
    ],
    verificationWorkflow: "ci",
  },
  productionDelivery: {
    label: "Production Delivery / Release Evidence",
    paths: [
      ".github/workflows/production-deploy.yml",
      ".github/workflows/production-migration.yml",
      ".github/workflows/production-smoke.yml",
      ".github/workflows/production-rollback.yml",
      "scripts/release-evidence-bundle.mjs",
      "docs/operations/RELEASE_EVIDENCE_BUNDLE.md",
    ],
    verificationWorkflow: null,
  },
  supplyChain: {
    label: "Supply-chain Security",
    paths: [
      ".github/workflows/dependency-vulnerability.yml",
      ".github/workflows/secret-detection.yml",
      ".github/workflows/sbom.yml",
      ".github/workflows/license-inventory.yml",
      ".github/dependabot.yml",
      "docs/DEPENDENCY_UPDATE_POLICY.md",
    ],
    verificationWorkflow: null,
  },
});

const parseArgs = argv => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--self-test") {
      args.selfTest = true;
      continue;
    }
    if (!["--repository", "--target-sha", "--output", "--release-evidence"].includes(value)) {
      throw new Error(`Unknown argument: ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    args[value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
    index += 1;
  }
  return args;
};

const runGit = args => {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : "";
};

const deriveWorkflowEvidenceSha = targetSha => {
  if (!SHA_PATTERN.test(targetSha)) return { sha: targetSha, source: "target" };
  const line = runGit(["rev-list", "--parents", "-n", "1", targetSha]);
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts.length !== 3) return { sha: targetSha, source: "target" };

  const secondParent = parts[2];
  const targetTree = runGit(["rev-parse", `${targetSha}^{tree}`]);
  const secondParentTree = runGit(["rev-parse", `${secondParent}^{tree}`]);
  if (SHA_PATTERN.test(secondParent) && targetTree && targetTree === secondParentTree) {
    return {
      sha: secondParent,
      source: "merge-second-parent",
      reason: "target merge commit tree matches the merged PR head tree",
    };
  }
  return { sha: targetSha, source: "target" };
};

const fileExists = (root, relativePath) => fs.existsSync(path.join(root, relativePath));

const inspectRepositoryCapabilities = root => Object.fromEntries(
  Object.entries(capabilityPolicies).map(([key, policy]) => {
    const missingPaths = policy.paths.filter(relativePath => !fileExists(root, relativePath));
    return [key, {
      label: policy.label,
      status: missingPaths.length === 0 ? "present" : "missing",
      requiredPaths: [...policy.paths],
      missingPaths,
      verificationWorkflow: policy.verificationWorkflow,
    }];
  }),
);

const boundedJsonFetch = async (url, token) => {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("github_response_too_large");

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) throw new Error("github_response_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const collectWorkflowRuns = async ({ repository, evidenceSha, token }) => {
  if (!token) {
    return { available: false, reason: "github_token_not_available", runs: [] };
  }
  try {
    const encodedSha = encodeURIComponent(evidenceSha);
    const data = await boundedJsonFetch(
      `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodedSha}&per_page=100`,
      token,
    );
    if (!Array.isArray(data.workflow_runs)) throw new Error("invalid_github_response");
    return { available: true, runs: data.workflow_runs };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "github_evidence_unavailable",
      runs: [],
    };
  }
};

const workflowReference = (repository, run) => ({
  runId: Number(run.id),
  url: `https://github.com/${repository}/actions/runs/${run.id}`,
  headSha: run.head_sha,
  event: run.event,
});

const classifyWorkflow = ({ repository, runs, available, unavailableReason, policy }) => {
  if (!available) return { status: "unverified", reason: unavailableReason ?? "github_evidence_unavailable" };
  const matches = runs
    .filter(run => run?.path === policy.path)
    .sort((left, right) => Date.parse(right.created_at ?? 0) - Date.parse(left.created_at ?? 0));
  const run = matches[0];
  if (!run) return { status: "unverified", reason: "workflow_run_not_found_for_evidence_sha" };

  const reference = workflowReference(repository, run);
  if (run.status !== "completed") return { status: "pending", reason: "workflow_not_completed", ...reference };
  if (run.conclusion === "success") return { status: "verified", ...reference };
  if (["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(run.conclusion)) {
    return { status: "failed", reason: `workflow_${run.conclusion}`, ...reference };
  }
  return { status: "unverified", reason: `workflow_${run.conclusion ?? "unknown"}`, ...reference };
};

const readPackageVersion = root => {
  const value = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return typeof value.version === "string" && value.version.length > 0 ? value.version : null;
};

const readReleaseEvidence = filename => {
  if (!filename) return null;
  try {
    const value = JSON.parse(fs.readFileSync(filename, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

const classifyProductionEvidence = (releaseEvidence, targetSha) => {
  if (!releaseEvidence) {
    return {
      status: "unverified",
      reason: "release_bound_production_evidence_not_supplied",
    };
  }
  const requiredChecks = ["deploy", "security", "smoke", "migration", "schema"];
  const checks = releaseEvidence.checks;
  const valid = releaseEvidence.schemaVersion === 1
    && releaseEvidence.environment === "production"
    && releaseEvidence.deployedSha === targetSha
    && releaseEvidence.evidenceStatus === "complete"
    && checks && typeof checks === "object"
    && requiredChecks.every(name => checks[name]?.status === "verified");
  if (!valid) {
    return {
      status: "unverified",
      reason: "release_evidence_incomplete_or_target_mismatch",
    };
  }
  return {
    status: "verified",
    releaseId: typeof releaseEvidence.releaseId === "string" ? releaseEvidence.releaseId : null,
    deployedSha: releaseEvidence.deployedSha,
    generatedAt: typeof releaseEvidence.generatedAt === "string" ? releaseEvidence.generatedAt : null,
  };
};

const capabilityStatus = (repositoryCapability, workflowStatuses) => {
  if (repositoryCapability.status !== "present") {
    return { status: "missing", reason: "repository_capability_incomplete" };
  }
  const workflowKey = repositoryCapability.verificationWorkflow;
  if (!workflowKey) return { status: "implemented", reason: "repository_presence_only" };
  const workflow = workflowStatuses[workflowKey];
  if (!workflow) return { status: "unverified", reason: "verification_workflow_not_classified" };
  if (workflow.status === "verified") return { status: "verified", evidence: workflow };
  if (workflow.status === "failed") return { status: "failed", evidence: workflow };
  if (workflow.status === "pending") return { status: "pending", evidence: workflow };
  return { status: "implemented", reason: "repository_present_but_exact_sha_ci_unverified", evidence: workflow };
};

const aggregatePreviewStatus = workflowStatuses => {
  const recovery = workflowStatuses.previewRecovery;
  const performance = workflowStatuses.previewPerformance;
  if ([recovery, performance].some(value => value?.status === "failed")) {
    return { status: "failed", recovery, performance };
  }
  if (recovery?.status === "verified" && performance?.status === "verified") {
    return { status: "verified", recovery, performance };
  }
  return {
    status: "unverified",
    reason: "one_or_more_preview_remote_checks_unverified",
    recovery,
    performance,
  };
};

const buildStatus = ({
  repository,
  targetSha,
  evidenceSha,
  evidenceShaSource,
  packageVersion,
  repositoryCapabilities,
  workflowStatuses,
  releaseEvidence,
  generatedAt,
}) => {
  const capabilities = Object.fromEntries(
    Object.entries(repositoryCapabilities).map(([key, value]) => [key, {
      label: value.label,
      repository: {
        status: value.status,
        missingPaths: value.missingPaths,
      },
      verification: capabilityStatus(value, workflowStatuses),
    }]),
  );

  const unverifiedChecks = [];
  for (const [key, value] of Object.entries(capabilities)) {
    if (!["verified", "implemented"].includes(value.verification.status)) {
      unverifiedChecks.push(`capability:${key}:${value.verification.status}`);
    } else if (value.verification.status === "implemented") {
      unverifiedChecks.push(`capability:${key}:execution_not_verified_for_exact_evidence_sha`);
    }
  }

  const preview = aggregatePreviewStatus(workflowStatuses);
  if (preview.status !== "verified") unverifiedChecks.push(`preview:${preview.status}`);
  const production = classifyProductionEvidence(releaseEvidence, targetSha);
  if (production.status !== "verified") unverifiedChecks.push(`production:${production.status}`);

  const repositoryComplete = Object.values(repositoryCapabilities).every(value => value.status === "present");
  return {
    schemaVersion: 1,
    authoritative: false,
    generatedAt,
    repository,
    targetSha,
    evidenceSha,
    evidenceShaSource,
    packageVersion,
    summary: {
      baselineImplementation: repositoryComplete ? "implemented" : "incomplete",
      exactShaCi: workflowStatuses.ci?.status ?? "unverified",
      browserE2E: workflowStatuses.browserE2E?.status ?? "unverified",
      previewRemote: preview.status,
      production: production.status,
    },
    capabilities,
    workflowEvidence: workflowStatuses,
    preview,
    production,
    unverifiedChecks,
    sourceOfTruth: {
      kind: "derived-view",
      note: "This document is regenerated from repository and GitHub evidence and is never authoritative state.",
    },
  };
};

const writeOutput = (filename, value) => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!filename) {
    process.stdout.write(serialized);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  fs.writeFileSync(filename, serialized, "utf8");
};

const selfTest = () => {
  const repository = "fixture/repository";
  const sha = "a".repeat(40);
  const successRun = (id, workflowPath) => ({
    id,
    path: workflowPath,
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    event: "pull_request",
    created_at: "2026-10-03T00:00:00Z",
  });
  const failedRun = {
    ...successRun(2, workflowPolicies.ci.path),
    conclusion: "failure",
    created_at: "2026-10-03T01:00:00Z",
  };

  assert.equal(classifyWorkflow({
    repository,
    runs: [successRun(1, workflowPolicies.ci.path)],
    available: true,
    policy: workflowPolicies.ci,
  }).status, "verified");
  assert.equal(classifyWorkflow({
    repository,
    runs: [successRun(1, workflowPolicies.ci.path), failedRun],
    available: true,
    policy: workflowPolicies.ci,
  }).status, "failed");
  assert.equal(classifyWorkflow({
    repository,
    runs: [],
    available: true,
    policy: workflowPolicies.browserE2E,
  }).status, "unverified");

  const repositoryCapabilities = Object.fromEntries(
    Object.entries(capabilityPolicies).map(([key, value]) => [key, {
      label: value.label,
      status: "present",
      missingPaths: [],
      verificationWorkflow: value.verificationWorkflow,
    }]),
  );
  const workflowStatuses = {
    ci: { status: "verified" },
    browserE2E: { status: "verified" },
    previewRecovery: { status: "unverified", reason: "not_run" },
    previewPerformance: { status: "unverified", reason: "not_run" },
  };
  const withoutProduction = buildStatus({
    repository,
    targetSha: sha,
    evidenceSha: sha,
    evidenceShaSource: "target",
    packageVersion: "0.1.0",
    repositoryCapabilities,
    workflowStatuses,
    releaseEvidence: null,
    generatedAt: "2026-10-03T00:00:00Z",
  });
  assert.equal(withoutProduction.authoritative, false);
  assert.equal(withoutProduction.summary.baselineImplementation, "implemented");
  assert.equal(withoutProduction.production.status, "unverified");
  assert.equal(withoutProduction.preview.status, "unverified");

  const verifiedRelease = {
    schemaVersion: 1,
    releaseId: "release-1",
    environment: "production",
    deployedSha: sha,
    evidenceStatus: "complete",
    generatedAt: "2026-10-03T00:00:00Z",
    checks: Object.fromEntries(["deploy", "security", "smoke", "migration", "schema"].map(key => [key, { status: "verified" }])),
  };
  assert.equal(classifyProductionEvidence(verifiedRelease, sha).status, "verified");
  assert.equal(classifyProductionEvidence({ ...verifiedRelease, deployedSha: "b".repeat(40) }, sha).status, "unverified");

  console.log("runtime-evidence-status self-test: ok");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
    return;
  }

  const root = process.cwd();
  const repository = args.repository ?? process.env.GITHUB_REPOSITORY;
  const targetSha = args.targetSha ?? process.env.GITHUB_SHA ?? runGit(["rev-parse", "HEAD"]);
  if (!repository || !REPOSITORY_PATTERN.test(repository)) throw new Error("repository must be owner/name");
  if (!targetSha || !SHA_PATTERN.test(targetSha)) throw new Error("target SHA must be a 40-character lowercase commit SHA");

  const evidence = deriveWorkflowEvidenceSha(targetSha);
  const repositoryCapabilities = inspectRepositoryCapabilities(root);
  const runCollection = await collectWorkflowRuns({
    repository,
    evidenceSha: evidence.sha,
    token: process.env.GITHUB_TOKEN,
  });

  const workflowStatuses = Object.fromEntries(
    Object.entries(workflowPolicies).map(([key, policy]) => [key, classifyWorkflow({
      repository,
      runs: runCollection.runs,
      available: runCollection.available,
      unavailableReason: runCollection.reason,
      policy,
    })]),
  );

  const status = buildStatus({
    repository,
    targetSha,
    evidenceSha: evidence.sha,
    evidenceShaSource: evidence,
    packageVersion: readPackageVersion(root),
    repositoryCapabilities,
    workflowStatuses,
    releaseEvidence: readReleaseEvidence(args.releaseEvidence),
    generatedAt: new Date().toISOString(),
  });
  writeOutput(args.output, status);
};

await main();
