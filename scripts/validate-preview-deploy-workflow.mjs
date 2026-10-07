import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync("config/preview-deploy-workflow-policy.json", "utf8"));
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const fail = (messages) => {
  for (const message of messages) console.error(`[preview-deploy-workflow] ${message}`);
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
  if (!/environment:\s*preview/m.test(text)) errors.push("deploy job must use environment: preview");
  if (!/needs:\s*preflight/m.test(text)) errors.push("deploy job must depend on preflight");
  if (!/actions\/checkout@v4[\s\S]*ref:\s*\$\{\{\s*inputs\.target_sha\s*\}\}/m.test(text)) {
    errors.push("workflow must checkout the explicit target SHA");
  }
  if (!/DEPLOY PREVIEW/.test(text)) errors.push("typed Preview confirmation is missing");
  if (!/wrangler deploy[\s\S]*--env preview/m.test(text)) errors.push("explicit wrangler deploy --env preview is missing");
  if (/--env\s+production/m.test(text)) errors.push("Production Wrangler environment must not be referenced");
  if (/d1 migrations apply/m.test(text)) errors.push("Preview deploy workflow must not execute D1 migrations");
  if (!text.includes(policy.previewDatabaseId)) errors.push("pinned Preview D1 database ID is missing");
  if (!/RUNTIME_ENVIRONMENT:\s*preview/m.test(text)) errors.push("Preview runtime environment label is missing");
  for (const command of policy.requiredValidationCommands) {
    if (!text.includes(command)) errors.push(`required validation command missing: ${command}`);
  }
  for (const secretName of policy.requiredSecretNames) {
    if (!text.includes(`secrets.${secretName}`)) errors.push(`required Preview secret reference missing: ${secretName}`);
  }
  if (/PRODUCTION_/m.test(text)) errors.push("Production secret/config reference must not appear in Preview deploy workflow");
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
  console.log("[preview-deploy-workflow] self-test passed");
};

if (args.has("self-test")) {
  try { selfTest(); } catch (error) { fail([error instanceof Error ? error.message : "unexpected error"]); }
} else {
  const errors = validateRequest({ targetSha: args.get("target-sha"), confirmation: args.get("confirmation") });
  if (errors.length) fail(errors);
  else console.log("[preview-deploy-workflow] request validation PASS");
}
