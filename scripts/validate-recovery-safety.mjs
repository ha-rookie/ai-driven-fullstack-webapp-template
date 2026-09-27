import fs from "node:fs";

const workflowPath = ".github/workflows/d1-recovery-rehearsal.yml";
const scriptPath = "scripts/d1-recovery-rehearsal.sh";
const packagePath = "package.json";

const workflow = fs.readFileSync(workflowPath, "utf8");
const rehearsal = fs.readFileSync(scriptPath, "utf8");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const assert = (condition, message) => {
  if (!condition) {
    console.error(`Recovery safety validation failed: ${message}`);
    process.exit(1);
  }
};

const onBlock = workflow.split("on:\n", 2)[1]?.split("\npermissions:", 1)[0] ?? "";

assert(onBlock.includes("workflow_dispatch:"), "recovery workflow must use workflow_dispatch");
assert(!/^\s*(push|pull_request|schedule):/m.test(onBlock), "recovery workflow must not run from push, pull_request, or schedule");
assert(workflow.includes("inputs.confirmation"), "workflow must pass an explicit confirmation input");
assert(workflow.includes("REHEARSE_PREVIEW"), "workflow must require the REHEARSE_PREVIEW phrase");
assert(workflow.includes("cancel-in-progress: false"), "recovery runs must not cancel an in-progress restore rehearsal");
assert(workflow.includes("CLOUDFLARE_API_TOKEN"), "workflow must require Cloudflare API credentials");
assert(workflow.includes("CLOUDFLARE_ACCOUNT_ID"), "workflow must require the Cloudflare account ID");
assert(workflow.includes("npm run db:recovery:validate-config"), "workflow must validate D1 configuration before remote work");
assert(workflow.includes("npm run db:recovery:preview"), "workflow must call only the Preview recovery rehearsal command");

assert(rehearsal.includes('RECOVERY_REHEARSAL_CONFIRM:-}'), "rehearsal script must validate explicit confirmation");
assert(rehearsal.includes('!= "REHEARSE_PREVIEW"'), "rehearsal script must fail closed on confirmation mismatch");
assert(rehearsal.includes('[[ "$PREVIEW_DB_ID" == "$PRODUCTION_DB_ID" ]]'), "rehearsal script must reject identical Preview and Production IDs");
assert(rehearsal.includes('API_BASE="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$PREVIEW_DB_ID/time_travel"'), "Time Travel API target must be derived from the Preview DB ID");
assert(rehearsal.includes("node scripts/validate-d1-recovery-config.mjs"), "rehearsal script must reject placeholder configuration before remote work");
assert(!rehearsal.includes("time-travel restore DB"), "Production-style Wrangler restore command must not exist in the automated rehearsal script");

assert(pkg.scripts?.["db:recovery:preview"] === "bash scripts/d1-recovery-rehearsal.sh", "package must expose only the guarded Preview rehearsal command");
assert(pkg.scripts?.["db:recovery:validate-config"] === "node scripts/validate-d1-recovery-config.mjs", "package must expose recovery config validation");

console.log("Recovery safety contract validated without remote D1 access.");
