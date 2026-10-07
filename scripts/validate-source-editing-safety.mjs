import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);
const selfTest = args.includes("--self-test");

const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);
const configExtensions = new Set([".json"]);
const ignoredPrefixes = [".git/", "node_modules/", "dist/", ".wrangler/", "coverage/", "test-results/"];

const listFiles = (dir = root) => {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (ignoredPrefixes.some((prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix))) continue;
    if (entry.isDirectory()) result.push(...listFiles(absolute));
    else result.push(relative);
  }
  return result;
};

const suspiciousLiteralEscapes = (text) => {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (/;\\n\s+(?:if|for|while|const|let|return|throw)\b/.test(line)) {
      findings.push({ line: index + 1, reason: "literal \\n appears between JavaScript statements" });
    }
    if (/\}\\n\s*(?:else|catch|finally)\b/.test(line)) {
      findings.push({ line: index + 1, reason: "literal \\n appears at a JavaScript block boundary" });
    }
  });
  return findings;
};

const validateJavaScript = (file) => {
  const syntax = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
  const errors = [];
  if (syntax.status !== 0) errors.push(`JavaScript syntax check failed: ${syntax.stderr.trim().split("\n")[0] || file}`);
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const finding of suspiciousLiteralEscapes(text)) {
    errors.push(`${file}:${finding.line}: ${finding.reason}`);
  }
  return errors;
};

const validateJson = (file) => {
  try {
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    return [];
  } catch (error) {
    return [`${file}: invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`];
  }
};

const validateRepository = () => {
  const errors = [];
  for (const file of listFiles()) {
    const ext = path.extname(file);
    if (sourceExtensions.has(ext)) errors.push(...validateJavaScript(file));
    else if (configExtensions.has(ext)) errors.push(...validateJson(file));
  }
  return errors;
};

const runSelfTest = () => {
  const legitimate = [
    'const newline = "\\n";',
    'const regex = /\\n/;',
    'const tab = "\\t";',
    'const text = "line1\\nline2";',
  ];
  for (const fixture of legitimate) {
    if (suspiciousLiteralEscapes(fixture).length) throw new Error(`legitimate escape rejected: ${fixture}`);
  }

  const corrupt = [
    'const value = 1;\\n  if (value) doThing();',
    '}\\n  else {',
  ];
  for (const fixture of corrupt) {
    if (!suspiciousLiteralEscapes(fixture).length) throw new Error(`corruption fixture was not rejected: ${fixture}`);
  }

  const tempDir = fs.mkdtempSync(path.join(root, ".source-editing-safety-"));
  try {
    const broken = path.join(tempDir, "broken.mjs");
    fs.writeFileSync(broken, 'const value = "broken\nstring";\n');
    const relative = path.relative(root, broken);
    if (!validateJavaScript(relative).some((message) => message.includes("syntax check failed"))) {
      throw new Error("broken quoted newline fixture was not rejected by syntax validation");
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("[source-editing-safety] self-test PASS");
};

if (selfTest) {
  runSelfTest();
} else {
  const errors = validateRepository();
  if (errors.length) {
    for (const error of errors) console.error(`[source-editing-safety] ${error}`);
    process.exitCode = 1;
  } else {
    console.log("[source-editing-safety] repository validation PASS");
  }
}
