import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "config/migration-preflight-policy.json"), "utf8"),
);

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=") || true];
  }),
);

const migrationNamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const compile = (items) => items.map((item) => new RegExp(item, "i"));
const destructivePatterns = compile(policy.destructivePatterns);
const reviewPatterns = compile(policy.reviewPatterns);

const listMigrations = (directory = path.join(root, policy.migrationDirectory)) =>
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(directory, name), "utf8"),
    }));

const validateMigrationSequence = (migrations) => {
  const errors = [];
  const numbers = [];
  const seen = new Set();
  for (const migration of migrations) {
    const match = migration.name.match(migrationNamePattern);
    if (!match) {
      errors.push(`invalid migration filename: ${migration.name}`);
      continue;
    }
    const number = Number(match[1]);
    if (seen.has(number)) errors.push(`duplicate migration number: ${match[1]}`);
    seen.add(number);
    numbers.push(number);
  }
  numbers.sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i += 1) {
    const gap = numbers[i] - numbers[i - 1] - 1;
    if (gap > policy.maxMigrationNumberGap) {
      errors.push(
        `migration sequence gap: ${String(numbers[i - 1]).padStart(4, "0")} -> ${String(numbers[i]).padStart(4, "0")}`,
      );
    }
  }
  return errors;
};

const inspectSql = (migration) => {
  const normalized = migration.sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ");
  const stopReasons = [];
  const reviewReasons = [];

  for (const pattern of destructivePatterns) {
    if (pattern.test(normalized)) stopReasons.push(`destructive SQL matched ${pattern.source}`);
  }

  const deleteStatements = normalized.match(/\bDELETE\s+FROM\b[^;]*(?:;|$)/gi) ?? [];
  for (const statement of deleteStatements) {
    if (!/\bWHERE\b/i.test(statement)) stopReasons.push("DELETE without WHERE");
  }

  for (const pattern of reviewPatterns) {
    if (pattern.test(normalized)) reviewReasons.push(`manual review matched ${pattern.source}`);
  }

  return { stopReasons, reviewReasons };
};

const isPlaceholder = (value) =>
  typeof value !== "string" ||
  value.trim() === "" ||
  policy.placeholderPatterns.some((marker) => value.toLowerCase().includes(marker.toLowerCase()));

const validateSnapshot = (snapshot, allMigrations) => {
  const errors = [];
  if (snapshot.environment !== policy.requiredEnvironment) {
    errors.push(`environment must be ${policy.requiredEnvironment}`);
  }
  if (isPlaceholder(snapshot.productionDatabaseId)) errors.push("productionDatabaseId is missing or placeholder");
  if (isPlaceholder(snapshot.previewDatabaseId)) errors.push("previewDatabaseId is missing or placeholder");
  if (
    !isPlaceholder(snapshot.productionDatabaseId) &&
    snapshot.productionDatabaseId === snapshot.previewDatabaseId
  ) {
    errors.push("Preview and Production database IDs must differ");
  }

  for (const evidenceKey of policy.requiredEvidence) {
    if (snapshot[evidenceKey] !== true) errors.push(`${evidenceKey} must be confirmed`);
  }

  if (!Array.isArray(snapshot.appliedMigrations)) errors.push("appliedMigrations must be an array");
  if (!Array.isArray(snapshot.verificationQueries) || snapshot.verificationQueries.length === 0) {
    errors.push("verificationQueries must define at least one row-count/aggregate/invariant check");
  }

  const names = new Set(allMigrations.map((migration) => migration.name));
  const applied = Array.isArray(snapshot.appliedMigrations) ? snapshot.appliedMigrations : [];
  for (const name of applied) {
    if (!names.has(name)) errors.push(`applied migration not found in repository: ${name}`);
  }
  const appliedSet = new Set(applied);
  const pending = allMigrations.filter((migration) => !appliedSet.has(migration.name));

  if (pending.length > 0 && !snapshot.previewEvidenceRef) {
    errors.push("pending migrations require previewEvidenceRef");
  }
  if (pending.length > 0 && !snapshot.recoveryPointRef) {
    errors.push("pending migrations require recoveryPointRef");
  }

  const contracts = snapshot.migrationContracts ?? {};
  const findings = [];
  for (const migration of pending) {
    const inspection = inspectSql(migration);
    const contract = contracts[migration.name];
    const requiresContract = inspection.reviewReasons.length > 0 || /\bUPDATE\b/i.test(migration.sql);
    if (requiresContract) {
      if (!contract || contract.reviewed !== true) {
        errors.push(`${migration.name}: review/backfill contract is required`);
      }
      if (!contract?.verification || !Array.isArray(contract.verification) || contract.verification.length === 0) {
        errors.push(`${migration.name}: verification contract is required`);
      }
    }
    for (const reason of inspection.stopReasons) {
      errors.push(`${migration.name}: STOP - ${reason}`);
    }
    findings.push({ name: migration.name, ...inspection });
  }

  return { errors, pending: pending.map((item) => item.name), findings };
};

const report = (result) => {
  console.log(`migration-preflight pending=${result.pending.length} status=${result.errors.length === 0 ? "PASS" : "STOP"}`);
  for (const name of result.pending) console.log(`pending: ${name}`);
  for (const finding of result.findings) {
    for (const reason of finding.reviewReasons) console.log(`review: ${finding.name}: ${reason}`);
  }
  for (const error of result.errors) console.error(`error: ${error}`);
};

const selfTest = () => {
  const repositoryMigrations = listMigrations();
  const sequenceErrors = validateMigrationSequence(repositoryMigrations);
  if (sequenceErrors.length) throw new Error(sequenceErrors.join("\n"));

  const synthetic = [
    { name: "0001_core.sql", sql: "CREATE TABLE sample(id TEXT PRIMARY KEY);" },
    { name: "0002_additive.sql", sql: "ALTER TABLE sample ADD COLUMN note TEXT;" },
  ];
  const safe = validateSnapshot(
    {
      environment: "production",
      productionDatabaseId: "prod-db-123",
      previewDatabaseId: "preview-db-456",
      previewValidated: true,
      recoveryPointConfirmed: true,
      verificationContractDefined: true,
      previewEvidenceRef: "preview-run-1",
      recoveryPointRef: "time-travel-bookmark-1",
      appliedMigrations: ["0001_core.sql"],
      verificationQueries: ["sample row count invariant"],
      migrationContracts: {},
    },
    synthetic,
  );
  if (safe.errors.length) throw new Error(`safe self-test failed: ${safe.errors.join(", ")}`);

  const unsafe = validateSnapshot(
    {
      environment: "production",
      productionDatabaseId: "same-db",
      previewDatabaseId: "same-db",
      previewValidated: false,
      recoveryPointConfirmed: false,
      verificationContractDefined: false,
      appliedMigrations: [],
      verificationQueries: [],
    },
    [{ name: "0001_drop.sql", sql: "DROP TABLE sample;" }],
  );
  if (unsafe.errors.length < 5) throw new Error("unsafe self-test did not fail closed");

  const deleteUnsafe = inspectSql({ name: "0002_delete.sql", sql: "DELETE FROM sample;" });
  if (!deleteUnsafe.stopReasons.includes("DELETE without WHERE")) {
    throw new Error("DELETE without WHERE was not stopped");
  }

  console.log(`migration-preflight self-test PASS repositoryMigrations=${repositoryMigrations.length}`);
};

if (args.has("--self-test")) {
  selfTest();
} else {
  const snapshotPath = args.get("--snapshot");
  if (typeof snapshotPath !== "string") {
    console.error("error: use --snapshot=<path> or --self-test");
    process.exit(2);
  }
  const migrations = listMigrations();
  const sequenceErrors = validateMigrationSequence(migrations);
  if (sequenceErrors.length) {
    for (const error of sequenceErrors) console.error(`error: ${error}`);
    process.exit(1);
  }
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(root, snapshotPath), "utf8"));
  const result = validateSnapshot(snapshot, migrations);
  report(result);
  if (result.errors.length) process.exit(1);
}
