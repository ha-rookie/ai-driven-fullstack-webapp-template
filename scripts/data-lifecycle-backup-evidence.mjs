import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const VALID_ENVIRONMENTS = new Set(["local", "preview", "production"]);

function parseNonNegativeInteger(value, name) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function sha256File(file) {
  const content = await readFile(file);
  return createHash("sha256").update(content).digest("hex");
}

export async function createBackupEvidence({
  file,
  environment,
  capturedAt,
  source,
  recordCount = null,
  sourceRevision = null
}) {
  if (!file) throw new Error("file is required");
  if (!VALID_ENVIRONMENTS.has(environment)) {
    throw new Error("environment must be local, preview, or production");
  }
  if (!source || !source.trim()) throw new Error("source is required");

  const captured = new Date(capturedAt);
  if (!capturedAt || Number.isNaN(captured.getTime())) {
    throw new Error("capturedAt must be an ISO-8601 date/time");
  }

  const info = await stat(file);
  if (!info.isFile()) throw new Error("backup evidence input must be a file");

  const sha256 = await sha256File(file);

  return {
    schemaVersion: 1,
    environment,
    capturedAt: captured.toISOString(),
    source: source.trim(),
    sourceRevision: sourceRevision?.trim() || null,
    artifactName: basename(file),
    byteLength: info.size,
    sha256,
    recordCount,
    recordCountStatus: recordCount === null ? "not-measured" : "recorded",
    containsBackupPayload: false
  };
}

export async function verifyBackupEvidence({ file, manifest }) {
  if (!manifest || manifest.schemaVersion !== 1) {
    return ["manifest.schemaVersion must be 1"];
  }
  if (manifest.containsBackupPayload !== false) {
    return ["manifest.containsBackupPayload must be false"];
  }

  const errors = [];
  const info = await stat(file);
  const sha256 = await sha256File(file);

  if (manifest.byteLength !== info.size) {
    errors.push(`byteLength mismatch: expected ${manifest.byteLength}, actual ${info.size}`);
  }
  if (manifest.sha256 !== sha256) {
    errors.push("sha256 mismatch");
  }
  if (manifest.artifactName !== basename(file)) {
    errors.push("artifactName mismatch");
  }

  return errors;
}

async function runSelfTest() {
  const root = await mkdtemp(join(tmpdir(), "data-lifecycle-evidence-"));
  try {
    const backup = join(root, "example.sql");
    const manifestFile = join(root, "manifest.json");
    await writeFile(backup, "CREATE TABLE example(id INTEGER);\nINSERT INTO example VALUES (1);\n");

    const manifest = await createBackupEvidence({
      file: backup,
      environment: "preview",
      capturedAt: "2026-10-03T00:00:00Z",
      source: "self-test-export",
      recordCount: 1,
      sourceRevision: "self-test"
    });

    if (manifest.containsBackupPayload !== false) {
      throw new Error("manifest must never claim to contain backup payload");
    }
    if (JSON.stringify(manifest).includes("CREATE TABLE")) {
      throw new Error("manifest leaked backup content");
    }

    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    const loaded = JSON.parse(await readFile(manifestFile, "utf8"));
    const verificationErrors = await verifyBackupEvidence({ file: backup, manifest: loaded });
    if (verificationErrors.length > 0) {
      throw new Error(`expected evidence verification to pass: ${verificationErrors.join("; ")}`);
    }

    await writeFile(backup, "tampered\n");
    const tamperedErrors = await verifyBackupEvidence({ file: backup, manifest: loaded });
    if (!tamperedErrors.some((error) => error.includes("sha256 mismatch"))) {
      throw new Error("tampered backup was not detected");
    }

    console.log("data lifecycle backup evidence self-test: ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createCommand(args) {
  const file = getArg(args, "--file");
  const environment = getArg(args, "--environment");
  const capturedAt = getArg(args, "--captured-at");
  const source = getArg(args, "--source");
  const sourceRevision = getArg(args, "--source-revision") ?? null;
  const recordCount = parseNonNegativeInteger(getArg(args, "--record-count"), "--record-count");

  if (environment === "production" && !args.includes("--ack-production-metadata-only")) {
    throw new Error("production evidence requires --ack-production-metadata-only; this utility does not create, upload, or restore backups");
  }

  const manifest = await createBackupEvidence({
    file,
    environment,
    capturedAt,
    source,
    sourceRevision,
    recordCount
  });

  const requestedOutput = getArg(args, "--output");
  const timestamp = manifest.capturedAt.replaceAll(":", "-");
  const output = resolve(requestedOutput ?? `artifacts/data-lifecycle/backup-evidence-${environment}-${timestamp}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(`backup evidence manifest created: ${output}`);
}

async function verifyCommand(args) {
  const file = getArg(args, "--file");
  const manifestFile = getArg(args, "--manifest");
  if (!file || !manifestFile) {
    throw new Error("--verify requires --file and --manifest");
  }

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const errors = await verifyBackupEvidence({ file, manifest });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`backup evidence verified: ${manifestFile}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await runSelfTest();
    return;
  }
  if (args.includes("--create")) {
    await createCommand(args);
    return;
  }
  if (args.includes("--verify")) {
    await verifyCommand(args);
    return;
  }
  throw new Error("use --create, --verify, or --self-test");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
