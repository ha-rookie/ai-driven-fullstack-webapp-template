import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

// Execute the real TypeScript adapter against Wrangler Local D1. This temporary
// directory contains only this test's compiled code and dedicated D1 state.
const scratch = mkdtempSync(join(tmpdir(), "operation-mode-local-"));
try {
  const compiled = join(scratch, "compiled");
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"),
    "src/infrastructure/d1-operation-mode-store.ts", "--outDir", compiled,
    "--rootDir", "src", "--target", "ES2023", "--module", "CommonJS",
    "--moduleResolution", "Node", "--types", "node,@cloudflare/workers-types",
    "--strict", "--skipLibCheck"], { stdio: "inherit" });
  writeFileSync(join(compiled, "package.json"), '{"type":"commonjs"}');
  const require = createRequire(import.meta.url);
  const { D1OperationModeStore } = require(join(compiled, "infrastructure/d1-operation-mode-store.js"));
  const { OperationModeUnavailableError } = require(join(compiled, "domain/operation-mode.js"));
  const cli = resolve("node_modules/wrangler/bin/wrangler.js");
  const run = (args) => execFileSync(process.execPath, [cli, "d1", "execute", "DB", "--local",
    "--persist-to", join(scratch, "state"), "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
  run(["--file", "migrations/0015_operation_modes.sql"]);
  const literal = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string") return "'" + value.replaceAll("'", "''") + "'";
    throw new TypeError("Unsupported fixture binding");
  };
  const db = { prepare(sql) { return { bind(...values) { return { async first() {
    let i = 0;
    const rendered = sql.replaceAll("?", () => literal(values[i++]));
    assert.equal(i, values.length);
    const output = JSON.parse(run(["--command", rendered]));
    return output[0].results[0] ?? null;
  } }; } }; } };
  const clock = { now: () => new Date("2026-10-02T10:00:00.000Z") };
  const preview = new D1OperationModeStore(db, "preview", clock);
  const production = new D1OperationModeStore(db, "production", clock);
  await assert.rejects(preview.read(), (e) => e instanceof OperationModeUnavailableError && e.reason === "missing");
  const change = { mode: "normal", expectedVersion: 0, updatedBy: "operator-1", reason: "Explicit initialization" };
  assert.equal((await preview.update(change)).kind, "updated");
  assert.equal((await production.update(change)).kind, "updated");
  const observed = await preview.read();
  assert.equal(observed.version, 1);
  assert.equal((await preview.update({ ...change, mode: "read-only", expectedVersion: observed.version })).kind, "updated");
  assert.equal((await preview.update({ ...change, mode: "maintenance", expectedVersion: observed.version })).kind, "conflict");
  assert.equal((await preview.update(change)).kind, "conflict");
  const current = await preview.read();
  assert.equal(current.mode, "read-only");
  assert.equal(current.version, 2);
  assert.equal(current.updatedBy, change.updatedBy);
  assert.equal(current.reason, change.reason);
  assert.equal(current.updatedAt, clock.now().toISOString());
  assert.equal((await production.read()).mode, "normal");
  assert.equal((await preview.update({ ...change, mode: "maintenance", expectedVersion: 2 })).kind, "updated");
  assert.equal((await preview.update({ ...change, mode: "normal", expectedVersion: 3 })).kind, "updated");
  for (const assignment of ["mode='unknown'", "version=0", "environment='other'", "reason=''", "updated_by=''"]) {
    assert.throws(() => run(["--command", `UPDATE operation_modes SET ${assignment} WHERE environment='preview'`]), "constraint must reject " + assignment);
  }
  assert.equal((await preview.read()).version, 4);
  console.log("Operation mode adapter Local D1 contract passed (isolated state, no remote resources)");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
