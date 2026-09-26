import { readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const compiledRoot = resolve(".test-dist");
const compiledTestsRoot = join(compiledRoot, "tests");

const collectTestFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(path);
    }
  }

  return files;
};

await writeFile(
  join(compiledRoot, "package.json"),
  JSON.stringify({ type: "commonjs" }),
  "utf8",
);

const testFiles = await collectTestFiles(compiledTestsRoot);

if (testFiles.length === 0) {
  await rm(compiledRoot, { recursive: true, force: true });
  throw new Error("No compiled test files found.");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

await rm(compiledRoot, { recursive: true, force: true });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
