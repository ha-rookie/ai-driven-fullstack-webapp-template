import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve(process.env.SBOM_OUTPUT ?? "artifacts/sbom.cdx.json");

const raw = execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["sbom", "--sbom-format=cyclonedx"],
  {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  },
);

let sbom;
try {
  sbom = JSON.parse(raw);
} catch {
  throw new Error("npm sbom did not return valid JSON");
}

if (sbom?.bomFormat !== "CycloneDX") {
  throw new Error("SBOM must use CycloneDX format");
}

if (typeof sbom.specVersion !== "string" || sbom.specVersion.length === 0) {
  throw new Error("SBOM must declare a CycloneDX specVersion");
}

if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
  throw new Error("SBOM must contain dependency components");
}

if (!Array.isArray(sbom.dependencies) || sbom.dependencies.length === 0) {
  throw new Error("SBOM must contain dependency relationships");
}

for (const component of sbom.components) {
  if (
    typeof component?.name !== "string" ||
    component.name.length === 0 ||
    typeof component?.version !== "string" ||
    component.version.length === 0
  ) {
    throw new Error("Every SBOM component must include name and version");
  }
}

for (const dependency of sbom.dependencies) {
  if (typeof dependency?.ref !== "string" || !Array.isArray(dependency.dependsOn)) {
    throw new Error("Every SBOM dependency relationship must include ref and dependsOn");
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    result: "ok",
    format: sbom.bomFormat,
    specVersion: sbom.specVersion,
    componentCount: sbom.components.length,
    dependencyRelationshipCount: sbom.dependencies.length,
    output: outputPath,
  }),
);
