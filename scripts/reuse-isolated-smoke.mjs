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

  console.log(`[isolated-reuse] PASS: copied ${portableFiles.length} TS files into an independent temporary project`);
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}
