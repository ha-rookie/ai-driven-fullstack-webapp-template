# Recovery / Operations

## Purpose

Define the Full-stack Template baseline for incident containment, D1 recovery decisions, Preview restore rehearsal, and Production restore guardrails.

This document does **not** make Production restore automatic. A restore changes shared persistent state and remains a Human Gate.

## Recovery model

```text
Incident detected
    ↓
Confirm impact and stop further harmful writes when practical
    ↓
Identify latest healthy application deployment and data point
    ↓
Decide: forward-fix / code rollback / data restore
    ↓
If data restore is required:
  capture current bookmark as undo point
  confirm restore target
  obtain Human approval
    ↓
D1 Time Travel restore
    ↓
Schema + data-integrity + API smoke
    ↓
Record evidence and follow-up action
```

## What this Template provides

- a manual Preview D1 recovery-rehearsal workflow
- an explicit `REHEARSE_PREVIEW` confirmation gate
- Preview / Production database separation checks
- placeholder-resource rejection
- a rehearsal probe that proves state exists before restore and disappears after restore
- best-effort restore to the captured Preview baseline when the rehearsal is interrupted
- static CI validation of the recovery workflow and script
- a Production restore runbook, but no Production restore workflow

## What PR CI does not do

Normal PR CI must not:

- contact Preview D1
- contact Production D1
- request a Time Travel bookmark
- perform a Time Travel restore
- consume remote D1 quota for recovery testing

`npm test` runs `recovery:validate`, which checks shell syntax and static safety invariants only.

## Preview recovery rehearsal

The workflow is:

```text
.github/workflows/d1-recovery-rehearsal.yml
```

It is intentionally available only through `workflow_dispatch`.

Before a project can run it, replace the placeholder Preview and Production D1 resources in `wrangler.jsonc` and configure the GitHub Actions secrets required by Wrangler / the Cloudflare API:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The operator must type:

```text
REHEARSE_PREVIEW
```

The script then:

1. verifies the explicit confirmation phrase
2. verifies Cloudflare credentials are present
3. rejects placeholder D1 resources
4. rejects identical Preview and Production database IDs
5. removes only a stale rehearsal probe artifact
6. captures a baseline Preview Time Travel bookmark
7. creates a temporary probe table and marker in Preview
8. verifies the marker exists
9. restores Preview to the baseline bookmark
10. verifies the probe table no longer exists
11. attempts a best-effort baseline restore if the rehearsal is interrupted after the bookmark is captured

The Time Travel API target is built from the **Preview** database ID only. The Production database ID is used only as a safety comparison.

## Verification status

There are two different claims:

1. **Recovery automation is implemented and statically guarded**
2. **A real Preview Time Travel restore has succeeded for a provisioned project**

This Template can establish claim 1 in PR CI. Claim 2 requires a real Preview resource and a Human-triggered rehearsal. Do not mark Time Travel recovery as operationally verified until that evidence exists.

## Production restore is a Human Gate

Production restore must not be added to an automatic PR, push, scheduled, or deployment workflow by default.

Before any Production restore:

1. confirm the incident scope and whether writes are still causing damage
2. identify the latest healthy application deployment
3. decide whether a forward-fix or code rollback is sufficient
4. if persistent data/schema must be restored, capture the current Production bookmark as an undo point
5. identify the intended restore timestamp or bookmark from evidence, not guesswork
6. have a Human explicitly approve the restore target
7. execute the restore
8. verify migration/schema state
9. verify affected data invariants
10. run `/api/health`, `/api/health/database`, authentication, and critical protected flows
11. record the resulting bookmark / previous bookmark and smoke evidence
12. open follow-up work for the defect and any reusable guardrail

## Production bookmark commands

Current bookmark:

```bash
npx wrangler d1 time-travel info DB --json
```

Inspect a point around a known timestamp:

```bash
npx wrangler d1 time-travel info DB --timestamp="<UTC timestamp>" --json
```

Production restore, **only after explicit Human approval**:

```bash
npx wrangler d1 time-travel restore DB --bookmark="<confirmed-bookmark>"
```

Treat restore as destructive shared-state mutation. Confirm the currently installed Wrangler behavior and Cloudflare D1 Time Travel documentation when provisioning a real project:

https://developers.cloudflare.com/d1/reference/time-travel/

## Rollback decision matrix

| Situation | Default response |
| --- | --- |
| UI / Worker code defect with compatible schema and intact data | forward-fix or code rollback |
| deployment defect before any harmful persistent write | code rollback is usually sufficient |
| migration fails before successful completion | inspect migration result; do not assume a data restore is required |
| migration succeeds but introduces logical schema/data defect | assess code compatibility; restore to a confirmed pre-migration point when schema/data rollback is required |
| accidental delete/update or corrupted persistent state | contain writes, confirm restore point, then Human-approved data restore |
| uncertain restore point | do not restore yet; gather evidence first |

Code rollback and data rollback are separate decisions. Reverting application code does not automatically reverse a successful schema or data mutation.

## RPO and RTO

The Template does not prescribe universal RPO/RTO numbers.

Each project must define:

- **RPO**: how much committed data loss is acceptable
- **RTO**: how long the service may remain degraded before integrity and critical smoke checks must be restored

Targets must fit the project's risk, Cloudflare plan/capabilities, data importance, operational staffing, and tested rehearsal evidence. Provider retention/capability must be rechecked when the project is provisioned; do not copy a historical plan limit into a new project without verification.

## Backup/export policy

D1 Time Travel is the baseline point-in-time recovery mechanism for this Template. It is not a substitute for every long-term retention requirement.

Do not automatically upload Production SQL/data exports to public-repository GitHub Actions artifacts. If retention beyond provider recovery windows is required, design encrypted private storage, access control, retention, deletion, and restore testing as a separate project decision.

## Evidence to retain

For a Preview rehearsal:

- repository commit
- workflow run ID
- Preview environment identity
- confirmation that Production was not targeted
- baseline bookmark capture success
- probe creation/verification success
- restore success
- post-restore probe absence success

For a Production incident/restore:

- incident start/detection time
- affected function/data
- latest healthy application deployment
- reason code rollback alone was insufficient, if applicable
- restore target timestamp/bookmark
- pre-restore Production bookmark
- operator and explicit approval
- restore response / previous bookmark
- schema verification result
- data-integrity verification result
- API/application smoke result
- follow-up Issue

## Related files

- `scripts/validate-d1-recovery-config.mjs`
- `scripts/d1-recovery-rehearsal.sh`
- `scripts/validate-recovery-safety.mjs`
- `.github/workflows/d1-recovery-rehearsal.yml`
- `docs/DATA_DESIGN.md`
- `docs/FULLSTACK_ARCHITECTURE.md`
