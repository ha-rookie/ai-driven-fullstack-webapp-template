/**
 * #475 isolated consumer acceptance. Builds a temporary, physically separate
 * TypeScript project using ONLY the explicitly selected source files.
 * No network calls, no npm install, no Cloudflare runtime, no persistent DB.
 *
 * This is an INTERNAL portability check, not external adoption or a fair
 * comparison of developer effort against AI-generated alternatives.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableFiles = [
  "src/worker/workflow/types.ts",
  "src/worker/workflow/service.ts",
  "src/worker/workflow/in-memory-store.ts",
  "src/worker/authorization/types.ts",
  "src/worker/authorization/policy.ts",
  "examples/reuse/purchase-approval.ts",
];
const runner = "examples/reuse/isolated-consumer-runner.cjs";
const compiler = join(repository, "node_modules/typescript/bin/tsc");

const run = (label, args, cwd, timeout) => {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    timeout,
    // The isolated project does not inherit Cloudflare credentials or tokens.
    env: { PATH: process.env.PATH || "" },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw new Error(`[isolated-reuse] ${label} failed: ${result.error?.message ?? result.status}`);
  }
};

async function emittedJsFiles(directory, root = directory) {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) output.push(...await emittedJsFiles(path, root));
    else if (item.isFile() && item.name.endsWith(".js")) output.push(relative(root, path).replaceAll("\\", "/"));
  }
  return output;
}

const isolatedRoot = await mkdtemp(join(tmpdir(), "workflow-reuse-isolated-"));
try {
  for (const path of [...portableFiles, runner]) {
    const destination = join(isolatedRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repository, path), destination);
  }
  await writeFile(join(isolatedRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "CommonJS",
      moduleResolution: "Node",
      lib: ["ES2023", "DOM"],
      types: [],
      strict: true,
      skipLibCheck: true,
      rootDir: ".",
      outDir: "dist",
    },
    files: ["examples/reuse/purchase-approval.ts"],
  }, null, 2) + "\n");

  // This local TypeScript installation is a testing tool; not a dependency
  // available to the isolated consumer at runtime.
  run("compile without Cloudflare/Node type packages", [compiler, "--project", join(isolatedRoot, "tsconfig.json")],
    isolatedRoot, 90_000);

  const output = (await emittedJsFiles(join(isolatedRoot, "dist"))).sort();
  const expected = portableFiles.map((path) => path.replace(/\.ts$/u, ".js")).sort();
  assert.deepEqual(output, expected, "only the six allowlisted TS files may be compiled");

  // Executed in a tree without node_modules or other project sources.
  run("runtime business and boundary acceptance",
    [join(isolatedRoot, "examples/reuse/isolated-consumer-runner.cjs")], isolatedRoot, 20_000);

  // Apply the same frozen business acceptance to A and a small isolated
  // greenfield B. B was authored by the already-informed assistant, not an
  // independent AI agent; this intentionally cannot measure AI productivity.
  const acceptance = "examples/reuse/comparison-purchase-acceptance.cjs";
  await mkdir(dirname(join(isolatedRoot, acceptance)), { recursive: true });
  await copyFile(join(repository, acceptance), join(isolatedRoot, acceptance));
  run("A shared purchase acceptance",
    [join(isolatedRoot, acceptance), "dist/examples/reuse/purchase-approval.js"],
    isolatedRoot, 20_000);

  const baselineRoot = join(isolatedRoot, "greenfield-b");
  const baselineFile = "examples/reuse/comparison-greenfield-purchase.ts";
  await mkdir(dirname(join(baselineRoot, baselineFile)), { recursive: true });
  await copyFile(join(repository, baselineFile), join(baselineRoot, baselineFile));
  await copyFile(join(repository, acceptance), join(baselineRoot, "comparison-acceptance.cjs"));
  await writeFile(join(baselineRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "CommonJS",
      moduleResolution: "Node",
      lib: ["ES2023", "DOM"],
      types: [],
      strict: true,
      skipLibCheck: true,
      rootDir: ".",
      outDir: "dist",
    },
    files: [baselineFile],
  }, null, 2) + "\n");
  run("B greenfield no-dependency TypeScript compile",
    [compiler, "--project", join(baselineRoot, "tsconfig.json")], baselineRoot, 90_000);
  assert.deepEqual(await emittedJsFiles(join(baselineRoot, "dist")),
    ["examples/reuse/comparison-greenfield-purchase.js"],
    "greenfield B must not introduce transitive source dependencies");
  run("B shared purchase acceptance",
    [join(baselineRoot, "comparison-acceptance.cjs"), "dist/examples/reuse/comparison-greenfield-purchase.js"],
    baselineRoot, 20_000);

  // Descriptive only. These are not equivalent implementations in breadth:
  // A has generic Workflow capabilities beyond the 12 fixed purchase cases.
  const { readFile } = await import("node:fs/promises");
  const countNonblank = async (root, files) =>
    (await Promise.all(files.map((file) => readFile(join(root, file), "utf8"))))
      .reduce((total, content) => total + content.split("\n").filter((line) => line.trim()).length, 0);
  console.log("PURCHASE_COMPARISON_SCOPE " + JSON.stringify({
    evidence: "INTERNAL_NON_BLIND",
    commonAcceptanceCases: 12,
    aSourceFiles: portableFiles.length,
    aNonblankSourceLines: await countNonblank(repository, portableFiles),
    bSourceFiles: 1,
    bNonblankSourceLines: await countNonblank(repository, [baselineFile]),
    limitations: "in-memory-only; no external AI comparison, durable store, audit, or measured engineer time",
  }));
  console.log(`[isolated-reuse] PASS: copied ${portableFiles.length} TS files into an independent temporary project`);
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
