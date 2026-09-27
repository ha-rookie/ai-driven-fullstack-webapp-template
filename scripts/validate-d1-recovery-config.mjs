import fs from "node:fs";

const CONFIG_PATH = "wrangler.jsonc";
const PLACEHOLDER_ID_PREFIX = "00000000-0000-0000-0000-";

const fail = (message) => {
  console.error(`Recovery config validation failed: ${message}`);
  process.exit(1);
};

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch (error) {
  fail(`${CONFIG_PATH} must remain machine-parseable JSON for recovery tooling (${error instanceof Error ? error.message : "parse error"})`);
}

const production = config.d1_databases?.find((entry) => entry.binding === "DB");
const preview = config.previews?.d1_databases?.find((entry) => entry.binding === "DB");

const productionId = production?.database_id;
const previewId = production?.preview_database_id ?? preview?.database_id;
const productionName = production?.database_name;
const previewName = preview?.database_name;

if (!productionId || !previewId) {
  fail("both Production and Preview D1 database IDs are required");
}

if (!productionName || !previewName) {
  fail("both Production and Preview D1 database names are required");
}

if (
  productionId.startsWith(PLACEHOLDER_ID_PREFIX) ||
  previewId.startsWith(PLACEHOLDER_ID_PREFIX) ||
  productionName.startsWith("REPLACE_WITH_") ||
  previewName.startsWith("REPLACE_WITH_")
) {
  fail("placeholder D1 resources must be replaced before remote recovery rehearsal");
}

if (productionId === previewId) {
  fail("Preview and Production D1 database IDs must be different");
}

console.log("Recovery config validated: Preview and Production D1 resources are configured and distinct.");
