# #431 Stage9 — Backup & Recovery Readiness Console, first vertical slice

## Business purpose

An existing backup artifact is not the same as a verified backup, verified restore or recovered system. Operators need an explicit UNKNOWN/NOT_READY state to avoid restarting service from an unverified recovery point. This slice provides a minimal Admin Portal System → Recovery Readiness path and reusable provider-neutral evidence projection.

## Implemented Reference/Local scope

- The pure model in src/shared/recovery/readiness.ts accepts a bounded, explicitly complete evidence snapshot from a trusted future adapter. It differentiates backup creation, backup verification, recovery point, restore rehearsal and seven post-restore application/data/business/integration/jobs/security/audit checks. Missing or invalid evidence remains UNKNOWN.
- RPO exposure derives from the age of a verified recovery point, never an invented zero. RTO is a measured verified rehearsal duration, not a prediction of Production RTO. A confirmed RPO breach becomes separate #429 Finding and ActionRequired without enabling automatic recovery.
- READY requires verified backup and recovery point, a successful rehearsal against that point, all seven checks PASSED, evidence freshness, and RPO/RTO both within targets. Missing restore evidence is UNKNOWN; confirmed failure, stale rehearsal or known breach is NOT_READY.
- The Worker API is GET /api/admin/operations/recovery-readiness?scopeId=workhub-company; fixed scope and method, session authenticated and scoped system_admin authorized before reading evidence. No caller-provided provider, SHA, URL, target, environment or Restore operation. The current live adapter is intentionally not-connected; no raw backup, logs, tokens or provider payload are exposed.
- Existing #429 Operation Policy is used for the recovery.restore preview and requires HUMAN_GATE with executionAllowed=false in every environment. There is no execution handler, restore endpoint, D1 write or provider call.
- The preexisting Admin Portal System section links to the read-only panel showing source coverage, protection, RPO/RTO, restore freshness, post-restore verification, recovery readiness and the Human Gate. Existing Admin styles are reused.

## WBS acceptance / limitations

This PR advances the original #431 clauses for provider-neutral Backup/Recovery projection and backup-versus-recoverability separation in Reference/Local scope. The parent Issue #431 remains Open 0/9 pending acceptance review: there is no trusted live Provider feed, real RPO/RTO observation, durable recovery-state/resume, actual restore proof, production Audit link or verified Golden Recovery E2E. Do not close an acceptance clause on PR creation.

The existing scripts/data-lifecycle-backup-evidence.mjs creates checksum evidence for a backup artifact, NOT restore proof. The guarded scripts/d1-recovery-rehearsal.sh can perform remote Preview restore only with separate human authorization and is NOT executed or queried by this slice. A synthetic READY in unit tests is not an actual backup or system restoration. System Test #694 remains Not Run.

## Failure and safety evidence

Focused tests/recovery-readiness.test.ts covers unconnected, valid synthetic full rehearsal, backup-only, restore failure, missing post-restore checks, RPO/RTO breach, stale test, recovery point mismatch and malformed/future evidence. Focused tests/recovery-readiness-api.test.ts covers fixed read-only query, scoped authorization before source access, UNKNOWN on provider failure, separate #429 Finding/ActionRequired and denial of Human Gate bypass.

Exactly eight changed files under the approved #431 Change Contract. WBS, Milestone, Priority, migration, GitHub workflows, cloud resources, Secrets, Preview/Production deploy and Remote D1 remain unchanged.

## Stage 9 Slice 2: read-only Recovery Runbook and Resume Safety

The original #431 runbook contains exactly eleven ordered checkpoints:

1. Maintenance Mode
2. Stop Scheduled Jobs
3. Stop Outbound Integrations
4. Select Recovery Point
5. Restore — Human Gate
6. Data Integrity Check
7. Business Consistency Check
8. Integration Reconcile
9. Jobs Verify
10. Application Health
11. Resume Service — Human Review

The shared source-neutral model src/shared/recovery/recovery-plan.ts projects this sequence and provides a conservative Service Resume decision. It consumes only an ordered-prefix Recovery execution snapshot from a separately authorized, durable-audit Adapter. An event record must match the selected scope/environment, incident/run, freshness, strictly monotonic audit checkpoints, original step order and nonempty Audit event ID; the Restore step additionally requires a Human Approval reference. Post-Restore results are separate from a *rehearsal* and must include application, database integrity, business consistency, integrations, jobs, security and audit checks. Invalid, stale, cross-scope, skipped or forged-by-query inputs are UNKNOWN/BLOCKED, never verified.

**Important boundary:** A record marked as verified-audit is only a *contract for a future trusted Adapter*, not self-authenticating proof. No durable Recovery Audit adapter is registered by this PR, and there is no command to import a client-provided checkpoint. The live panel shows all steps unrecorded and Service Resume BLOCKED. The existing scope-authorized GET does not accept incidentId, source URL, provider, checkpoint or any command parameters. No database schema migration, actual restore or resume action is added.

Even a wholly valid *synthetic* recovery-run snapshot in local unit tests produces only HUMAN_REVIEW_REQUIRED (never ALLOW, NORMAL or executionAllowed=true) after ten verified checkpoints, a separately approved Restore checkpoint, seven complete incident checks, and READY recovery evidence. That state is an advisory request for a separate human decision, not a Production restore/resume permission. It must not be confused with completion of #430 Golden Scenario #8, which still requires real persistence, approved provider verification and end-to-end acceptance.

The initial readiness validator also no longer assumes lastSuccessfulBackupAt and lastVerifiedBackupAt must be monotonic with each other: a newer unverified backup can follow an older verified backup, while delayed verification can follow backup creation. Both timestamps remain individually constrained to valid past observations. This avoids falsely classifying a legitimate provider observation as unavailable.

**Original parent acceptance stays Open 0/9 until separately verified.** The present slice does not supply interruption-resumable durable checkpoints; deterministic projection from a hypothetical persisted snapshot is not persistence. Do not turn on a Recovery Resume operation or mark the service healthy using this read model.

## Stage 9 Slice 3: real read-only D1 Recovery Audit coverage

This integration queries the **existing** `D1DurableAuditStore.search()` from the authorized System Admin Recovery Readiness API, strictly after authentication and tenant-scoped authorization. Its fixed query binds `environment`, `scopeId=workhub-company`, `resourceType=recovery`, and `limit=20`. The existing store validates each returned audit record's SHA-256 content digest and checks environment and scope. The stage-specific adapter additionally validates record timestamp, resource type and scope and exposes only a small aggregate, never raw audit logs or identities.

The UI now distinguishes `RECORDED` (one or more SHA-checked audit events in a bounded query), `NONE` (a successful query with no matching events) and `UNAVAILABLE` (query, integrity or source failure). It shows the bounded record count, whether more rows may exist, and the latest audited timestamp. The status is always read-only, no D1 writes or schema changes. Query errors cannot be interpreted as no events or successful recovery. Fixture tests show actual D1 SQL binding and validate failures.

**Critical distinction:** An audit record, including a successful one, does *not* attest to an export existing, backup integrity, a restorable recovery point, a successful rehearsal, verified RTO/RPO, or Production service recovery. This adapter does not set `recovery.sourceState` to available, nor fill a `RecoveryOperationSnapshot`. Until there is **trusted, provider-derived backup and restore evidence**, the Recovery Readiness remains UNKNOWN and Resume BLOCKED. Existing audit records can demonstrate an operator action was recorded, not that the underlying infrastructure operation succeeded.

This slice advances the **Audit visibility part** of #431 acceptance 8 via the already existing #429/D1 shared durable audit; it does not claim the full #429 Finding/ActionRequired/Verification/Audit end-to-end link or acceptance 8 as complete. The original #431 is Open 2/9. Later provider integration must be reviewed independently for provenance, trusted storage and Human Gate. No Preview/Production deploy, remote D1, migration, resource change, or Restore command is authorized by this change.
