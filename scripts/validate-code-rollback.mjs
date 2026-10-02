import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync("config/code-rollback-policy.json", "utf8"));
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.join("=") || true];
}));

const isSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

const validate = ({ currentSha, previousStableSha, targetSha, confirmation, reason }) => {
  const errors = [];
  if (!isSha(currentSha)) errors.push("current-sha must be a full 40-character commit SHA");
  if (!isSha(previousStableSha)) errors.push("previous-stable-sha must be a full 40-character commit SHA");
  if (!isSha(targetSha)) errors.push("target-sha must be a full 40-character commit SHA");
  if (policy.requireTargetEqualsPreviousStable && targetSha !== previousStableSha) errors.push("target-sha must equal previous-stable-sha");
  if (policy.requireCurrentDiffersFromTarget && currentSha === targetSha) errors.push("current-sha must differ from rollback target");
  if (confirmation !== policy.confirmation) errors.push(`confirmation must equal ${policy.confirmation}`);
  const length = typeof reason === "string" ? reason.trim().length : 0;
  if (length < policy.reasonMinLength || length > policy.reasonMaxLength) errors.push(`reason must be ${policy.reasonMinLength}-${policy.reasonMaxLength} characters`);
  return { ok: errors.length === 0, errors };
};

if (args.has("self-test")) {
  const a = "1".repeat(40);
  const b = "2".repeat(40);
  const safe = validate({ currentSha: a, previousStableSha: b, targetSha: b, confirmation: policy.confirmation, reason: "Smoke verification failed after production deploy" });
  const unsafe = validate({ currentSha: a, previousStableSha: b, targetSha: a, confirmation: "ROLLBACK", reason: "bad" });
  if (!safe.ok || unsafe.ok || unsafe.errors.length < 3) {
    console.error("Code rollback validator self-test failed");
    process.exit(1);
  }
  console.log("Code rollback validator self-test passed");
  process.exit(0);
}

const result = validate({
  currentSha: args.get("current-sha"),
  previousStableSha: args.get("previous-stable-sha"),
  targetSha: args.get("target-sha"),
  confirmation: args.get("confirmation"),
  reason: args.get("reason"),
});
for (const error of result.errors) console.error(`[rollback] ${error}`);
console.log(`Code rollback validation: ${result.ok ? "PASS" : "FAIL"}`);
process.exit(result.ok ? 0 : 1);
