import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/preview-smoke-policy.json"), "utf8"));
const rawArgs = process.argv.slice(2);
const valueArg = (prefix) => rawArgs.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const has = (flag) => rawArgs.includes(flag);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shaPattern = /^[a-f0-9]{40}$/;

const fail = (messages, exitCode = 1) => {
  for (const message of messages) console.error(`[preview-smoke] ${message}`);
  process.exitCode = exitCode;
};

const validateInput = ({ baseUrl, deployedSha }) => {
  const errors = [];
  if (!shaPattern.test(String(deployedSha ?? ""))) errors.push("deployed SHA must be a full 40-character lowercase commit SHA");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
      errors.push("base URL must be a canonical HTTPS origin");
    } else if (url.origin !== policy.allowedOrigin) {
      errors.push("base URL must match the fixed Preview origin");
    }
  } catch {
    errors.push("base URL must be a valid HTTPS origin");
  }
  return errors;
};

const matchesSubset = (actual, expected) => {
  if (!expected || typeof expected !== "object") return true;
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
};

const runCheck = async ({ baseUrl, check, cookie }) => {
  let last = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(new URL(check.path, baseUrl), {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: cookie ? { cookie } : undefined,
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > policy.maxResponseBytes) {
        last = { ok: false, status: response.status, reason: "response_too_large", attempt, durationMs: Date.now() - started };
      } else {
        let parsed = null;
        if (check.expectedJson) {
          try { parsed = JSON.parse(text); } catch { parsed = null; }
        }
        const statusOk = response.status === check.expectedStatus;
        const bodyOk = matchesSubset(parsed, check.expectedJson);
        last = {
          ok: statusOk && bodyOk,
          status: response.status,
          reason: statusOk ? (bodyOk ? "ok" : "unexpected_body") : "unexpected_status",
          attempt,
          durationMs: Date.now() - started,
        };
      }
    } catch {
      last = { ok: false, status: null, reason: "request_failed", attempt, durationMs: Date.now() - started };
    }
    if (last.ok) return last;
    if (attempt < policy.maxAttempts) await sleep(policy.retryDelayMs);
  }
  return last;
};

const execute = async ({ baseUrl, deployedSha, output }) => {
  const errors = validateInput({ baseUrl, deployedSha });
  if (errors.length) return fail(errors, 2);

  const results = [];
  for (const check of policy.checks) {
    const result = await runCheck({ baseUrl, check });
    results.push({ id: check.id, ...result });
    console.log(`[preview-smoke] ${check.id} ${result.ok ? "PASS" : "FAIL"} status=${result.status ?? "none"} attempts=${result.attempt}`);
    if (!result.ok) break;
  }

  const requiredOk = results.length === policy.checks.length && results.every((item) => item.ok);
  const cookieEnv = policy.optionalAuthenticatedCheck.cookieEnvironmentVariable;
  const cookie = process.env[cookieEnv];
  if (requiredOk && cookie) {
    const result = await runCheck({ baseUrl, check: policy.optionalAuthenticatedCheck, cookie });
    results.push({ id: policy.optionalAuthenticatedCheck.id, ...result });
    console.log(`[preview-smoke] ${policy.optionalAuthenticatedCheck.id} ${result.ok ? "PASS" : "FAIL"} status=${result.status ?? "none"} attempts=${result.attempt}`);
  }

  const ok = requiredOk && results.every((item) => item.ok);
  const evidence = {
    schemaVersion: policy.schemaVersion,
    environment: policy.environment,
    deployedSha,
    origin: new URL(baseUrl).origin,
    authenticatedCheckExecuted: Boolean(cookie),
    ok,
    results: results.map(({ id, ok: resultOk, status, reason, attempt, durationMs }) => ({
      id,
      ok: resultOk,
      status,
      reason,
      attempts: attempt,
      durationMs,
    })),
  };

  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
    fs.writeFileSync(path.resolve(root, output), JSON.stringify(evidence, null, 2) + "
");
  }
  if (!ok) process.exitCode = 1;
};

const selfTest = async () => {
  const valid = validateInput({ baseUrl: `${policy.allowedOrigin}/`, deployedSha: "a".repeat(40) });
  if (valid.length) throw new Error("valid input fixture failed");
  const invalid = validateInput({ baseUrl: "http://localhost:8787/path", deployedSha: "main" });
  if (invalid.length < 2) throw new Error("unsafe input fixture did not fail closed");
  if (!matchesSubset({ status: "ok", component: "runtime", extra: "ignored" }, { status: "ok", component: "runtime" })) {
    throw new Error("JSON subset matcher failed");
  }
  if (matchesSubset({ authenticated: true }, { authenticated: false })) throw new Error("JSON mismatch was not detected");
  if (policy.checks.some((check) => !String(check.path).startsWith("/") || !Number.isInteger(check.expectedStatus))) {
    throw new Error("smoke policy contains an invalid check");
  }
  console.log(`[preview-smoke] self-test PASS requiredChecks=${policy.checks.length}`);
};

if (has("--self-test")) {
  await selfTest();
} else {
  await execute({
    baseUrl: valueArg("--base-url="),
    deployedSha: valueArg("--deployed-sha="),
    output: valueArg("--output="),
  });
}
