import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ALLOWED_STATUSES = new Set(['undecided', 'decided', 'not-applicable']);

const REQUIRED_DECISION_PATHS = [
  'project.name',
  'project.owner',
  'requirement.primaryActors',
  'requirement.resourceScope',
  'requirement.dataSensitivity',
  'architecture.runtimeBoundary',
  'architecture.domainReplacementPlan',
  'architecture.externalServices',
  'identityAndAccess.identityProvider',
  'identityAndAccess.resourceScopes',
  'identityAndAccess.rolePolicy',
  'identityAndAccess.privilegedOperations',
  'data.schemaOwnership',
  'data.migrationSequence',
  'data.retentionAndDeletion',
  'data.backupAndRecovery',
  'api.collectionContract',
  'api.versioningMechanism',
  'api.externalConsumers',
  'environments.previewResources',
  'environments.productionResources',
  'environments.originSeparation',
  'operations.slo',
  'operations.rpoRto',
  'operations.auditRetention',
  'operations.releaseAndProductionVerification',
  'performance.frontendBudget',
  'performance.apiLoadBudget',
  'supplyChain.dependencyUpdateCadence',
  'supplyChain.securityAdvisoryResponse'
];

function isNonEmptyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function getAtPath(object, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], object);
}

function validateDecision(dottedPath, decision, { requireDecided }) {
  const errors = [];
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return [`${dottedPath}: decision must be an object`];
  }

  if (!ALLOWED_STATUSES.has(decision.status)) {
    errors.push(`${dottedPath}: status must be undecided, decided, or not-applicable`);
    return errors;
  }

  if (decision.status === 'undecided') {
    if (decision.value !== null) {
      errors.push(`${dottedPath}: undecided decisions must keep value=null`);
    }
    if (requireDecided) {
      errors.push(`${dottedPath}: decision is still undecided`);
    }
  }

  if (decision.status === 'decided' && !isNonEmptyValue(decision.value)) {
    errors.push(`${dottedPath}: decided decisions require a non-empty value`);
  }

  if (decision.status === 'not-applicable') {
    if (decision.value !== null) {
      errors.push(`${dottedPath}: not-applicable decisions must keep value=null`);
    }
    if (typeof decision.rationale !== 'string' || decision.rationale.trim().length === 0) {
      errors.push(`${dottedPath}: not-applicable decisions require rationale`);
    }
  }

  return errors;
}

export function validateProfile(profile, { requireDecided = false } = {}) {
  const errors = [];

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['profile must be a JSON object'];
  }
  if (profile.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }

  for (const dottedPath of REQUIRED_DECISION_PATHS) {
    errors.push(...validateDecision(dottedPath, getAtPath(profile, dottedPath), { requireDecided }));
  }

  return errors;
}

function parseArgs(argv) {
  const args = { file: 'config/project-bootstrap-profile.example.json', requireDecided: false, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      args.file = argv[index + 1];
      index += 1;
    } else if (arg === '--require-decided') {
      args.requireDecided = true;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function loadJson(file) {
  const absolute = path.resolve(process.cwd(), file);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function runSelfTest() {
  const template = loadJson('config/project-bootstrap-profile.example.json');
  const templateErrors = validateProfile(template);
  if (templateErrors.length > 0) {
    throw new Error(`example profile must be structurally valid: ${templateErrors.join('; ')}`);
  }

  const unresolvedErrors = validateProfile(template, { requireDecided: true });
  if (unresolvedErrors.length !== REQUIRED_DECISION_PATHS.length) {
    throw new Error('require-decided must report every undecided decision');
  }

  const decided = structuredClone(template);
  for (const dottedPath of REQUIRED_DECISION_PATHS) {
    const decision = getAtPath(decided, dottedPath);
    decision.status = 'decided';
    decision.value = `decision:${dottedPath}`;
    decision.rationale = 'self-test';
  }
  if (validateProfile(decided, { requireDecided: true }).length > 0) {
    throw new Error('fully decided profile must pass require-decided validation');
  }

  const notApplicable = structuredClone(decided);
  notApplicable.api.externalConsumers = {
    status: 'not-applicable',
    value: null,
    rationale: 'No external API consumers for this project.'
  };
  if (validateProfile(notApplicable, { requireDecided: true }).length > 0) {
    throw new Error('not-applicable with rationale must pass validation');
  }

  console.log(JSON.stringify({ status: 'ok', decisions: REQUIRED_DECISION_PATHS.length }));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const profile = loadJson(args.file);
  const errors = validateProfile(profile, { requireDecided: args.requireDecided });
  if (errors.length > 0) {
    console.error(JSON.stringify({ status: 'invalid', file: args.file, errors }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    status: 'valid',
    file: args.file,
    requireDecided: args.requireDecided,
    decisions: REQUIRED_DECISION_PATHS.length
  }));
}

main();
