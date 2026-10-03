import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED_DECISIONS = [
  "retentionPolicy",
  "deletionPolicy",
  "longTermBackup",
  "backupStorage",
  "backupEncryption",
  "backupAccessControl",
  "backupEnvironmentSeparation",
  "restoreRehearsal",
  "backupEvidenceRetention",
  "deletedDataInBackups"
];

const VALID_STATES = new Set(["undecided", "decided", "not-applicable"]);

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function validatePolicy(policy, { requireDecided = false } = {}) {
  const errors = [];

  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["policy must be a JSON object"];
  }

  if (policy.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }

  if (!policy.safety || typeof policy.safety !== "object") {
    errors.push("safety must be an object");
  } else {
    if (policy.safety.allowPublicBackupArtifacts !== false) {
      errors.push("safety.allowPublicBackupArtifacts must remain false");
    }
    if (policy.safety.allowProductionBackupInPrCi !== false) {
      errors.push("safety.allowProductionBackupInPrCi must remain false");
    }
  }

  if (!policy.decisions || typeof policy.decisions !== "object" || Array.isArray(policy.decisions)) {
    errors.push("decisions must be an object");
    return errors;
  }

  for (const key of REQUIRED_DECISIONS) {
    const decision = policy.decisions[key];
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
      errors.push(`decisions.${key} must be an object`);
      continue;
    }

    if (!VALID_STATES.has(decision.state)) {
      errors.push(`decisions.${key}.state must be decided, undecided, or not-applicable`);
      continue;
    }

    const rationale = typeof decision.rationale === "string" ? decision.rationale.trim() : "";

    if (decision.state === "undecided") {
      if (decision.value !== null) {
        errors.push(`decisions.${key}.value must be null while undecided`);
      }
      if (requireDecided) {
        errors.push(`decisions.${key} is still undecided`);
      }
    }

    if (decision.state === "decided" && !hasMeaningfulValue(decision.value)) {
      errors.push(`decisions.${key}.value must be non-empty when decided`);
    }

    if (decision.state === "not-applicable") {
      if (decision.value !== null) {
        errors.push(`decisions.${key}.value must be null when not-applicable`);
      }
      if (!rationale) {
        errors.push(`decisions.${key}.rationale is required when not-applicable`);
      }
    }
  }

  const storage = policy.decisions.backupStorage;
  if (storage?.state === "decided") {
    if (!storage.value || typeof storage.value !== "object" || Array.isArray(storage.value)) {
      errors.push("decisions.backupStorage.value must be an object when decided");
    } else if (storage.value.visibility !== "private") {
      errors.push("decisions.backupStorage.value.visibility must be private");
    }
  }

  const separation = policy.decisions.backupEnvironmentSeparation;
  if (separation?.state === "decided" && separation.value !== true) {
    errors.push("decisions.backupEnvironmentSeparation.value must be true when decided");
  }

  return errors;
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function runSelfTest() {
  const root = await mkdtemp(join(tmpdir(), "data-lifecycle-policy-"));
  try {
    const base = {
      schemaVersion: 1,
      safety: {
        allowPublicBackupArtifacts: false,
        allowProductionBackupInPrCi: false
      },
      decisions: Object.fromEntries(
        REQUIRED_DECISIONS.map((key) => [key, { state: "undecided", value: null, rationale: "" }])
      )
    };

    const exampleErrors = validatePolicy(base);
    if (exampleErrors.length > 0) {
      throw new Error(`expected undecided example to be structurally valid: ${exampleErrors.join("; ")}`);
    }

    const requiredErrors = validatePolicy(base, { requireDecided: true });
    if (requiredErrors.length !== REQUIRED_DECISIONS.length) {
      throw new Error("require-decided must report every undecided decision");
    }

    const decided = structuredClone(base);
    for (const key of REQUIRED_DECISIONS) {
      decided.decisions[key] = { state: "decided", value: "project-defined", rationale: "" };
    }
    decided.decisions.backupStorage.value = {
      visibility: "private",
      provider: "project-defined",
      locationRef: "project-approved-non-secret-reference"
    };
    decided.decisions.backupEnvironmentSeparation.value = true;

    const decidedErrors = validatePolicy(decided, { requireDecided: true });
    if (decidedErrors.length > 0) {
      throw new Error(`expected decided policy to pass: ${decidedErrors.join("; ")}`);
    }

    const unsafe = structuredClone(decided);
    unsafe.safety.allowPublicBackupArtifacts = true;
    unsafe.decisions.backupStorage.value.visibility = "public";
    unsafe.decisions.backupEnvironmentSeparation.value = false;
    const unsafeErrors = validatePolicy(unsafe);
    if (unsafeErrors.length < 3) {
      throw new Error("unsafe policy invariants were not rejected");
    }

    const file = join(root, "policy.json");
    await writeFile(file, JSON.stringify(decided, null, 2));
    const loaded = await loadJson(file);
    if (validatePolicy(loaded, { requireDecided: true }).length !== 0) {
      throw new Error("serialized decided policy failed validation");
    }

    console.log("data lifecycle policy self-test: ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await runSelfTest();
    return;
  }

  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : "config/data-lifecycle-policy.example.json";
  const requireDecided = args.includes("--require-decided");

  if (!file) {
    throw new Error("--file requires a path");
  }

  const policy = await loadJson(file);
  const errors = validatePolicy(policy, { requireDecided });
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`data lifecycle policy valid: ${file}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
