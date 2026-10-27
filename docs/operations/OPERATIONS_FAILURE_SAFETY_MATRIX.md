# #430 Operations Failure-Safety — original acceptance trace

Scope: Stage 0 P1 cross-cutting operations; **test/local evidence only**. This map does not change the ten original completion criteria in Issue #430, certify a live Provider, or authorize Production recovery. An implementation PR is not merged acceptance evidence.

## Failure matrix

| Failure / decision boundary | Required safe outcome | Existing or scoped executable evidence | Remaining boundary |
| --- | --- | --- | --- |
| Authorization denied, missing safeguards, stale policy, Human Gate | `REJECTED`; no handler call | `tests/operations-execution-guard.test.ts`, `tests/operations-application-service.test.ts` | No real human approval workflow claimed |
| Preview target or correlation mismatch | `CONFLICT`; no handler call | `tests/operations-application-service.test.ts` | No real concurrent Provider transition claimed |
| Handler/Provider uncertainty | `UNKNOWN`; do not blindly retry | `tests/operations-application-service.test.ts`, `tests/integration-event-outbox.test.ts` | Real Provider adapter and external reconciliation not connected |
| Explicit partial/optimistic conflict | Preserve `PARTIAL` / `CONFLICT` | `tests/operations-application-service.test.ts`, `tests/job-recovery-operations.test.ts` | End-to-end compensation not established |
| Privileged admission audit unavailable | `REJECTED` before handler invocation | `tests/operations-application-service.test.ts` (#430 Golden #6 injection) | Only synchronous audit writer failure observed; durable Audit and Monitoring outages are unproven |
| Outcome audit unavailable after side effect | `UNKNOWN`, including verification; require reconciliation | `tests/operations-application-service.test.ts` (#430 failure injection) | Existing side effect cannot be rolled back merely because Audit failed |
| Recovery checkpoint/Audit corrupted or interrupted | No fabricated success and no resume | `tests/recovery-local-drill.test.ts`, `tests/recovery-plan.test.ts` | Local D1 test fixture only, not real recovery |
| Backup is successful but restore verification fails | Recovery NOT READY, never auto-resume | `tests/recovery-readiness.test.ts`, `tests/recovery-showcase.test.ts` | Real Provider backup/restore verification unobserved |
| Large operations, retries and concurrent transitions | Step-up required; duplicate/unknown outcomes cannot auto-retry | `tests/operations-core.test.ts`, `tests/integration-event-outbox.test.ts` | Cross-slice concurrency and end-to-end idempotency remain to be verified |
| Status/Risk accessibility | Render explicit text/status; color alone cannot carry result | `tests/workhub-operations-overview-api.test.ts` verifies API status projection | Keyboard/screen-reader Browser E2E remains unverified |

## Golden 8 — integration/E2E assignment and gaps

Assignment is a **test destination**, not a declaration of completed E2E coverage. Existing automated tests listed below are mostly Node integration/component tests; formal System Test follows feature completion.

| Golden scenario | Assigned integration / E2E boundary | Evidence now | Not yet proved |
| --- | --- | --- | --- |
| 1. Morning routine | WORKHUB multi-source status, authorized read, source outage | `tests/workhub-operations-overview-api.test.ts` | Authenticated browser walkthrough |
| 2. MISSED Job → Manual Recovery | Job retry gate and durable enqueue/recovery adapter | `tests/job-recovery-operations.test.ts`, `tests/job-operations-api.test.ts` | Real missed schedule to operator completion |
| 3. Stuck Resource → Reconcile | Failure queue / scoped details and correction optimistic conflict | `tests/integration-operations-unified-queue.test.ts`, `tests/data-correction-foundation.test.ts` | Actual stuck resource detector and reconcile handler |
| 4. External Timeout → UNKNOWN → Reconcile | Outbox ambiguous send and Provider receipt observation | `tests/integration-event-outbox.test.ts`, `tests/integration-provider-receipt.test.ts` | Real external receipt / authorized resend |
| 5. Security Finding → Access Correction | Scoped Finding feed, audited resource correlation, authorization | `tests/security-center-api.test.ts`, `tests/audit-log-viewer-api.test.ts` | Real Finding remediation and recheck |
| 6. Audit unavailable → Privileged deny | Privileged Operations Core execution, injection before side effects | `tests/operations-application-service.test.ts` | Monitoring outage and durable Audit unavailable E2E |
| 7. Backup success → Restore Verify failure | Persisted local recovery checkpoint and negative readiness checks | `tests/recovery-local-drill.test.ts`, `tests/recovery-readiness.test.ts` | Real backup and restore Provider |
| 8. Production Recovery → Human Gate → Verify | Recovery steps, human-gated local trace, no automatic resume | `tests/recovery-plan.test.ts`, `tests/recovery-local-drill.test.ts` | Live Production approval/recovery, intentionally not executed |

## #430 acceptance accounting

The matrix and Golden 8 assignments are maintained here for review, but Issue #430 remains **Open, original 0/10** until the evidence is accepted under its unchanged completion gate. The scoped audit injection exercises one part of "Audit/Monitoring failure injection test"; **Monitoring** remains untested, so that original item is **not** marked complete. Do not infer that the broad cross-slice, E2E, accessibility or Recovery criteria are complete from existing isolated unit tests. No remote DB, migration, Secret, deploy or Cloudflare resource is required by this slice.
