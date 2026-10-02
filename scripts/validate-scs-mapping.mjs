import fs from 'node:fs';
import path from 'node:path';

const mappingPath = process.env.SCS_MAPPING_PATH ?? 'config/scs-control-mapping.json';
const absolutePath = path.resolve(mappingPath);

function fail(message) {
  console.error(`SCS mapping validation failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(absolutePath)) fail(`${mappingPath} does not exist`);

let mapping;
try {
  mapping = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
} catch (error) {
  fail(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (mapping.schemaVersion !== 1) fail('schemaVersion must be 1');
if (!mapping.source || typeof mapping.source !== 'object') fail('source metadata is required');
if (!Array.isArray(mapping.statusVocabulary)) fail('statusVocabulary must be an array');
if (!Array.isArray(mapping.requirements)) fail('requirements must be an array');

const expectedStatuses = new Set([
  'Implemented',
  'Partially Implemented',
  'Project Responsibility',
  'Organization Responsibility',
  'Not Applicable',
  'Not Yet Implemented',
]);
const actualStatuses = new Set(mapping.statusVocabulary);
if (actualStatuses.size !== expectedStatuses.size || [...expectedStatuses].some((value) => !actualStatuses.has(value))) {
  fail('statusVocabulary does not match the approved #82 vocabulary');
}

const expectedStar3Ids = new Set([
  '1-2-1','1-2-3','1-3-1',
  '2-1-1','2-1-2','2-1-4',
  '3-1-1','3-1-2','3-1-3','3-1-4',
  '4-1-1','4-1-2','4-1-3','4-1-4','4-1-5','4-1-6','4-1-7',
  '4-2-2','4-3-4','4-4-1','4-4-4','4-4-5','4-5-1',
  '5-1-1','6-1-1','7-1-1',
]);
const expectedStar4OnlyIds = new Set([
  '1-1-1','1-2-2','1-4-1',
  '2-1-3','2-1-5',
  '3-1-5','3-2-1',
  '4-1-8','4-1-9','4-2-1','4-3-1','4-3-2','4-3-3','4-4-2','4-4-3',
  '5-1-2','5-2-1',
]);

const seen = new Set();
const star3Ids = new Set();
const star4OnlyIds = new Set();

for (const requirement of mapping.requirements) {
  if (!requirement || typeof requirement !== 'object') fail('every requirement must be an object');
  if (typeof requirement.id !== 'string' || !/^\d+-\d+-\d+$/.test(requirement.id)) fail(`invalid requirement id: ${String(requirement.id)}`);
  if (seen.has(requirement.id)) fail(`duplicate requirement id: ${requirement.id}`);
  seen.add(requirement.id);

  if (!['star3-and-star4', 'star4-only'].includes(requirement.level)) fail(`invalid level for ${requirement.id}`);
  if (!expectedStatuses.has(requirement.status)) fail(`invalid status for ${requirement.id}: ${requirement.status}`);
  if (typeof requirement.name !== 'string' || requirement.name.trim() === '') fail(`name is required for ${requirement.id}`);
  if (typeof requirement.control !== 'string' || requirement.control.trim() === '') fail(`control/responsibility note is required for ${requirement.id}`);

  if (['Implemented', 'Partially Implemented'].includes(requirement.status)) {
    if (typeof requirement.test !== 'string' || requirement.test.trim() === '') fail(`test mapping is required for ${requirement.id}`);
    if (typeof requirement.evidence !== 'string' || requirement.evidence.trim() === '') fail(`evidence mapping is required for ${requirement.id}`);
  }

  if (requirement.level === 'star3-and-star4') star3Ids.add(requirement.id);
  else star4OnlyIds.add(requirement.id);
}

if (mapping.requirements.length !== 43) fail(`expected 43 ★4 requirements, found ${mapping.requirements.length}`);
if (star3Ids.size !== 26) fail(`expected 26 ★3 requirements, found ${star3Ids.size}`);
if (star4OnlyIds.size !== 17) fail(`expected 17 ★4-only requirements, found ${star4OnlyIds.size}`);

for (const id of expectedStar3Ids) if (!star3Ids.has(id)) fail(`missing ★3 requirement ${id}`);
for (const id of star3Ids) if (!expectedStar3Ids.has(id)) fail(`unexpected ★3 requirement ${id}`);
for (const id of expectedStar4OnlyIds) if (!star4OnlyIds.has(id)) fail(`missing ★4-only requirement ${id}`);
for (const id of star4OnlyIds) if (!expectedStar4OnlyIds.has(id)) fail(`unexpected ★4-only requirement ${id}`);

if (mapping.source.expectedStar3RequirementCount !== 26) fail('source expectedStar3RequirementCount must be 26');
if (mapping.source.expectedStar4RequirementCount !== 43) fail('source expectedStar4RequirementCount must be 43');
if (mapping.source.expectedStar4AdditionalRequirementCount !== 17) fail('source expectedStar4AdditionalRequirementCount must be 17');

for (const key of ['officialRequirementsPage', 'officialRequirementsExcel', 'metiPolicy', 'verifiedAt']) {
  if (typeof mapping.source[key] !== 'string' || mapping.source[key].trim() === '') fail(`source.${key} is required`);
}

const summary = mapping.requirements.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});

console.log(`SCS control mapping valid: ${mapping.requirements.length} requirements (★3=${star3Ids.size}, ★4-only=${star4OnlyIds.size}).`);
console.log(JSON.stringify(summary));
