import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.argv[2] ?? "package.json");
const lockfilePath = resolve(process.argv[3] ?? "package-lock.json");

const fail = (message) => {
  console.error(`lockfile_integrity_failed: ${message}`);
  process.exitCode = 1;
};

const readJson = async (path, label) => {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`${label}_missing`);
    }
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}_invalid_json`);
  }
};

const normalizedDependencyGroup = (value) => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("dependency_group_invalid");
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, version]) => [name, String(version)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};

const sameRecord = (left, right) => JSON.stringify(left) === JSON.stringify(right);

try {
  const manifest = await readJson(manifestPath, "package_json");
  const lockfile = await readJson(lockfilePath, "package_lock");

  if (!Number.isInteger(lockfile.lockfileVersion) || lockfile.lockfileVersion < 2) {
    throw new Error("unsupported_lockfile_version");
  }

  if (!lockfile.packages || typeof lockfile.packages !== "object" || Array.isArray(lockfile.packages)) {
    throw new Error("lockfile_packages_missing");
  }

  const root = lockfile.packages[""];
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error("lockfile_root_package_missing");
  }

  if (manifest.name && root.name && manifest.name !== root.name) {
    throw new Error("root_name_mismatch");
  }
  if (manifest.version && root.version && manifest.version !== root.version) {
    throw new Error("root_version_mismatch");
  }

  for (const group of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const manifestGroup = normalizedDependencyGroup(manifest[group]);
    const lockfileGroup = normalizedDependencyGroup(root[group]);
    if (!sameRecord(manifestGroup, lockfileGroup)) {
      throw new Error(`${group}_mismatch`);
    }
  }

  console.log(
    JSON.stringify({
      result: "ok",
      lockfileVersion: lockfile.lockfileVersion,
      rootDependencyCount:
        Object.keys(normalizedDependencyGroup(root.dependencies)).length +
        Object.keys(normalizedDependencyGroup(root.devDependencies)).length +
        Object.keys(normalizedDependencyGroup(root.optionalDependencies)).length,
    }),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown_error");
}
