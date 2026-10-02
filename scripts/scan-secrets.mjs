import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW_MARKER = "secret-scan: allow";

const rules = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  {
    id: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/,
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: "stripe-live-secret",
    pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/,
  },
];

const genericAssignment = /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|secret)\b\s*[:=]\s*["']?([A-Za-z0-9+\/_=-]{20,})["']?/i;
const placeholderFragments = [
  "example",
  "sample",
  "placeholder",
  "changeme",
  "replace_me",
  "replace-me",
  "dummy",
  "fake",
  "test",
  "local",
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const findings = [];
let scannedFiles = 0;
let skippedBinaryFiles = 0;

for (const path of trackedFiles) {
  const buffer = readFileSync(path);

  if (buffer.includes(0)) {
    skippedBinaryFiles += 1;
    continue;
  }

  scannedFiles += 1;
  const lines = buffer.toString("utf8").split(/\r?\n/u);

  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) {
      return;
    }

    for (const rule of rules) {
      if (rule.pattern.test(line)) {
        findings.push({ path, line: index + 1, rule: rule.id });
      }
    }

    const genericMatch = line.match(genericAssignment);
    if (!genericMatch) {
      return;
    }

    const candidate = genericMatch[1].toLowerCase();
    if (placeholderFragments.some((fragment) => candidate.includes(fragment))) {
      return;
    }

    findings.push({ path, line: index + 1, rule: "generic-credential-assignment" });
  });
}

const uniqueFindings = [
  ...new Map(
    findings.map((finding) => [
      `${finding.path}:${finding.line}:${finding.rule}`,
      finding,
    ]),
  ).values(),
];

const summary = {
  result: uniqueFindings.length === 0 ? "ok" : "failed",
  scannedFiles,
  skippedBinaryFiles,
  findingCount: uniqueFindings.length,
};

console.log(JSON.stringify(summary));

if (uniqueFindings.length > 0) {
  for (const finding of uniqueFindings) {
    console.error(
      `secret candidate: rule=${finding.rule} path=${finding.path} line=${finding.line}`,
    );
  }
  console.error(
    `Secret detection failed. Values are intentionally redacted. Use '${ALLOW_MARKER}' only for reviewed false positives.`,
  );
  process.exit(1);
}
