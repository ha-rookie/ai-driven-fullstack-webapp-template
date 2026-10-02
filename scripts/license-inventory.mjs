import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_PATH = process.env.LICENSE_INVENTORY_OUTPUT ?? "license-inventory.json";
const POLICY_PATH = process.env.LICENSE_POLICY_PATH ?? "config/license-policy.json";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const policy = readJson(POLICY_PATH);
if (
  policy.schemaVersion !== 1 ||
  !["allow", "review", "deny"].includes(policy.defaultDecision) ||
  !Array.isArray(policy.allow) ||
  !Array.isArray(policy.review) ||
  !Array.isArray(policy.deny)
) {
  throw new Error("Invalid license policy contract");
}

const duplicates = new Set();
const seenPolicyEntries = new Set();
for (const decision of ["allow", "review", "deny"]) {
  for (const license of policy[decision]) {
    if (typeof license !== "string" || license.trim().length === 0) {
      throw new Error(`Invalid ${decision} license policy entry`);
    }
    const normalized = license.trim();
    if (seenPolicyEntries.has(normalized)) duplicates.add(normalized);
    seenPolicyEntries.add(normalized);
  }
}
if (duplicates.size > 0) {
  throw new Error(`License policy entries must be unique across decisions: ${[...duplicates].sort().join(", ")}`);
}

const normalizeLicense = (license) => {
  if (typeof license === "string" && license.trim()) return license.trim();
  if (Array.isArray(license)) {
    const values = license
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    if (values.length > 0) return values.join(" OR ");
  }
  if (license && typeof license === "object" && typeof license.type === "string" && license.type.trim()) {
    return license.type.trim();
  }
  return "UNKNOWN";
};

const looksSpdxLike = (license) => {
  if (license === "UNKNOWN") return false;
  if (/^SEE LICENSE IN /i.test(license)) return false;
  return /^[A-Za-z0-9.+-]+(?:\s+(?:AND|OR|WITH)\s+[A-Za-z0-9.+-]+)*(?:\s*\([^)]*\))?$/.test(license);
};

const classify = (license) => {
  if (policy.deny.includes(license)) return "deny";
  if (policy.allow.includes(license)) return "allow";
  if (policy.review.includes(license)) return "review";
  return policy.defaultDecision;
};

const lock = readJson("package-lock.json");
if (!lock.packages || typeof lock.packages !== "object") {
  throw new Error("package-lock.json does not expose packages inventory");
}

const packages = [];
for (const [path, locked] of Object.entries(lock.packages)) {
  if (!path.startsWith("node_modules/")) continue;
  const packageJsonPath = join(path, "package.json");
  let manifest;
  try {
    manifest = readJson(packageJsonPath);
  } catch {
    manifest = null;
  }

  const name = manifest?.name ?? locked?.name ?? path.replace(/^node_modules\//, "");
  const version = manifest?.version ?? locked?.version ?? null;
  const license = normalizeLicense(manifest?.license ?? locked?.license);
  const licenseKind = license === "UNKNOWN" ? "unknown" : looksSpdxLike(license) ? "spdx-like" : "custom";
  const decision = licenseKind === "unknown" || licenseKind === "custom" ? "review" : classify(license);

  packages.push({ name, version, license, licenseKind, decision, path });
}

packages.sort((a, b) => `${a.name}@${a.version ?? ""}`.localeCompare(`${b.name}@${b.version ?? ""}`));

const counts = { allow: 0, review: 0, deny: 0, unknown: 0, custom: 0 };
for (const item of packages) {
  counts[item.decision] += 1;
  if (item.licenseKind === "unknown") counts.unknown += 1;
  if (item.licenseKind === "custom") counts.custom += 1;
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  policyPath: POLICY_PATH,
  packageCount: packages.length,
  counts,
  packages,
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ result: counts.deny > 0 ? "blocked" : "ok", packageCount: packages.length, counts }));

if (counts.deny > 0) {
  console.error(`License policy blocked ${counts.deny} dependency package(s). See ${OUTPUT_PATH}.`);
  process.exit(1);
}
