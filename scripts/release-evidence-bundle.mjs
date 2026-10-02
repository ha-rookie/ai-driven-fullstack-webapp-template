import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const numericId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const safeActor = value => typeof value === "string" && /^[A-Za-z0-9-]{1,39}(?:\[bot\])?$/.test(value);
const migrationName = value => typeof value === "string" && /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(value);
const timestamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const maxBytes = 8 * 1024 * 1024;
const maxJsonBytes = 2 * 1024 * 1024;
const policies = {
  deploy: { workflow: ".github/workflows/production-deploy.yml", job: "deploy",
    steps: ["Verify checked out SHA after Human Gate", "Deploy exact SHA to Production", "Record deploy evidence"], file: "production-deploy.json" },
  smoke: { workflow: ".github/workflows/production-smoke.yml", job: "smoke",
    steps: ["Run bounded Production smoke verification"], file: "production-smoke.json" },
  migration: { workflow: ".github/workflows/production-migration.yml", job: "migrate-production",
    steps: ["Re-run preflight against current Production state", "Apply pending migrations to Production D1", "Capture and verify post-migration schema"],
    file: "production-migration.json" },
  rollback: { workflow: ".github/workflows/production-rollback.yml", job: "rollback",
    steps: ["Reverify Production schema compatibility", "Validate Production security configuration", "Deploy exact rollback target", "Run bounded post-rollback smoke verification"],
    file: "production-rollback.json" },
};
const success = item => item?.status === "completed" && item?.conclusion === "success";
const stepOf = (source, name) => source.jobs?.find(job => job.name === source.policy.job)?.steps?.find(step => step.name === name);
const references = (source, repository) => {
  if (!source?.run || !numericId(source.run.id)) return {};
  const job = source.jobs?.find(item => item.name === source.policy?.job);
  return { runId: Number(source.run.id), runUrl: `https://github.com/${repository}/actions/runs/${source.run.id}`,
    ...(numericId(job?.id) ? { jobId: Number(job.id), jobUrl: `https://github.com/${repository}/actions/runs/${source.run.id}/job/${job.id}` } : {}),
    ...(numericId(source.artifact?.id) ? { artifactId: Number(source.artifact.id),
      artifactUrl: `https://github.com/${repository}/actions/runs/${source.run.id}/artifacts/${source.artifact.id}` } : {}),
    ...(sha(source.run.head_sha) ? { workflowSha: source.run.head_sha } : {}) };
};

// Read exactly one named JSON entry, without extracting any archive path to disk.
const namedJson = (archive, filename) => {
  if (!Buffer.isBuffer(archive) || archive.length > maxBytes || archive.length < 22) throw Error("invalid_archive");
  let end = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || archive.readUInt16LE(end + 4) || archive.readUInt16LE(end + 6)) throw Error("invalid_archive");
  const count = archive.readUInt16LE(end + 10), directorySize = archive.readUInt32LE(end + 12);
  let offset = archive.readUInt32LE(end + 16), selected;
  const directoryEnd = offset + directorySize;
  if (count > 1000 || directoryEnd > end) throw Error("invalid_archive");
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > directoryEnd || archive.readUInt32LE(offset) !== 0x02014b50) throw Error("invalid_archive");
    const flags = archive.readUInt16LE(offset + 8), method = archive.readUInt16LE(offset + 10);
    const packed = archive.readUInt32LE(offset + 20), unpacked = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw Error("invalid_archive");
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.split("/").pop() === filename) {
      if (selected || name.includes("\\") || name.split("/").includes("..") || name.startsWith("/") || (flags & 1) ||
        ![0, 8].includes(method) || unpacked > maxJsonBytes || packed > maxBytes) throw Error("invalid_archive");
      const local = archive.readUInt32LE(offset + 42);
      if (local + 30 > archive.length || archive.readUInt32LE(local) !== 0x04034b50) throw Error("invalid_archive");
      const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      if (dataStart + packed > archive.length) throw Error("invalid_archive");
      const bytes = archive.subarray(dataStart, dataStart + packed);
      const data = method === 0 ? bytes : inflateRawSync(bytes, { maxOutputLength: maxJsonBytes });
      if (data.length !== unpacked) throw Error("invalid_archive");
      selected = JSON.parse(data.toString("utf8"));
    }
    offset = next;
  }
  if (offset !== directoryEnd || !selected || typeof selected !== "object" || Array.isArray(selected)) throw Error("producer_file_missing");
  return selected;
};

const boundedFetch = async (url, token) => {
  const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok || Number(response.headers.get("content-length")) > maxBytes) throw Error("github_evidence_unavailable");
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw Error("github_evidence_unavailable");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const collect = async (repository, id, kind, deployedSha, token) => {
  const policy = policies[kind];
  const source = { policy, requestedRunId: Number(id) };
  if (!id) return { ...source, error: "run_not_supplied" };
  const base = `https://api.github.com/repos/${repository}/actions/runs/${id}`;
  try {
    source.run = JSON.parse((await boundedFetch(base, token)).toString("utf8"));
    if (source.run.id !== Number(id) || source.run.repository?.full_name !== repository || source.run.path !== policy.workflow ||
      source.run.event !== "workflow_dispatch") return { ...source, error: "producer_mismatch" };
    const paged = async (suffix, key) => {
      const values = [];
      for (let page = 1; page <= 10; page++) {
        const data = JSON.parse((await boundedFetch(`${base}/${suffix}?per_page=100&page=${page}`, token)).toString("utf8"));
        if (!Array.isArray(data[key])) throw Error("github_evidence_unavailable");
        values.push(...data[key]);
        if (values.length >= data.total_count) return values;
      }
      throw Error("github_evidence_unavailable");
    };
    source.jobs = await paged("jobs", "jobs");
    const artifacts = await paged("artifacts", "artifacts");
    const expected = kind === "deploy" ? `production-deploy-evidence-${deployedSha}` : kind === "smoke" ? `production-smoke-${deployedSha}`
      : kind === "migration" ? `production-migration-result-${id}` : null;
    const candidates = artifacts.filter(a => expected ? a.name === expected : /^production-rollback-evidence-[a-f0-9]{40}$/.test(a.name));
    if (candidates.length !== 1) return { ...source, error: "artifact_missing_or_ambiguous" };
    source.artifact = candidates[0];
    if (!numericId(source.artifact.id) || source.artifact.expired || !/^sha256:[a-f0-9]{64}$/.test(source.artifact.digest ?? "")) {
      return { ...source, error: "artifact_unavailable" };
    }
    const archive = await boundedFetch(`https://api.github.com/repos/${repository}/actions/artifacts/${source.artifact.id}/zip`, token);
    if ("sha256:" + createHash("sha256").update(archive).digest("hex") !== source.artifact.digest) return { ...source, error: "artifact_integrity_mismatch" };
    source.payload = namedJson(archive, policy.file);
    return source;
  } catch { return { ...source, error: "github_evidence_unavailable" }; }
};

const assess = (source, repository) => {
  const refs = references(source, repository);
  if (!source?.run) return { status: "unverified", reason: source?.error ?? "run_not_supplied", ...refs };
  if (source.run.repository?.full_name !== repository || source.run.id !== source.requestedRunId ||
    source.run.path !== source.policy.workflow || source.run.event !== "workflow_dispatch") return { status: "unverified", reason: "producer_mismatch", ...refs };
  if (source.run.status === "completed" && ["failure", "cancelled", "timed_out"].includes(source.run.conclusion)) {
    return { status: "failed", reason: "producer_failed", ...refs };
  }
  if (source.error || source.artifact?.expired || !source.payload) return { status: "unverified", reason: source.error ?? "artifact_unavailable", ...refs };
  if (!success(source.run) || !success(source.jobs.find(j => j.name === source.policy.job)) ||
    !source.policy.steps.every(name => success(stepOf(source, name)))) return { status: "unverified", reason: "required_steps_not_verified", ...refs };
  return { status: "verified", ...refs };
};

const buildBundle = (request, sources, generatedAt) => {
  const { repository, deployedSha } = request;
  const checks = {};
  const checked = (kind, valid) => {
    const result = assess(sources[kind], repository);
    return result.status === "verified" && !valid ? { ...result, status: "unverified", reason: "release_binding_mismatch" } : result;
  };
  const deploy = sources.deploy?.payload;
  const deployStep = sources.deploy && stepOf(sources.deploy, "Deploy exact SHA to Production");
  checks.deploy = checked("deploy", deploy?.targetSha === deployedSha && deploy.environment === "production" && deploy.status === "deployed" &&
    String(deploy.workflowRunId) === String(sources.deploy.run?.id) && safeActor(sources.deploy.run.actor?.login) && timestamp(deployStep?.completed_at));
  checks.security = checks.deploy.status === "verified" && success(stepOf(sources.deploy, "Revalidate Production security configuration"))
    ? { status: "verified", ...references(sources.deploy, repository) } : { status: "unverified", reason: "production_validation_not_verified" };
  const smoke = sources.smoke?.payload;
  const required = [{ id: "root", status: 200 }, { id: "liveness", status: 200 }, { id: "readiness", status: 200 }, { id: "unauthenticated-boundary", status: 401 }];
  const validSmoke = value => value?.schemaVersion === 1 && value.environment === "production" && value.deployedSha === deployedSha && value.ok === true &&
    Array.isArray(value.results) && required.every(check => value.results.filter(r => r.id === check.id).length === 1 &&
      value.results.some(r => r.id === check.id && r.ok === true && r.status === check.status));
  checks.smoke = checked("smoke", validSmoke(smoke));
  if (checks.smoke.status === "verified") checks.smoke.authenticatedCheck =
    smoke.authenticatedCheckExecuted === true && smoke.results.some(r => r.id === "authenticated-boundary" && r.ok === true && r.status === 200) ? "verified" : "unverified";
  const migration = sources.migration?.payload;
  const validMigration = migration?.schemaVersion === 1 && migration.targetSha === deployedSha && migration.environment === "production" &&
    String(migration.workflowRunId) === String(sources.migration.run?.id) && migration.schemaVerified === true &&
    Array.isArray(migration.appliedMigrations) && migration.appliedMigrations.length > 0 && migration.appliedMigrations.length < 10000 &&
    migration.appliedMigrations.every(migrationName) && new Set(migration.appliedMigrations).size === migration.appliedMigrations.length;
  checks.migration = checked("migration", validMigration);
  checks.schema = { ...checks.migration };
  if (checks.migration.status === "verified") checks.migration.appliedMigrations = [...migration.appliedMigrations];
  const rollback = sources.rollback?.payload;
  const validRollback = rollback?.environment === "production" && rollback.currentDeployedSha === deployedSha && sha(rollback.targetSha) &&
    sha(rollback.previousStableSha) && rollback.targetSha === rollback.previousStableSha && rollback.targetSha !== deployedSha &&
    String(rollback.workflowRunId) === String(sources.rollback.run?.id) && rollback.status === "rolled_back_and_smoke_verified" && rollback.dataRestorePerformed === false;
  checks.rollbackStableMarker = checked("rollback", validRollback);
  if (checks.rollbackStableMarker.status === "verified") Object.assign(checks.rollbackStableMarker, {
    targetSha: rollback.targetSha, previousStableSha: rollback.previousStableSha, dataRestorePerformed: false });
  const remainingUnverified = Object.entries(checks).filter(([, check]) => check.status !== "verified").map(([name]) => name);
  const requiredComplete = ["deploy", "security", "smoke", "migration", "schema"].every(name => checks[name].status === "verified");
  return { schemaVersion: 1, releaseId: request.releaseId, repository, deployedSha, environment: "production", generatedAt,
    ...(checks.deploy.status === "verified" ? { actor: sources.deploy.run.actor.login, deployedAt: deployStep.completed_at } : {}),
    evidenceStatus: requiredComplete ? "complete" : "incomplete",
    checks, remainingUnverified, supplyChain: sources.supplyChain ?? [] };
};

const writeJson = (output, value) => {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(value, null, 2) + "\n");
};

const selfTest = async () => {
  const request = { repository: "fixture/repository", deployedSha: "a".repeat(40), releaseId: "fixture-001" };
  const make = (kind, id, payload) => ({ policy: policies[kind], requestedRunId: id,
    run: { id, repository: { full_name: request.repository }, path: policies[kind].workflow, event: "workflow_dispatch", status: "completed", conclusion: "success",
      actor: { login: "fixture-operator", email: "never-copy" }, head_sha: "c".repeat(40) },
    jobs: [{ name: policies[kind].job, id: id + 100, status: "completed", conclusion: "success",
      steps: [...policies[kind].steps, "Revalidate Production security configuration"].map(name => ({ name, status: "completed", conclusion: "success", completed_at: "2026-10-02T00:00:00Z" })) }],
    artifact: { id: id + 200, expired: false }, payload });
  const sources = { deploy: make("deploy", 1, { targetSha: request.deployedSha, workflowRunId: "1", environment: "production", status: "deployed", token: "never-copy" }),
    smoke: make("smoke", 2, { schemaVersion: 1, deployedSha: request.deployedSha, environment: "production", ok: true, origin: "https://never-copy.test/secret",
      results: ["root", "liveness", "readiness", "unauthenticated-boundary"].map(id => ({ id, ok: true, status: id === "unauthenticated-boundary" ? 401 : 200 })) }),
    migration: make("migration", 3, { schemaVersion: 1, environment: "production", targetSha: request.deployedSha, workflowRunId: "3", schemaVerified: true,
      appliedMigrations: ["0001_core.sql"], databaseId: "never-copy" }),
    rollback: make("rollback", 4, { environment: "production", currentDeployedSha: request.deployedSha, targetSha: "b".repeat(40), previousStableSha: "b".repeat(40),
      workflowRunId: "4", status: "rolled_back_and_smoke_verified", dataRestorePerformed: false, reason: "never-copy" }) };
  const valid = buildBundle(request, sources, "2026-10-02T00:00:00Z");
  assert.equal(valid.evidenceStatus, "complete"); assert.equal(valid.checks.smoke.authenticatedCheck, "unverified");
  assert.equal(JSON.stringify(valid).includes("never-copy"), false);
  assert.equal(buildBundle(request, {}, "2026-10-02T00:00:00Z").evidenceStatus, "incomplete");
  for (const corrupt of [s => { s.deploy.payload.targetSha = "d".repeat(40); }, s => { s.smoke.payload.environment = "preview"; },
    s => { s.deploy.run.repository.full_name = "foreign/repository"; }, s => { s.smoke.run.conclusion = "failure"; },
    s => { s.migration.payload.schemaVerified = false; }, s => { s.deploy.artifact.expired = true; },
    s => { s.deploy.jobs[0].steps[0].conclusion = "skipped"; }, s => { s.migration.payload.appliedMigrations = ["secret\n.sql"]; }]) {
    const copy = structuredClone(sources); corrupt(copy);
    assert.equal(buildBundle(request, copy, "2026-10-02T00:00:00Z").evidenceStatus, "incomplete");
  }
  const wrongRollback = structuredClone(sources); wrongRollback.rollback.payload.workflowRunId = "999";
  assert.equal(buildBundle(request, wrongRollback, "2026-10-02T00:00:00Z").checks.rollbackStableMarker.status, "unverified");
  const noRollback = { ...sources, rollback: undefined };
  assert.equal(buildBundle(request, noRollback, "2026-10-02T00:00:00Z").evidenceStatus, "complete");
  assert.equal(buildBundle(request, noRollback, "2026-10-02T00:00:00Z").checks.rollbackStableMarker.status, "unverified");
  assert.throws(() => namedJson(Buffer.alloc(30), "production-deploy.json"));
  const makeZip = (name, content, method = 0) => {
    const n = Buffer.from(name), d = Buffer.from(content), packed = method === 8 ? deflateRawSync(d) : d;
    const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(d.length, 22); local.writeUInt16LE(n.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(method, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(d.length, 24); central.writeUInt16LE(n.length, 28);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + packed.length, 16);
    return Buffer.concat([local, n, packed, central, n, end]);
  };
  assert.deepEqual(namedJson(makeZip("production-deploy.json", '{"ok":true}'), "production-deploy.json"), { ok: true });
  assert.deepEqual(namedJson(makeZip("production-deploy.json", '{"ok":true}', 8), "production-deploy.json"), { ok: true });
  assert.throws(() => namedJson(makeZip("../production-deploy.json", '{}'), "production-deploy.json"));
  const originalFetch = globalThis.fetch;
  const archive = makeZip("production-deploy.json", JSON.stringify(sources.deploy.payload), 8);
  let expired = false, digestValid = true;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push(url); assert.equal(options.method, "GET");
    if (url.endsWith("/zip")) return new Response(archive);
    const value = url.includes("/jobs?") ? { total_count: 1, jobs: sources.deploy.jobs } : url.includes("/artifacts?")
      ? { total_count: 1, artifacts: [{ id: 201, name: `production-deploy-evidence-${request.deployedSha}`, expired,
        digest: "sha256:" + (digestValid ? createHash("sha256").update(archive).digest("hex") : "0".repeat(64)) }] } : sources.deploy.run;
    return new Response(JSON.stringify(value));
  };
  try {
    const collected = await collect(request.repository, "1", "deploy", request.deployedSha, "synthetic-read-token");
    assert.equal(assess(collected, request.repository).status, "verified");
    assert.equal(seen.length, 4); assert.ok(seen.every(url => url.startsWith("https://api.github.com/repos/fixture/repository/actions/")));
    expired = true;
    assert.equal(assess(await collect(request.repository, "1", "deploy", request.deployedSha, "synthetic-read-token"), request.repository).status, "unverified");
    expired = false; digestValid = false;
    assert.equal(assess(await collect(request.repository, "1", "deploy", request.deployedSha, "synthetic-read-token"), request.repository).status, "unverified");
  } finally { globalThis.fetch = originalFetch; }
  const workflow = fs.readFileSync(".github/workflows/release-evidence-bundle.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /pull_request:|push:|schedule:|CLOUDFLARE_|wrangler|environment: production|actions: write|contents: write/);
  assert.match(workflow, /actions: read/); assert.match(workflow, /contents: read/);
  const producer = fs.readFileSync(".github/workflows/production-migration.yml", "utf8");
  assert.ok(producer.indexOf("Record SHA-bound migration evidence") > producer.indexOf("Capture and verify post-migration schema"));
  console.log("Release evidence offline/self-test and read-only workflow contracts passed (no remote verification)");
};

const main = async () => {
  const args = new Map(process.argv.slice(2).map(arg => { const i = arg.indexOf("="); return i < 0 ? [arg, true] : [arg.slice(0, i), arg.slice(i + 1)]; }));
  if (args.has("--self-test")) return selfTest();
  const repository = args.get("--repository"), releaseId = args.get("--release-id"), deployedSha = args.get("--deployed-sha"), output = args.get("--output");
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    typeof releaseId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(releaseId) || !sha(deployedSha) || typeof output !== "string" || !output) throw Error("invalid_request");
  const runIds = Object.fromEntries(Object.keys(policies).map(kind => [kind, args.get(`--${kind}-run`)]));
  const supplyIds = String(args.get("--supply-runs") ?? "").split(",").filter(Boolean);
  if (!numericId(runIds.deploy) || Object.values(runIds).some(id => id && !numericId(id)) || supplyIds.length > 10 || supplyIds.some(id => !numericId(id))) throw Error("invalid_request");
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw Error("github_read_token_required");
  const sources = {};
  for (const kind of Object.keys(policies)) sources[kind] = await collect(repository, runIds[kind], kind, deployedSha, token);
  sources.supplyChain = [];
  const allowed = new Set(["ci.yml", "lockfile-integrity.yml", "dependency-vulnerability.yml", "secret-detection.yml", "sbom.yml", "license-inventory.yml"]);
  for (const id of supplyIds) {
    try {
      const run = JSON.parse((await boundedFetch(`https://api.github.com/repos/${repository}/actions/runs/${id}`, token)).toString("utf8"));
      sources.supplyChain.push({ runId: Number(id), runUrl: `https://github.com/${repository}/actions/runs/${id}`,
        status: run.id === Number(id) && run.repository?.full_name === repository && run.head_sha === deployedSha &&
          allowed.has(run.path?.replace(".github/workflows/", "")) && success(run) ? "verified" : "unverified" });
    } catch { sources.supplyChain.push({ runId: Number(id), status: "unverified", reason: "github_evidence_unavailable" }); }
  }
  const bundle = buildBundle({ repository, releaseId, deployedSha }, sources, new Date().toISOString());
  writeJson(output, bundle);
  console.log(`Release evidence bundle generated: ${bundle.evidenceStatus}`);
  if (bundle.evidenceStatus !== "complete") process.exitCode = 1;
};

main().catch(() => { console.error("Release evidence generation failed; no verification is claimed"); process.exitCode = 1; });
