import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const numericEnv = name => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
};

const parseArgs = argv => {
  const args = { dist: "dist/client", outputDir: "artifacts/performance" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--self-test") {
      args.selfTest = true;
      continue;
    }
    if (!["--dist", "--output-dir"].includes(value)) throw new Error(`Unknown argument: ${value}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    if (value === "--dist") args.dist = next;
    if (value === "--output-dir") args.outputDir = next;
    index += 1;
  }
  return args;
};

const collectFiles = root => {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Frontend build directory not found: ${root}`);
  }

  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({
        path: path.relative(root, absolute).replaceAll(path.sep, "/"),
        bytes: fs.statSync(absolute).size,
        extension: path.extname(entry.name).toLowerCase(),
      });
    }
  };
  visit(root);
  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const summarize = files => {
  if (files.length === 0) throw new Error("Frontend build contains no files");

  const js = files.filter(file => file.extension === ".js");
  const css = files.filter(file => file.extension === ".css");
  const assetBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((left, right) => right.bytes - left.bytes)[0];

  return {
    fileCount: files.length,
    totalBytes: assetBytes,
    js: {
      fileCount: js.length,
      totalBytes: js.reduce((sum, file) => sum + file.bytes, 0),
      largestBytes: js.length ? Math.max(...js.map(file => file.bytes)) : 0,
    },
    css: {
      fileCount: css.length,
      totalBytes: css.reduce((sum, file) => sum + file.bytes, 0),
      largestBytes: css.length ? Math.max(...css.map(file => file.bytes)) : 0,
    },
    largestAsset: largest ? { path: largest.path, bytes: largest.bytes } : null,
    files,
  };
};

const thresholdsFromEnv = () => ({
  maxTotalJsBytes: numericEnv("FRONTEND_MAX_TOTAL_JS_BYTES"),
  maxSingleJsBytes: numericEnv("FRONTEND_MAX_SINGLE_JS_BYTES"),
  maxTotalCssBytes: numericEnv("FRONTEND_MAX_TOTAL_CSS_BYTES"),
  maxTotalAssetBytes: numericEnv("FRONTEND_MAX_TOTAL_ASSET_BYTES"),
});

const assessThresholds = (summary, thresholds) => {
  const checks = [
    ["maxTotalJsBytes", summary.js.totalBytes],
    ["maxSingleJsBytes", summary.js.largestBytes],
    ["maxTotalCssBytes", summary.css.totalBytes],
    ["maxTotalAssetBytes", summary.totalBytes],
  ].map(([name, actual]) => {
    const limit = thresholds[name];
    if (limit === null) return { name, configured: false, actual, limit: null, status: "not-configured" };
    return { name, configured: true, actual, limit, status: actual <= limit ? "pass" : "fail" };
  });

  return {
    configured: checks.some(check => check.configured),
    status: checks.some(check => check.status === "fail") ? "fail" : "pass",
    checks,
  };
};

const toMarkdown = evidence => {
  const lines = [
    "# Frontend build performance evidence",
    "",
    `- generatedAt: ${evidence.generatedAt}`,
    `- source: ${evidence.source}`,
    `- total assets: ${evidence.summary.fileCount}`,
    `- total bytes: ${evidence.summary.totalBytes}`,
    `- JavaScript bytes: ${evidence.summary.js.totalBytes}`,
    `- largest JavaScript bytes: ${evidence.summary.js.largestBytes}`,
    `- CSS bytes: ${evidence.summary.css.totalBytes}`,
    `- largest asset: ${evidence.summary.largestAsset?.path ?? "n/a"} (${evidence.summary.largestAsset?.bytes ?? 0} bytes)`,
    `- threshold status: ${evidence.thresholdAssessment.configured ? evidence.thresholdAssessment.status : "not-configured"}`,
    "",
    "## Thresholds",
    "",
    "| Budget | Actual bytes | Limit bytes | Status |",
    "| --- | ---: | ---: | --- |",
    ...evidence.thresholdAssessment.checks.map(check =>
      `| ${check.name} | ${check.actual} | ${check.limit ?? "-"} | ${check.status} |`),
    "",
    "## Largest assets",
    "",
    "| Asset | Bytes |",
    "| --- | ---: |",
    ...[...evidence.summary.files]
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, 15)
      .map(file => `| \`${file.path}\` | ${file.bytes} |`),
    "",
    "> No universal byte budget is hard-coded by the Template. Configure Project-specific thresholds when NFRs are known.",
    "",
  ];
  return lines.join("\n");
};

const writeEvidence = (outputDir, evidence) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "frontend-build.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "frontend-build.md"), toMarkdown(evidence));
};

const selfTest = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-performance-"));
  try {
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "app.js"), "x".repeat(100));
    fs.writeFileSync(path.join(root, "assets", "style.css"), "y".repeat(40));
    fs.writeFileSync(path.join(root, "index.html"), "z".repeat(20));

    const summary = summarize(collectFiles(root));
    assert.equal(summary.fileCount, 3);
    assert.equal(summary.js.totalBytes, 100);
    assert.equal(summary.css.totalBytes, 40);
    assert.equal(summary.totalBytes, 160);

    const pass = assessThresholds(summary, {
      maxTotalJsBytes: 100,
      maxSingleJsBytes: 100,
      maxTotalCssBytes: null,
      maxTotalAssetBytes: 200,
    });
    assert.equal(pass.status, "pass");

    const fail = assessThresholds(summary, {
      maxTotalJsBytes: 99,
      maxSingleJsBytes: null,
      maxTotalCssBytes: null,
      maxTotalAssetBytes: null,
    });
    assert.equal(fail.status, "fail");

    console.log("frontend-performance-evidence self-test: ok");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
    return;
  }

  const summary = summarize(collectFiles(args.dist));
  const thresholdAssessment = assessThresholds(summary, thresholdsFromEnv());
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: args.dist,
    measurementKind: "production-build-static-assets",
    summary,
    thresholdAssessment,
    interpretation: {
      localBuildOnly: true,
      productionRUM: false,
      note: "Build bytes are regression evidence, not a universal UX/SLO guarantee.",
    },
  };
  writeEvidence(args.outputDir, evidence);

  console.log(JSON.stringify({
    totalBytes: summary.totalBytes,
    jsBytes: summary.js.totalBytes,
    cssBytes: summary.css.totalBytes,
    thresholdStatus: thresholdAssessment.configured ? thresholdAssessment.status : "not-configured",
  }));

  if (thresholdAssessment.configured && thresholdAssessment.status === "fail") process.exitCode = 1;
};

main();
