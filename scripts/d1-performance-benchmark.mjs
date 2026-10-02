#!/usr/bin/env node
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const PREFIX = "__perf_template_";
const CONFIRMATION = "BENCHMARK_PREVIEW";
const MAX_RESOURCES = 20_000;
const PROFILES = {
  smoke: 1_000,
  "five-year": 5_000,
  "ten-year": 10_000,
  capacity: 10_000,
};

const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
};
const hasFlag = (name) => args.includes(name);

const mode = valueOf("--mode", "local");
const profile = valueOf("--profile", mode === "preview" ? "capacity" : "smoke");
const validateOnly = hasFlag("--validate-config-only");
if (!Object.hasOwn(PROFILES, profile)) {
  throw new Error(`Unknown performance profile: ${profile}`);
}
if (!new Set(["local", "preview"]).has(mode)) {
  throw new Error(`Unknown performance mode: ${mode}`);
}

const configuredCount = process.env.PERF_RESOURCE_COUNT
  ? Number(process.env.PERF_RESOURCE_COUNT)
  : PROFILES[profile];
if (!Number.isInteger(configuredCount) || configuredCount < 100 || configuredCount > MAX_RESOURCES) {
  throw new Error(`PERF_RESOURCE_COUNT must be an integer between 100 and ${MAX_RESOURCES}`);
}
const resourceCount = configuredCount;
const iterations = mode === "local" ? 1 : 3;
const targetMs = process.env.PERF_SERVER_TARGET_MS
  ? Number(process.env.PERF_SERVER_TARGET_MS)
  : null;
if (targetMs !== null && (!Number.isFinite(targetMs) || targetMs <= 0)) {
  throw new Error("PERF_SERVER_TARGET_MS must be a positive number when provided");
}

const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const database = config.d1_databases?.[0];
const previewId = database?.preview_database_id;
const productionId = database?.database_id;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placeholderIds = new Set([
  "00000000-0000-0000-0000-000000000000",
  "00000000-0000-0000-0000-000000000001",
]);

function validatePreviewConfig() {
  if (process.env.PERFORMANCE_CONFIRMATION !== CONFIRMATION) {
    throw new Error(`Preview benchmark requires PERFORMANCE_CONFIRMATION=${CONFIRMATION}`);
  }
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!process.env[name]) throw new Error(`${name} is required for Preview benchmark`);
  }
  if (!previewId || !productionId) {
    throw new Error("Preview and Production D1 IDs must both be configured");
  }
  if (!uuidPattern.test(previewId) || !uuidPattern.test(productionId)) {
    throw new Error("Preview and Production D1 IDs must be UUIDs");
  }
  if (placeholderIds.has(previewId) || placeholderIds.has(productionId)) {
    throw new Error("Refusing Preview benchmark while D1 IDs are placeholders");
  }
  if (previewId === productionId) {
    throw new Error("Refusing Preview benchmark: Preview and Production D1 IDs are identical");
  }
}

if (mode === "preview") validatePreviewConfig();
if (validateOnly) {
  console.log("D1 Preview performance configuration is safe to benchmark");
  process.exit(0);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const temp = mkdtempSync(join(tmpdir(), "fullstack-template-perf-"));
const fixturePath = join(temp, "fixture.sql");
const reportDir = "artifacts/performance";
mkdirSync(reportDir, { recursive: true });

const targetArgs = mode === "preview" ? ["--remote", "--preview"] : ["--local"];
const round = (value) => Math.round(value * 100) / 100;
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const maxNullable = (values) => {
  const numeric = values.filter((value) => value !== null && Number.isFinite(value));
  return numeric.length > 0 ? Math.max(...numeric) : null;
};
const sumNullable = (values) => values.every((value) => value !== null && Number.isFinite(value))
  ? round(values.reduce((sum, value) => sum + value, 0))
  : null;
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const candidates = [stdout.indexOf("["), stdout.indexOf("{")].filter((index) => index >= 0);
    const start = Math.min(...candidates);
    if (!Number.isFinite(start)) {
      throw new Error(`Could not parse wrangler JSON output: ${stdout.slice(0, 500)}`);
    }
    return JSON.parse(stdout.slice(start));
  }
}

function runWrangler(extraArgs, { json = false, quiet = false } = {}) {
  const started = performance.now();
  const result = spawnSync(npx, ["wrangler", ...extraArgs], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const cliWallMs = performance.now() - started;
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`wrangler failed (${result.status}): ${extraArgs.join(" ")}`);
  }
  if (!quiet && result.stderr) process.stderr.write(result.stderr);
  if (!json) return { cliWallMs: round(cliWallMs), stdout: result.stdout };

  const parsed = parseJsonOutput(result.stdout);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const metas = entries.map((entry) => entry?.meta).filter(Boolean);
  const numericSum = (reader) => {
    const values = metas.map(reader).filter((value) => Number.isFinite(value));
    return values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0)) : null;
  };

  return {
    cliWallMs: round(cliWallMs),
    entries,
    statements: entries.length,
    sqlDurationMs: numericSum((meta) => Number(meta?.timings?.sql_duration_ms)),
    rowsRead: numericSum((meta) => Number(meta?.rows_read)),
    rowsWritten: numericSum((meta) => Number(meta?.rows_written)),
  };
}

function executeCommand(sql, options = {}) {
  return runWrangler(
    ["d1", "execute", "DB", ...targetArgs, "--yes", ...(options.json ? ["--json"] : []), "--command", sql],
    options,
  );
}

function executeFile(path) {
  return runWrangler(["d1", "execute", "DB", ...targetArgs, "--yes", "--file", path], {
    quiet: true,
  });
}

const cleanupSql = `PRAGMA foreign_keys = ON; DELETE FROM example_resource_changes WHERE resource_id GLOB '${PREFIX}*'; DELETE FROM example_resources WHERE id GLOB '${PREFIX}*';`;

function buildFixture() {
  const lines = ["PRAGMA foreign_keys = ON;"];
  for (let index = 1; index <= resourceCount; index += 1) {
    const id = `${PREFIX}${String(index).padStart(6, "0")}`;
    const day = String(((index - 1) % 28) + 1).padStart(2, "0");
    const timestamp = `2026-01-${day}T12:00:00.000Z`;
    lines.push(
      `INSERT INTO example_resources(id,name,created_at,updated_at,status,version) VALUES(${sqlText(id)},${sqlText(`Performance Resource ${index}`)},${sqlText(timestamp)},${sqlText(timestamp)},'active',2);`,
    );
    lines.push(
      `INSERT INTO example_resource_changes(resource_id,version,change_kind,from_status,to_status,created_at) VALUES(${sqlText(id)},2,'status_transition','draft','active',${sqlText(timestamp)});`,
    );
  }
  return lines.join("\n");
}

const middleId = `${PREFIX}${String(Math.ceil(resourceCount / 2)).padStart(6, "0")}`;
const queries = [
  {
    name: "point-lookup",
    sql: `SELECT id,name,status,version FROM example_resources WHERE id=${sqlText(middleId)}`,
    expectedPlan: /SEARCH example_resources USING INDEX/i,
  },
  {
    name: "status-page",
    sql: `SELECT id,name,status,version,updated_at FROM example_resources WHERE status='active' AND id GLOB '${PREFIX}*' ORDER BY updated_at DESC,id DESC LIMIT 50`,
    expectedPlan: /idx_example_resources_status_updated/i,
  },
  {
    name: "change-history",
    sql: `SELECT resource_id AS resourceId,version,change_kind AS changeKind,from_status AS fromStatus,to_status AS toStatus,created_at AS createdAt FROM example_resource_changes WHERE resource_id=${sqlText(middleId)} ORDER BY version DESC LIMIT 20`,
    expectedPlan: /SEARCH example_resource_changes/i,
  },
  {
    name: "status-aggregate",
    sql: `SELECT status,COUNT(*) AS resourceCount FROM example_resources WHERE id GLOB '${PREFIX}*' GROUP BY status ORDER BY status`,
    expectedPlan: null,
  },
];

function rowsFrom(measurement) {
  return measurement.entries.flatMap((entry) => entry?.results ?? []);
}

function queryPlan(sql) {
  const measurement = executeCommand(`EXPLAIN QUERY PLAN ${sql}`, { json: true, quiet: true });
  return rowsFrom(measurement).map((row) => String(row.detail ?? ""));
}

function summarizeAction(measurements) {
  return {
    httpRequests: measurements.length,
    d1Statements: measurements.reduce((sum, item) => sum + (item.statements ?? 0), 0),
    cliWallMs: round(measurements.reduce((sum, item) => sum + item.cliWallMs, 0)),
    sqlDurationMs: sumNullable(measurements.map((item) => item.sqlDurationMs)),
    rowsRead: sumNullable(measurements.map((item) => item.rowsRead)),
    rowsWritten: sumNullable(measurements.map((item) => item.rowsWritten)),
  };
}

const results = [];
let operationBudget = null;
let fixtureLoad = null;
let cleanup = null;
let benchmarkError = null;
try {
  executeCommand(cleanupSql, { quiet: true });
  writeFileSync(fixturePath, buildFixture());
  fixtureLoad = executeFile(fixturePath);

  for (const query of queries) {
    const plan = queryPlan(query.sql);
    if (query.expectedPlan && !plan.some((detail) => query.expectedPlan.test(detail))) {
      throw new Error(`Query plan assertion failed for ${query.name}: ${plan.join(" | ")}`);
    }

    const runs = [];
    for (let iteration = 1; iteration <= iterations; iteration += 1) {
      const measurement = executeCommand(query.sql, { json: true, quiet: true });
      const rows = rowsFrom(measurement);
      if (query.name === "point-lookup" && rows.length !== 1) {
        throw new Error("point-lookup did not return exactly one benchmark row");
      }
      if (query.name === "status-page" && rows.length !== 50) {
        throw new Error(`status-page expected 50 rows but returned ${rows.length}`);
      }
      if (query.name === "change-history" && rows.length !== 1) {
        throw new Error("change-history did not return exactly one change row");
      }
      if (query.name === "status-aggregate") {
        const activeCount = Number(rows.find((row) => row.status === "active")?.resourceCount ?? -1);
        if (activeCount !== resourceCount) {
          throw new Error(`status-aggregate expected ${resourceCount} rows but found ${activeCount}`);
        }
      }
      runs.push({ iteration, ...measurement });
    }

    const cliWall = runs.map((run) => run.cliWallMs);
    const sqlDurations = runs.map((run) => run.sqlDurationMs).filter((value) => value !== null);
    results.push({
      name: query.name,
      plan,
      runs,
      summary: {
        cliWallAvgMs: round(average(cliWall)),
        cliWallMaxMs: round(Math.max(...cliWall)),
        sqlDurationAvgMs: sqlDurations.length ? round(average(sqlDurations)) : null,
        sqlDurationMaxMs: sqlDurations.length ? round(Math.max(...sqlDurations)) : null,
        rowsReadMax: maxNullable(runs.map((run) => run.rowsRead)),
        rowsWrittenMax: maxNullable(runs.map((run) => run.rowsWritten)),
        statementsMax: Math.max(...runs.map((run) => run.statements ?? 0)),
      },
    });
  }

  const sampleCount = Math.min(20, resourceCount);
  const sampleIds = Array.from({ length: sampleCount }, (_, index) => `${PREFIX}${String(index + 1).padStart(6, "0")}`);
  const nPlusOneMeasurements = sampleIds.map((id) => executeCommand(
    `SELECT id,name,status,version FROM example_resources WHERE id=${sqlText(id)}`,
    { json: true, quiet: true },
  ));
  const aggregateMeasurement = executeCommand(
    `SELECT id,name,status,version FROM example_resources WHERE id IN (${sampleIds.map(sqlText).join(",")}) ORDER BY id`,
    { json: true, quiet: true },
  );
  if (rowsFrom(aggregateMeasurement).length !== sampleCount) {
    throw new Error(`operation-budget aggregate expected ${sampleCount} rows`);
  }
  const nPlusOne = summarizeAction(nPlusOneMeasurements);
  const aggregate = summarizeAction([aggregateMeasurement]);
  if (nPlusOne.d1Statements <= aggregate.d1Statements) {
    throw new Error(`N+1 baseline did not use more statements (${nPlusOne.d1Statements} <= ${aggregate.d1Statements})`);
  }
  operationBudget = {
    sampleRows: sampleCount,
    nPlusOne,
    aggregate,
    delta: {
      httpRequests: nPlusOne.httpRequests - aggregate.httpRequests,
      d1Statements: nPlusOne.d1Statements - aggregate.d1Statements,
      rowsRead: nPlusOne.rowsRead === null || aggregate.rowsRead === null ? null : nPlusOne.rowsRead - aggregate.rowsRead,
      rowsWritten: nPlusOne.rowsWritten === null || aggregate.rowsWritten === null ? null : nPlusOne.rowsWritten - aggregate.rowsWritten,
    },
  };
} catch (error) {
  benchmarkError = error;
} finally {
  try {
    cleanup = executeCommand(cleanupSql, { quiet: true });
  } catch (cleanupError) {
    if (!benchmarkError) benchmarkError = cleanupError;
    else console.error("Performance fixture cleanup also failed", cleanupError);
  }
  rmSync(temp, { recursive: true, force: true });
}

if (benchmarkError) throw benchmarkError;

const thresholdFailures = [];
if (targetMs !== null) {
  for (const result of results) {
    if (result.summary.sqlDurationMaxMs !== null && result.summary.sqlDurationMaxMs > targetMs) {
      thresholdFailures.push(`${result.name}: ${result.summary.sqlDurationMaxMs} ms > ${targetMs} ms`);
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode,
  profile,
  resourceCount,
  changeCount: resourceCount,
  iterations,
  units: {
    cliWallMs: "milliseconds measured around the Wrangler CLI process",
    sqlDurationMs: "milliseconds from D1 meta.timings.sql_duration_ms when available",
  },
  threshold: targetMs === null ? null : { serverTargetMs: targetMs, failures: thresholdFailures },
  fixture: {
    logicalRowsInserted: resourceCount * 2,
    logicalRowsRemovedOnCleanup: resourceCount * 2,
    loadCliWallMs: fixtureLoad?.cliWallMs ?? null,
    cleanupCliWallMs: cleanup?.cliWallMs ?? null,
  },
  queries: results,
  operationBudget,
  notes: [
    mode === "local"
      ? "Local D1 timing is a development/CI signal and is not a Production latency SLA."
      : "Preview benchmark consumes remote D1 resources and must be interpreted with rows-read/write cost evidence.",
    "CLI wall time and D1 SQL execution time are intentionally reported separately.",
    "Required PR CI has no hard-coded absolute latency threshold. Projects may opt in with PERF_SERVER_TARGET_MS.",
    "five-year/ten-year profiles are replaceable fixture-volume views, not forecasts of a particular Product's growth.",
    "N+1 and aggregate action costs keep HTTP request count and D1 statement count separate from latency.",
  ],
};

const jsonPath = join(reportDir, `d1-performance-${mode}-${profile}.json`);
const markdownPath = join(reportDir, `d1-performance-${mode}-${profile}.md`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const displayMetric = (value) => (value === null ? "n/a" : value);
const markdown = [
  "# D1 Performance / Capacity Report",
  "",
  `- Mode: \`${mode}\``,
  `- Profile: \`${profile}\``,
  `- Resources: ${resourceCount.toLocaleString("en-US")}`,
  `- Change rows: ${resourceCount.toLocaleString("en-US")}`,
  `- Iterations/query: ${iterations}`,
  `- Logical fixture rows inserted: ${(resourceCount * 2).toLocaleString("en-US")}`,
  `- Absolute threshold: ${targetMs === null ? "not configured" : `${targetMs} ms`}`,
  "",
  "| Query | SQL avg ms | SQL max ms | CLI avg ms | CLI max ms | Rows read max | Rows written max | Statements max |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ...results.map((result) =>
    `| ${result.name} | ${displayMetric(result.summary.sqlDurationAvgMs)} | ${displayMetric(result.summary.sqlDurationMaxMs)} | ${result.summary.cliWallAvgMs} | ${result.summary.cliWallMaxMs} | ${displayMetric(result.summary.rowsReadMax)} | ${displayMetric(result.summary.rowsWrittenMax)} | ${result.summary.statementsMax} |`,
  ),
  "",
  "## Action operation budget",
  "",
  `Representative lookup set: ${operationBudget.sampleRows} rows`,
  "",
  "| Shape | HTTP requests | D1 statements | SQL ms | CLI wall ms | Rows read | Rows written |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  `| N+1 | ${operationBudget.nPlusOne.httpRequests} | ${operationBudget.nPlusOne.d1Statements} | ${displayMetric(operationBudget.nPlusOne.sqlDurationMs)} | ${operationBudget.nPlusOne.cliWallMs} | ${displayMetric(operationBudget.nPlusOne.rowsRead)} | ${displayMetric(operationBudget.nPlusOne.rowsWritten)} |`,
  `| Aggregate | ${operationBudget.aggregate.httpRequests} | ${operationBudget.aggregate.d1Statements} | ${displayMetric(operationBudget.aggregate.sqlDurationMs)} | ${operationBudget.aggregate.cliWallMs} | ${displayMetric(operationBudget.aggregate.rowsRead)} | ${displayMetric(operationBudget.aggregate.rowsWritten)} |`,
  "",
  `Statement delta: ${operationBudget.delta.d1Statements}; HTTP request delta: ${operationBudget.delta.httpRequests}; rows-read delta: ${displayMetric(operationBudget.delta.rowsRead)}.`,
  "",
  "## Query plans",
  "",
  ...results.flatMap((result) => [
    `### ${result.name}`,
    "",
    "```text",
    ...(result.plan.length ? result.plan : ["(not captured)"]),
    "```",
    "",
  ]),
  "## Interpretation",
  "",
  "- SQL duration and CLI wall time are different measurements; do not convert one into the other.",
  "- Local D1 values prove workload shape and access paths, not Production SLA compliance.",
  "- Remote Preview runs are manual because they consume shared external quota/resources.",
  "- Rows read/written belong beside timing when evaluating query cost.",
  "- A fast N+1 flow is still inefficient when it multiplies HTTP requests or D1 statements.",
  "- five-year/ten-year labels describe replaceable fixture volumes only; they are not universal retention or growth assumptions.",
  "",
].join("\n");
writeFileSync(markdownPath, markdown);

console.log(`Performance report: ${markdownPath}`);
for (const result of results) {
  console.log(
    `${result.name}: SQL max ${displayMetric(result.summary.sqlDurationMaxMs)} ms; CLI wall avg ${result.summary.cliWallAvgMs} ms; rows read max ${displayMetric(result.summary.rowsReadMax)}`,
  );
}
console.log(`Operation budget: N+1 ${operationBudget.nPlusOne.d1Statements} statements/${operationBudget.nPlusOne.httpRequests} requests; aggregate ${operationBudget.aggregate.d1Statements} statements/${operationBudget.aggregate.httpRequests} request`);

if (thresholdFailures.length > 0) {
  throw new Error(`Configured server-time threshold exceeded: ${thresholdFailures.join("; ")}`);
}
