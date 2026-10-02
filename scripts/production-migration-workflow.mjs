import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "config/production-migration-workflow-policy.json"), "utf8"),
);
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, "config/production-schema-baseline.json"), "utf8"),
);

const rawArgs = process.argv.slice(2);
const args = new Map(
  rawArgs.map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.length ? rest.join("=") : true];
  }),
);

const fail = (messages, exitCode = 1) => {
  for (const message of messages) console.error(`[production-migration-workflow] ${message}`);
  process.exitCode = exitCode;
};

const isPlaceholder = (value) => {
  if (typeof value !== "string" || value.trim() === "") return true;
  const normalized = value.toLowerCase();
  return policy.placeholderPatterns.some((marker) => normalized.includes(marker.toLowerCase()));
};

const parseJsonArg = (name, fallback) => {
  const value = args.get(name);
  if (typeof value !== "string") return fallback;
  return JSON.parse(value);
};

const requestFromArgs = () => ({
  targetSha: args.get("--target-sha"),
  productionDatabaseName: args.get("--production-database-name"),
  productionDatabaseId: args.get("--production-database-id"),
  previewDatabaseId: args.get("--preview-database-id"),
  previewEvidenceRef: args.get("--preview-evidence-ref"),
  recoveryPointRef: args.get("--recovery-point-ref"),
  verificationQueries: parseJsonArg("--verification-queries-json", []),
  migrationContracts: parseJsonArg("--migration-contracts-json", {}),
  confirmation: args.get("--confirmation"),
});

const validateRequest = (request) => {
  const errors = [];
  const shaPattern = new RegExp(policy.targetShaPattern);
  if (typeof request.targetSha !== "string" || !shaPattern.test(request.targetSha)) {
    errors.push("targetSha must be a full 40-character lowercase commit SHA");
  }
  if (isPlaceholder(request.productionDatabaseName)) errors.push("productionDatabaseName is missing or placeholder");
  if (isPlaceholder(request.productionDatabaseId)) errors.push("productionDatabaseId is missing or placeholder");
  if (isPlaceholder(request.previewDatabaseId)) errors.push("previewDatabaseId is missing or placeholder");
  if (
    !isPlaceholder(request.productionDatabaseId) &&
    request.productionDatabaseId === request.previewDatabaseId
  ) {
    errors.push("Production and Preview database IDs must differ");
  }
  if (request.confirmation !== policy.requiredConfirmation) {
    errors.push(`confirmation must exactly equal ${policy.requiredConfirmation}`);
  }
  if (typeof request.previewEvidenceRef !== "string" || request.previewEvidenceRef.trim() === "") {
    errors.push("previewEvidenceRef is required");
  }
  if (typeof request.recoveryPointRef !== "string" || request.recoveryPointRef.trim() === "") {
    errors.push("recoveryPointRef is required");
  }
  if (!Array.isArray(request.verificationQueries) || request.verificationQueries.length === 0) {
    errors.push("verificationQueries must be a non-empty JSON array");
  }
  if (
    !request.migrationContracts ||
    typeof request.migrationContracts !== "object" ||
    Array.isArray(request.migrationContracts)
  ) {
    errors.push("migrationContracts must be a JSON object");
  }
  return errors;
};

const runWranglerJson = (wranglerArgs) => {
  const result = spawnSync("npx", ["wrangler", ...wranglerArgs], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler command failed with exit status ${result.status ?? "unknown"}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("wrangler returned non-JSON output where JSON was required");
  }
};

const collectUuidStrings = (value, result = new Set()) => {
  if (typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)) result.add(value.toLowerCase());
  if (Array.isArray(value)) {
    for (const item of value) collectUuidStrings(item, result);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUuidStrings(item, result);
  }
  return result;
};

const collectResultRows = (value, rows = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectResultRows(item, rows);
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.results)) rows.push(...value.results);
    for (const [key, item] of Object.entries(value)) {
      if (key !== "results") collectResultRows(item, rows);
    }
  }
  return rows;
};

const metadataQuery = () => {
  const pieces = [
    "SELECT 'migration' AS kind, name AS object_name, NULL AS parent_name FROM d1_migrations",
    "SELECT type AS kind, name AS object_name, tbl_name AS parent_name FROM sqlite_master WHERE type IN ('table','index')",
  ];
  for (const table of Object.keys(baseline.requiredTables)) {
    const safeTable = table.replaceAll("'", "''");
    pieces.push(
      `SELECT 'column' AS kind, name AS object_name, '${safeTable}' AS parent_name FROM pragma_table_info('${safeTable}')`,
    );
  }
  return pieces.join(" UNION ALL ") + ";";
};

const snapshotFromRows = ({ phase, databaseName, databaseId, previewDatabaseId, rows }) => {
  const appliedMigrations = [];
  const tables = {};
  const indexes = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (row.kind === "migration" && typeof row.object_name === "string") appliedMigrations.push(row.object_name);
    if (row.kind === "table" && typeof row.object_name === "string") tables[row.object_name] ??= [];
    if (row.kind === "column" && typeof row.parent_name === "string" && typeof row.object_name === "string") {
      tables[row.parent_name] ??= [];
      tables[row.parent_name].push(row.object_name);
    }
    if (row.kind === "index" && typeof row.object_name === "string") indexes.push(row.object_name);
  }
  return {
    phase,
    environment: policy.requiredEnvironment,
    databaseId,
    databaseName,
    previewDatabaseId,
    appliedMigrations,
    tables,
    indexes,
  };
};

const captureSchemaSnapshot = () => {
  const request = requestFromArgs();
  const phase = args.get("--phase");
  const output = args.get("--output");
  const errors = validateRequest(request).filter((error) => !error.startsWith("confirmation"));
  if (!new Set(["pre-deploy", "post-migration"]).has(phase)) errors.push("phase must be pre-deploy or post-migration");
  if (typeof output !== "string" || output.trim() === "") errors.push("--output=<path> is required");
  if (errors.length) return fail(errors, 2);

  const info = runWranglerJson(["d1", "info", request.productionDatabaseName, "--json"]);
  const uuids = collectUuidStrings(info);
  if (!uuids.has(request.productionDatabaseId.toLowerCase())) {
    return fail(["Production database ID does not match Cloudflare D1 info"], 1);
  }

  const metadata = runWranglerJson([
    "d1",
    "execute",
    request.productionDatabaseName,
    "--remote",
    "--json",
    "--command",
    metadataQuery(),
  ]);
  const rows = collectResultRows(metadata);
  const snapshot = snapshotFromRows({
    phase,
    databaseName: request.productionDatabaseName,
    databaseId: request.productionDatabaseId,
    previewDatabaseId: request.previewDatabaseId,
    rows,
  });
  fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
  fs.writeFileSync(path.resolve(root, output), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `[production-migration-workflow] captured metadata phase=${phase} migrations=${snapshot.appliedMigrations.length} tables=${Object.keys(snapshot.tables).length} indexes=${snapshot.indexes.length}`,
  );
};

const buildPreflightSnapshot = () => {
  const request = requestFromArgs();
  const schemaSnapshotPath = args.get("--schema-snapshot");
  const output = args.get("--output");
  const errors = validateRequest(request);
  if (typeof schemaSnapshotPath !== "string") errors.push("--schema-snapshot=<path> is required");
  if (typeof output !== "string") errors.push("--output=<path> is required");
  if (errors.length) return fail(errors, 2);

  const schemaSnapshot = JSON.parse(fs.readFileSync(path.resolve(root, schemaSnapshotPath), "utf8"));
  const snapshot = {
    environment: policy.requiredEnvironment,
    productionDatabaseId: request.productionDatabaseId,
    previewDatabaseId: request.previewDatabaseId,
    previewValidated: true,
    recoveryPointConfirmed: true,
    verificationContractDefined: true,
    previewEvidenceRef: request.previewEvidenceRef,
    recoveryPointRef: request.recoveryPointRef,
    appliedMigrations: schemaSnapshot.appliedMigrations,
    verificationQueries: request.verificationQueries,
    migrationContracts: request.migrationContracts,
  };
  fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
  fs.writeFileSync(path.resolve(root, output), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `[production-migration-workflow] built preflight snapshot appliedMigrations=${snapshot.appliedMigrations.length}`,
  );
};

const validateWorkflowDefinition = () => {
  const workflowPath = path.join(root, ".github/workflows/production-migration.yml");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const errors = [];
  if (!/^\s{2}workflow_dispatch:/m.test(workflow)) errors.push("workflow_dispatch trigger is required");
  if (/^\s{2}(pull_request|push|schedule):/m.test(workflow)) {
    errors.push("Production migration workflow must not run from pull_request, push, or schedule");
  }
  if (!workflow.includes("environment: production")) errors.push("production environment Human Gate is required");
  if (!workflow.includes("needs: preflight")) errors.push("migration job must depend on preflight");
  if (!workflow.includes('migrations apply "$PRODUCTION_DATABASE_NAME" --remote')) {
    errors.push("remote migration command must remain explicit");
  }
  if (!workflow.includes("db:schema:verify:production")) errors.push("post-migration schema verification is required");
  if (!workflow.includes("cancel-in-progress: false")) errors.push("migration concurrency must never cancel in-progress work");
  if (!workflow.includes("Re-run preflight against current Production state")) {
    errors.push("preflight must be rerun after Human Gate");
  }
  return errors;
};

const selfTest = () => {
  const safeRequest = {
    targetSha: "a".repeat(40),
    productionDatabaseName: "app-production",
    productionDatabaseId: "11111111-1111-1111-1111-111111111111",
    previewDatabaseId: "22222222-2222-2222-2222-222222222222",
    previewEvidenceRef: "preview-run-42",
    recoveryPointRef: "d1-backup-before-release",
    verificationQueries: ["row-count invariant"],
    migrationContracts: {},
    confirmation: policy.requiredConfirmation,
  };
  if (validateRequest(safeRequest).length) throw new Error("safe request unexpectedly failed validation");

  const unsafeRequest = structuredClone(safeRequest);
  unsafeRequest.targetSha = "main";
  unsafeRequest.previewDatabaseId = unsafeRequest.productionDatabaseId;
  unsafeRequest.confirmation = "yes";
  unsafeRequest.verificationQueries = [];
  if (validateRequest(unsafeRequest).length < 4) throw new Error("unsafe request did not fail closed");

  const syntheticRows = [
    { kind: "migration", object_name: "0001_core.sql", parent_name: null },
    { kind: "table", object_name: "example_resources", parent_name: "example_resources" },
    { kind: "column", object_name: "id", parent_name: "example_resources" },
    { kind: "index", object_name: "idx_example_resources_created_at", parent_name: "example_resources" },
  ];
  const snapshot = snapshotFromRows({
    phase: "post-migration",
    databaseName: "app-production",
    databaseId: safeRequest.productionDatabaseId,
    previewDatabaseId: safeRequest.previewDatabaseId,
    rows: syntheticRows,
  });
  if (snapshot.appliedMigrations[0] !== "0001_core.sql") throw new Error("migration row transform failed");
  if (!snapshot.tables.example_resources?.includes("id")) throw new Error("column row transform failed");
  if (!snapshot.indexes.includes("idx_example_resources_created_at")) throw new Error("index row transform failed");

  const ids = collectUuidStrings({ result: { uuid: safeRequest.productionDatabaseId } });
  if (!ids.has(safeRequest.productionDatabaseId)) throw new Error("database ID extraction failed");

  const workflowErrors = validateWorkflowDefinition();
  if (workflowErrors.length) throw new Error(workflowErrors.join("\n"));

  console.log("[production-migration-workflow] self-test passed");
};

try {
  if (args.has("--self-test")) {
    selfTest();
  } else if (args.has("--validate-request")) {
    const errors = validateRequest(requestFromArgs());
    if (errors.length) fail(errors, 2);
    else console.log("[production-migration-workflow] request validation PASS");
  } else if (args.has("--capture-schema")) {
    captureSchemaSnapshot();
  } else if (args.has("--build-preflight")) {
    buildPreflightSnapshot();
  } else {
    fail(["use --self-test, --validate-request, --capture-schema, or --build-preflight"], 2);
  }
} catch (error) {
  fail([error instanceof Error ? error.message : "unexpected error"]);
}
