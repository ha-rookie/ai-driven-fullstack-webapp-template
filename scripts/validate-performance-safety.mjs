#!/usr/bin/env node
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/d1-performance-benchmark.yml", "utf8");
const benchmark = readFileSync("scripts/d1-performance-benchmark.mjs", "utf8");

const failures = [];
const requireText = (text, pattern, description) => {
  if (!pattern.test(text)) failures.push(`missing ${description}`);
};
const forbidText = (text, pattern, description) => {
  if (pattern.test(text)) failures.push(`forbidden ${description}`);
};

requireText(workflow, /workflow_dispatch\s*:/, "manual workflow_dispatch trigger");
forbidText(workflow, /^\s*(push|pull_request|schedule)\s*:/m, "automatic push/pull_request/schedule trigger");
requireText(workflow, /BENCHMARK_PREVIEW/, "explicit BENCHMARK_PREVIEW confirmation");
requireText(workflow, /db:performance:preview/, "Preview benchmark command");
requireText(workflow, /--remote\s+--preview/, "Preview-only remote migration command");

requireText(benchmark, /PERFORMANCE_CONFIRMATION/, "runtime confirmation guard");
requireText(benchmark, /BENCHMARK_PREVIEW/, "runtime confirmation value");
requireText(benchmark, /placeholderIds/, "placeholder D1 rejection");
requireText(benchmark, /previewId\s*===\s*productionId/, "Preview/Production separation guard");
requireText(benchmark, /\["--remote",\s*"--preview"\]/, "Preview-only target arguments");
requireText(benchmark, /finally\s*\{/, "best-effort fixture cleanup");
requireText(benchmark, /sql_duration_ms/, "explicit SQL-duration-ms metric");
requireText(benchmark, /rows_read/, "rows-read resource metric");
requireText(benchmark, /rows_written/, "rows-written resource metric");
forbidText(benchmark, /\["--remote"\](?!\s*,\s*"--preview")/, "remote execution without Preview guard");

if (failures.length > 0) {
  console.error("Performance safety validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Performance safety validation passed");
