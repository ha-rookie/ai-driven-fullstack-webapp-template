import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const valueArg = (prefix) => process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const baselinePath = resolve(valueArg("--baseline=") ?? "config/production-schema-baseline.json");
const snapshotPath = valueArg("--snapshot=");
const selfTest = args.has("--self-test");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const baseline = await readJson(baselinePath);

const fail = (messages) => {
  for (const message of messages) console.error(`[schema-verification] ${message}`);
  process.exitCode = 1;
};

const migrationFiles = async () => {
  const entries = await readdir(resolve(baseline.migrationDirectory), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const isPlaceholder = (value) => {
  if (typeof value !== "string" || value.trim() === "") return true;
  const normalized = value.toLowerCase();
  return baseline.placeholderPatterns.some((pattern) => normalized.includes(String(pattern).toLowerCase()));
};

const verify = async (snapshot) => {
  const errors = [];
  const expectedMigrations = await migrationFiles();
  const phase = snapshot.phase;
  if (!new Set(["pre-deploy", "post-migration"]).has(phase)) errors.push("phase must be pre-deploy or post-migration");
  if (snapshot.environment !== baseline.requiredEnvironment) errors.push("environment must be production");
  if (isPlaceholder(snapshot.databaseId)) errors.push("production databaseId is missing or placeholder");
  if (isPlaceholder(snapshot.databaseName)) errors.push("production databaseName is missing or placeholder");
  if (isPlaceholder(snapshot.previewDatabaseId)) errors.push("previewDatabaseId is missing or placeholder");
  if (snapshot.databaseId === snapshot.previewDatabaseId) errors.push("Production and Preview database IDs must differ");

  const applied = Array.isArray(snapshot.appliedMigrations) ? snapshot.appliedMigrations : [];
  if (new Set(applied).size !== applied.length) errors.push("appliedMigrations contains duplicates");
  const missingMigrations = expectedMigrations.filter((name) => !applied.includes(name));
  const unexpectedMigrations = applied.filter((name) => !expectedMigrations.includes(name));
  if (missingMigrations.length) errors.push(`missing applied migrations: ${missingMigrations.join(", ")}`);
  if (unexpectedMigrations.length) errors.push(`unexpected applied migrations: ${unexpectedMigrations.join(", ")}`);
  if (applied.length === expectedMigrations.length && applied.some((name, index) => name !== expectedMigrations[index])) {
    errors.push("applied migration order differs from repository order");
  }

  const actualTables = snapshot.tables && typeof snapshot.tables === "object" ? snapshot.tables : {};
  for (const [table, requiredColumns] of Object.entries(baseline.requiredTables)) {
    const actualColumns = Array.isArray(actualTables[table]) ? actualTables[table] : null;
    if (!actualColumns) {
      errors.push(`missing table: ${table}`);
      continue;
    }
    const missingColumns = requiredColumns.filter((column) => !actualColumns.includes(column));
    if (missingColumns.length) errors.push(`missing columns in ${table}: ${missingColumns.join(", ")}`);
  }

  const indexes = Array.isArray(snapshot.indexes) ? snapshot.indexes : [];
  const missingIndexes = baseline.requiredIndexes.filter((index) => !indexes.includes(index));
  if (missingIndexes.length) errors.push(`missing indexes: ${missingIndexes.join(", ")}`);

  return {
    ok: errors.length === 0,
    phase,
    expectedMigrationCount: expectedMigrations.length,
    appliedMigrationCount: applied.length,
    requiredTableCount: Object.keys(baseline.requiredTables).length,
    requiredIndexCount: baseline.requiredIndexes.length,
    errors,
  };
};

const safeSnapshot = async () => ({
  phase: "post-migration",
  environment: "production",
  databaseId: "11111111-1111-1111-1111-111111111111",
  databaseName: "app-production",
  previewDatabaseId: "22222222-2222-2222-2222-222222222222",
  appliedMigrations: await migrationFiles(),
  tables: Object.fromEntries(Object.entries(baseline.requiredTables).map(([name, columns]) => [name, [...columns]])),
  indexes: [...baseline.requiredIndexes],
});

if (selfTest) {
  const safe = await safeSnapshot();
  const safeResult = await verify(safe);
  if (!safeResult.ok) {
    fail(["safe self-test fixture unexpectedly failed", ...safeResult.errors]);
  } else {
    const unsafe = structuredClone(safe);
    unsafe.databaseId = unsafe.previewDatabaseId;
    unsafe.appliedMigrations = unsafe.appliedMigrations.slice(0, -1);
    delete unsafe.tables.example_resource_decisions;
    unsafe.indexes = unsafe.indexes.filter((name) => name !== "idx_idempotency_records_expiry");
    const unsafeResult = await verify(unsafe);
    if (unsafeResult.ok || unsafeResult.errors.length < 4) {
      fail(["unsafe self-test fixture did not fail closed"]);
    } else {
      console.log("[schema-verification] self-test passed");
    }
  }
} else {
  if (!snapshotPath) {
    fail(["--snapshot=<path> is required"]);
  } else {
    const snapshot = await readJson(resolve(snapshotPath));
    const result = await verify(snapshot);
    console.log(JSON.stringify({
      ok: result.ok,
      phase: result.phase,
      expectedMigrationCount: result.expectedMigrationCount,
      appliedMigrationCount: result.appliedMigrationCount,
      requiredTableCount: result.requiredTableCount,
      requiredIndexCount: result.requiredIndexCount,
      errors: result.errors,
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}
