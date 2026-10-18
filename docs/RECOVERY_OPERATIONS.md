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

## #431 local audit-backed Recovery Golden rehearsal (showcase boundary)

A restricted **local/test-only** module `src/worker/administration/recovery-local-drill.ts` uses the existing D1 `durable_audit_events` store without migration. An internal test harness appends **one ordered mock checkpoint per call**, using fixed `system` audit actions, a single incident/run correlation and existing D1 integrity hashes. The reader searches by environment, scope, run and incident, reconstructs the bounded ordered prefix and hands it to the existing `projectRecoveryPlan` / `projectRecoveryCenter` policy and readiness evaluators. Reopening the client/process can replay the same D1 records; this is not browser-local simulated persistence. Test scenarios cover #430 Golden #7 (backup success / restore verification failure), #8 (explicit simulated Human Gate / post-restore checks), duplicate/tampered events, cross-environment denial, interruption and no automatic service resume.

**Crucial limit:** this is an **internal local/test demonstration**, with no registered HTTP command, backup provider adapter, Production approval, actual Restore or Resume, remote D1/Preview/Production write, or real recovery audit producer. The simulated step-five marker begins with `SIMULATED-` and is explicitly *not* a real human approval. Security/Audit post-check successes in this drill are synthetic outcomes; they are not independently verified Production evidence. The append helper is not concurrency-safe as an actual recovery coordinator; duplicate/out-of-sequence reads fail closed. Main Admin production recovery evidence remains UNKNOWN when real adapters are absent. #431 original acceptance 8 and 9 must still be evaluated independently after merge, and formal ST #694 remains separate.

## #431 audit-backed authorized Recovery GET integration (local/test evidence)

The internal `createLocalRecoveryOperationAuditReader` adapter can now be **explicitly injected** into the existing authenticated, scoped, *read-only* `handleRecoveryReadinessApi` after its system-admin authorization. It replays the durable local/test D1 audit fixture by incident and run ID. The generic #429 `Finding → ActionRequired` projection now surfaces **audited incident post-restore verification failure** independently of an earlier successful backup rehearsal; incident recovery remains BLOCKED. A successful simulated ten-checkpoint rehearsal ends at `HUMAN_REVIEW_REQUIRED` with `resumeExecutionAllowed=false`, not a service-resume command.

The scoped API integration tests execute Golden #7/#8 via actual handler authentication, correlation, audit replay, tampering refusal and a recreated D1-interface fixture. **Proof limitation:** the tests still use an in-memory D1 interface fixture; neither a real local SQLite/D1 instance nor a real Production Recovery Provider has been operated. The adapter is *not registered* in deployed Worker composition. Preview/Production environment calls to this adapter fail closed. Completing the original #431 clauses #8/#9 requires independently evaluating real operation/Audit integration and the project's chosen Golden acceptance level; CI passing this mock-only integration is not live recovery proof. No schema migration or remote action is required by this PR.

## #431 Showcase completion slice: shared #429 review decisions and #430 Golden
The existing interactive Recovery Readiness demo uses fictional time-relative evidence, the same `assessRecoveryReadiness` and `projectRecoveryPlan` evaluators as the API, and a **single shared** `projectRecoveryReviewAction` #429 Finding→ActionRequired mapper. This replaces the former RPO-only demo warning. The demo now renders the actual review reason for a failed restore, stale test, RPO/RTO breach or failed incident verification without inventing a safe-to-resume command. Golden #7 selects **Backup protected / verification failed → NOT_READY + ActionRequired + BLOCKED**; Golden #8 selects **ten synthetic audited checkpoints → mock Human Gate → HUMAN_REVIEW_REQUIRED, never executable**. Failure-injection options visibly fail closed if audit or approval evidence is absent or stale.

**Two separate evidence levels:** The clickable Showcase and unit/HTTP fixture tests demonstrate the *template decision contract* without any real data-plane change. `durable_audit_events` persistence/replay and the authorized recovery GET remain separately testable in the local/test harness. Actual infrastructure recovery, authenticated Production restore approval, Remote D1, and production-grade proof of backup recoverability are **not provided**; a full deployment/system/browser acceptance remains the later formal ST (#694). Do not represent synthetic incident IDs or mock audit events as signed production evidence. The deployed Admin API retains its unconnected default recovery-operation Audit adapter and therefore reports unknown rather than fabricating a recovery.

This slice deliberately does not add an operation engine, provider SDK, migration, new HTTP endpoint, cloud resource or deploy workflow. Re-evaluate the **original** #431 items #8/#9 against the intended *Showcase/template* acceptance level **after merge**; keep #430's broader cross-portal and formal ST work independent.
