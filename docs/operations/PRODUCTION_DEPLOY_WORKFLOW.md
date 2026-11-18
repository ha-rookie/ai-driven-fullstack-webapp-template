# Production Deploy Workflow

## Purpose

Production code deploy requires explicit authorization and the existing protected environment gate. The user is not responsible for operating GitHub Actions. The assistant owns release execution, verification, and reporting within the approved scope. A pull request, push, or schedule must never deploy Production automatically.

## Required setup

GitHub Actions must provide these values:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `PRODUCTION_WRANGLER_CONFIG_JSON`
- `PRODUCTION_SECURITY_SNAPSHOT_JSON`

`PRODUCTION_WRANGLER_CONFIG_JSON` is written only to a temporary file during the deploy job and is not uploaded as Evidence. Production resource identifiers and secrets must not be committed to the repository.

Configure the GitHub Environment named `production` with required reviewers before real Production use. Required independent environment approval is distinct from asking the user to launch a workflow; never bypass it. The workflow's typed confirmation is not a substitute for Environment protection.

## Execution order

1. After explicit user authorization, the assistant arranges execution of `Production deploy` with a full 40-character commit SHA using an authorized execution interface. If no authorized trigger interface is available, report the release as blocked; do not ask the user to click Run workflow or weaken environment protection.
2. Confirmation must exactly equal `DEPLOY PRODUCTION`
3. The preflight job checks out that exact SHA
4. Lockfile integrity is validated
5. Dependencies are installed with `npm ci --ignore-scripts`
6. The exact SHA is built
7. #86 Security Configuration Validator validates the Production snapshot
8. The deploy job waits on GitHub `environment: production`
9. After approval, the exact SHA is checked out again
10. Request, lockfile, build, and #86 validation are rerun
11. `wrangler deploy --config <temporary-production-config>` performs code deploy
12. Only non-secret deploy Evidence is retained

## Separation from database migration

This workflow does not execute D1 migrations. Database schema changes use the separately gated Production Migration Workflow (#108). Release planning must explicitly decide code/database ordering according to compatibility requirements.

## Stop conditions

Stop before deploy when any of these occurs:

- target SHA is not a full immutable commit SHA
- typed confirmation does not match
- checked-out SHA differs from the requested SHA
- lockfile validation fails
- dependency installation fails
- build fails
- #86 Production security validation fails
- required Production secrets/config are missing
- GitHub Environment approval is not granted
- Wrangler deploy exits unsuccessfully

A deploy failure does not automatically execute database migration, data restore, smoke verification, or rollback. Those are separate operational decisions and workflows.

## Evidence

On successful deploy the workflow retains only:

- target commit SHA
- GitHub workflow run ID
- environment name
- successful deploy status

The Wrangler Production configuration, API token, account credentials, application secrets, and business data are never included in the Evidence artifact.
