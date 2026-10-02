import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync("config/security-validation-policy.json", "utf8"));

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const isPlaceholder = (value) => {
  const upper = String(value ?? "").toUpperCase();
  return !upper || policy.placeholderFragments.some((fragment) => upper.includes(fragment.toUpperCase()));
};

const validate = (config) => {
  const errors = [];
  const pass = [];
  const check = (condition, id, message) => {
    if (condition) pass.push(id);
    else errors.push({ id, message });
  };

  check(config?.schemaVersion === 1, "schema.version", "Unsupported security snapshot schema");
  check(["production", "preview"].includes(config?.environment), "environment.kind", "Environment must be production or preview");

  const primary = config?.resources?.primaryD1 ?? {};
  const counterpart = config?.resources?.counterpartD1 ?? {};
  check(!isPlaceholder(primary.name), "resource.primary.name", "Primary D1 name is missing or placeholder");
  check(!isPlaceholder(primary.id), "resource.primary.id", "Primary D1 id is missing or placeholder");
  check(!isPlaceholder(counterpart.name), "resource.counterpart.name", "Counterpart D1 name is missing or placeholder");
  check(!isPlaceholder(counterpart.id), "resource.counterpart.id", "Counterpart D1 id is missing or placeholder");
  check(primary.id && counterpart.id && primary.id !== counterpart.id, "resource.separation.id", "Preview and Production D1 ids must differ");
  check(primary.name && counterpart.name && primary.name !== counterpart.name, "resource.separation.name", "Preview and Production D1 names must differ");

  const origins = config?.http?.allowedOrigins;
  check(Array.isArray(origins) && origins.length > 0, "cors.origins.present", "At least one allowed origin is required");
  if (Array.isArray(origins)) {
    let safeOrigins = true;
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        if (url.protocol !== "https:" || url.origin !== origin || origin === "null" || origin.includes("*")) safeOrigins = false;
      } catch { safeOrigins = false; }
    }
    check(safeOrigins, "cors.origins.https", "Allowed origins must be canonical HTTPS origins without wildcard/null");
  }

  const cookie = config?.http?.cookie ?? {};
  check(cookie.secure === true, "cookie.secure", "Session cookie must be Secure");
  check(cookie.httpOnly === true, "cookie.httpOnly", "Session cookie must be HttpOnly");
  check(policy.allowedSameSite.includes(cookie.sameSite), "cookie.sameSite", "Session cookie SameSite value is not allowed by policy");

  const csp = String(config?.http?.contentSecurityPolicy ?? "");
  check(Boolean(csp), "csp.present", "Content-Security-Policy is required");
  for (const directive of policy.requiredCspDirectives) {
    check(csp.includes(`${directive} `) || csp.startsWith(`${directive} `), `csp.${directive}`, `Required CSP directive is missing: ${directive}`);
  }
  for (const fragment of policy.forbiddenCspFragments) {
    check(!csp.includes(fragment), `csp.forbid.${fragment}`, `Forbidden CSP fragment is present`);
  }

  const idle = Number(config?.session?.idleTimeoutSeconds);
  const touch = Number(config?.session?.touchIntervalSeconds);
  check(Number.isInteger(idle) && idle > 0 && idle <= policy.maxSessionIdleSeconds, "session.idle", "Session idle timeout is invalid or exceeds policy maximum");
  check(Number.isInteger(touch) && touch > 0 && touch < idle, "session.touch", "Session touch interval must be positive and shorter than idle timeout");

  check(config?.runtime?.debug !== true, "runtime.debug", "Debug mode must be disabled");
  check(config?.runtime?.devMode !== true, "runtime.devMode", "Development mode must be disabled");

  return { ok: errors.length === 0, pass, errors };
};

const printResult = (result) => {
  for (const id of result.pass) console.log(`[PASS] ${id}`);
  for (const error of result.errors) console.error(`[FAIL] ${error.id}: ${error.message}`);
  console.log(`Security configuration validation: ${result.ok ? "PASS" : "FAIL"} (${result.pass.length} passed, ${result.errors.length} failed)`);
};

const validFixture = {
  schemaVersion: 1,
  environment: "production",
  resources: {
    primaryD1: { name: "prod-app-db", id: "11111111-1111-4111-8111-111111111111" },
    counterpartD1: { name: "preview-app-db", id: "22222222-2222-4222-8222-222222222222" }
  },
  http: {
    allowedOrigins: ["https://app.acme.invalid"],
    cookie: { secure: true, httpOnly: true, sameSite: "Lax" },
    contentSecurityPolicy: "default-src 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self'"
  },
  session: { idleTimeoutSeconds: 1800, touchIntervalSeconds: 300 },
  runtime: { debug: false, devMode: false }
};

if (args.has("self-test")) {
  const valid = validate(validFixture);
  const unsafe = validate({
    ...validFixture,
    resources: { primaryD1: validFixture.resources.primaryD1, counterpartD1: validFixture.resources.primaryD1 },
    http: { ...validFixture.http, allowedOrigins: ["http://localhost:5173"], cookie: { secure: false, httpOnly: true, sameSite: "Lax" } },
    session: { idleTimeoutSeconds: 1800, touchIntervalSeconds: 1800 },
    runtime: { debug: true, devMode: false }
  });
  if (!valid.ok || unsafe.ok || unsafe.errors.length < 4) {
    console.error("Security configuration validator self-test failed");
    process.exit(1);
  }
  console.log("Security configuration validator self-test passed");
  process.exit(0);
}

const configPath = args.get("config");
if (!configPath || configPath === true) {
  console.error("Usage: npm run security:validate -- --config=<security-snapshot.json>");
  process.exit(2);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  console.error("[FAIL] input.config: Security snapshot could not be read as JSON");
  process.exit(2);
}

const result = validate(config);
printResult(result);
process.exit(result.ok ? 0 : 1);
