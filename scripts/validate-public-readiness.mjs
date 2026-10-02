import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const required = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE"];
const errors = [];

for (const name of required) {
  const path = resolve(root, name);
  if (!existsSync(path) || !readFileSync(path, "utf8").trim()) {
    errors.push(`Missing or empty required document: ${name}`);
    continue;
  }
  if (!name.endsWith(".md")) continue;
  const content = readFileSync(path, "utf8");
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const localPath = target.split("#")[0];
    const destination = resolve(dirname(path), localPath);
    if (isAbsolute(localPath) || !destination.startsWith(root.endsWith(sep) ? root : root + sep) || !existsSync(destination)) {
      errors.push(`Invalid local link in ${name}: ${target}`);
    }
  }
}

const readme = existsSync(resolve(root, "README.md"))
  ? readFileSync(resolve(root, "README.md"), "utf8") : "";
for (const target of ["CONTRIBUTING.md", "SECURITY.md", "LICENSE", "#local-development"]) {
  if (!readme.includes(`](${target})`)) errors.push(`README missing entry link: ${target}`);
}
if (!/^## Local development$/m.test(readme)) errors.push("README missing Quick Start destination");

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Public readiness documents and local entry links validated");
}
