import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync("config/production-deploy-workflow-policy.json", "utf8"));
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const fail = (messages) => {
  for (const message of messages) console.error(`[production-deploy-workflow] ${message}`);
  process.exitCode = 1;
};

const validateRequest = ({ targetSha, confirmation }) => {
  const errors = [];
  if (typeof targetSha !== "string" || !new RegExp(policy.targetShaPattern).test(targetSha)) {
    errors.push("targetSha must be a full 40-character lowercase commit SHA");
  }
  if (confirmation !== policy.requiredConfirmation) {
    errors.push(`confirmation must exactly equal ${policy.requiredConfirmation}`);
  }
  return errors;
};

const validateWorkflowText = (text) => {
  const errors = [];
  if (!/workflow_dispatch\s*:/m.test(text)) errors.push("workflow_dispatch trigger is required");
  for (const trigger of policy.forbiddenTriggers) {
    if (new RegExp(`^\\s*${trigger}\\s*:`, "m").test(text)) errors.push(`forbidden trigger present: ${trigger}`);
  }
  if (!/environment:\s*production/m.test(text)) errors.push("deploy job must use environment: production");
  if (!/needs:\s*preflight/m.test(text)) errors.push("deploy job must depend on preflight");
  if (!/actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*inputs\.target_sha\s*\}\}/m.test(text)) {
    errors.push("workflow must checkout the explicit target SHA");
  }
  if (!/DEPLOY PRODUCTION/.test(text)) errors.push("typed Production confirmation is missing");
  if (!/wrangler deploy[\s\S]*--config/m.test(text)) errors.push("explicit wrangler deploy --config is missing");
  if (/d1 migrations apply/m.test(text)) errors.push("Production deploy workflow must not execute D1 migrations");
  if (/rollback|restore|reseed|reset/mi.test(text) && !/must not|does not|no automatic/mi.test(text)) {
    errors.push("workflow appears to contain rollback/restore/reset/reseed behavior");
  }
  for (const command of policy.requiredValidationCommands) {
    if (!text.includes(command)) errors.push(`required validation command missing: ${command}`);
  }
  for (const secretName of policy.requiredSecretNames) {
    if (!text.includes(`secrets.${secretName}`)) errors.push(`required production secret reference missing: ${secretName}`);
  }
  return errors;
};

const selfTest = () => {
  const safeRequest = { targetSha: "a".repeat(40), confirmation: policy.requiredConfirmation };
  if (validateRequest(safeRequest).length) throw new Error("safe request unexpectedly failed validation");
  const unsafeRequest = { targetSha: "main", confirmation: "yes" };
  if (validateRequest(unsafeRequest).length < 2) throw new Error("unsafe request did not fail closed");

  const workflow = fs.readFileSync(policy.workflowPath, "utf8");
  const workflowErrors = validateWorkflowText(workflow);
  if (workflowErrors.length) throw new Error(workflowErrors.join("\n"));

  console.log("[production-deploy-workflow] self-test passed");
};

if (args.has("self-test")) {
  try {
    selfTest();
  } catch (error) {
    fail([error instanceof Error ? error.message : "unexpected error"]);
  }
} else {
  const errors = validateRequest({ targetSha: args.get("target-sha"), confirmation: args.get("confirmation") });
  if (errors.length) fail(errors);
  else console.log("[production-deploy-workflow] request validation PASS");
}
