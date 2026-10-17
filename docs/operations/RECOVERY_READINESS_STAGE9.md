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
