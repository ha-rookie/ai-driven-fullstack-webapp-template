# Security Incident Response

## Purpose and responsibility

Connect the existing Audit, Session Revocation, Operation Mode and Recovery foundations into a repeatable response to suspected compromise. A security incident concerns confidentiality, integrity or unauthorized access; an ordinary availability failure does not by itself establish compromise. A case can involve both: preserve the security investigation while following the separate [Recovery / Operations](../RECOVERY_OPERATIONS.md) procedure for service/data recovery.

This is a reusable technical runbook, not a staffed SOC, a universal severity/SLA policy or an SCS conformity claim. Projects must name the incident commander, authorized operators, escalation contacts, private evidence store, retention/access policy, reporting deadlines and legal/customer communication owners before adoption. Organization-specific notification decisions stay with those owners. Do not put sensitive incidents, logs, exploit details or credentials into public GitHub Issues, PRs or Actions artifacts; use [Security Policy](../../SECURITY.md) for private reporting.

## Initial triage and severity

1. Open a private incident record with an opaque incident identifier and UTC detection/start times. Name an incident commander and an independently authenticated operator; record uncertainty explicitly.
2. Identify the affected Project, explicit deployment environment and exact deployed SHA from deployment evidence, rather than assuming GitHub main is serving traffic. Check the corresponding workflow run and subsequent rollout/rollback evidence.
3. Determine observed impact, affected actors/scopes/resources, whether activity continues and confidence in each finding. Separate observation from hypothesis; a burst of 403s is not proof that any request succeeded.
4. Correlate bounded requestId / method / safe path with Security Rejection Events and successful mutation Audit. Inspect related access changes and deployment/configuration history privately. Do not copy full headers, query strings, tokens, hashes, request bodies or user content.
5. Confirm the trusted control plane and operator access remain available. Read current operation mode, environment and version. Verify which business routes actually adopt the ModeGuard; Template primitives are opt-in and do not prove deployed protection.
6. Choose a provisional priority below and an explicit scope; the Project owns numeric thresholds, paging/on-call targets and notification requirements. Unknown evidence stays unknown and escalates for review rather than being marked safe.

| Provisional priority | Evidence/impact | Technical decision |
| --- | --- | --- |
| Critical candidate | Confirmed or ongoing unauthorized privileged access, widespread integrity loss, exposed active privileged secret | Escalate immediately to the Project commander; evaluate maintenance and credential/session containment with explicit authorization |
| High candidate | Credible compromise of a bounded actor/scope, suspected unauthorized writes, unexplained privileged changes | Preserve evidence, isolate the affected access and evaluate read-only/maintenance according to scope |
| Investigate | Denial burst without successful access, incomplete reports or unexplained availability degradation | Correlate and investigate; do not revoke every user or stop Production solely from a denial count |

These labels are triage aids. Record the chosen priority, impact/confidence, decision owner and re-evaluation time. Reclassify as evidence changes; do not hard-code cross-project numeric thresholds.

## Representative scenarios

| Trigger | Confirm before action | Candidate containment and follow-up |
| --- | --- | --- |
| Credential or application-session compromise | Internal actor mapping, affected session/user scope, active access, trusted operator session, provider versus application credential | Revoke the affected user's application sessions; provider credential revocation/rotation is separate. Validate old sessions fail, recover through trusted reauthentication, investigate successful requests |
| Suspected unauthorized access | Actor/membership/resource relation, expected RolePolicy, requestId and successful mutation evidence | Contain affected membership/user under Project policy; assess integrity impact; no hidden super-admin or automatic cross-scope permission |
| Authorization-denial burst | Rejection events versus successful access, scope/time aggregation, known client/deploy changes, possible guard failure | Investigate and adjust Project rate-limit/WAF policy if justified; do not infer a breach or automatically disable users from 403 counts |
| Suspected secret exposure | Exposure location/version, secret type/privilege, public availability, provider evidence of use | Contact the secret owner privately, revoke/rotate through the provider-approved workflow, assess existing application sessions and deployments; redaction/deleting text alone does not invalidate an exposed credential |

## Containment: sessions and accounts

The [authentication design](../AUTH_DESIGN.md#explicit-session-revocation) is authoritative. `revokeAllApplicationSessionsForUser(db, targetUserId)` in `src/worker/auth/session-revocation.ts` durably revokes all non-revoked sessions for one mapped internal user and reports `revokedCount`. Repeating it may return zero; zero is not by itself proof that a suspected session was invalidated. Verify the relevant old access through the normal authenticated boundary without recording token material.

The helper is a persistence service, not an operator API and not an authorization boundary. The Project must wrap it with authenticated operator access, explicit environment/target confirmation, scope authorization, mutation CSRF and Audit. There is no Template public bulk-revocation route. Do not run it from an unauthenticated request or invent a remote endpoint. Confirm a trusted operator can recover before revoking their own access; suspected attacker-controlled sessions must not be preserved merely to keep an operator logged in. `revokeOtherApplicationSessionsForUser` intentionally preserves the current session and is appropriate only when that current session is independently trusted.

Use `createSessionRevocationAuditEvent` with the bounded RequestContext, trusted actorId and result, then `writeAuditSafely` through the configured sink. Record target internal user, action, affectedCount, environment, approval reference and time in the private incident timeline. Never pass Cookie, Authorization, raw/hash session token or provider credentials to Audit. The baseline sink is best-effort: absent telemetry is not proof that nothing happened, and durable/private retention must be configured by the Project (#44).

Application session revocation does not revoke provider refresh tokens, API keys or leaked secrets and does not prevent a still-valid compromised credential from creating another session. Pair it with provider rotation/account containment as necessary. User disable/reactivate and membership changes use the separate authenticated Administration boundary and Project target-scope policy; these also require explicit operational authorization.

## Containment: read-only or maintenance

The [Operation Mode contract](../OPERATION_MODE.md) defines the Store, business Guard and administrative API. Projects must explicitly compose the authenticated control plane outside the business ModeGuard so operators can leave maintenance while still satisfying Authn, scoped Authz, CSRF and rate limiting. This is not emergency bypass. Separate Preview/Production bindings are required; an environment row is not resource isolation.

1. Confirm the requested environment and trusted operator scope. Read GET `/api/admin/operation-mode` with an authenticated actor allowed `operation_mode:read`; retain the returned environment/mode/version/updatedAt.
2. The commander decides whether read-only sufficiently contains the harmful writes or whether maintenance is needed. Read-only permits GET/HEAD/OPTIONS presented to the Guard; those routes must not mutate business state. Maintenance rejects every presented request. Unadopted routes, provider credentials, background work and external integrations need separate containment.
3. Before any remote/Production mutation, obtain the Project's explicit approval identifying environment, observed state/version, intended mode, reason and operator. Routine Template code-merge approval does not authorize this operation.
4. PATCH the Project-composed endpoint using its normal authenticated/CSRF client with a bounded reason and explicit confirmation. Example request body (synthetic Preview example only):

   ```json
   { "targetEnvironment": "preview", "mode": "read-only", "expectedVersion": 7, "reason": "Incident containment approved" }
   ```

5. Validate the response and subsequent protected-route behavior. Capture requestId, trusted actor/scope, target environment, before/after mode/version Audit, approval and UTC time. A 409 means the observed state changed: read and reassess, then obtain a fresh deliberate decision; never silently retry with a refreshed version. A 503/missing mode is unknown/unavailable, never normal.
6. Do not initialize an absent Store through this API. Missing state or an unavailable control plane is a stop condition; escalate to the Project-approved independent operational path instead of adding a hidden bypass or directly overwriting D1.

## Evidence preservation and timeline

Preserve relevant evidence promptly in an approved private store, before retention windows or containment actions change it, when doing so does not delay necessary containment. Record collector, collection time/source/run identifier, scope, access restrictions and available integrity digest. Protect originals and work from redacted copies. Do not export business tables or Production SQL into public Actions artifacts.

Minimum private incident record:

```text
incidentId; Project; environment; commander; detection/start UTC
priority; confidence; observed impact; affected actor/scope/resource identifiers
requestIds; safe methods/paths; observation versus hypothesis
deployed SHA; last verified healthy/stable SHA; workflow/job/evidence references
approved containment decision, operator, time, affected scope and confirmation
session revocation action/count and authentication verification result
observed operation mode/version; before/after mode/version and result
private evidence references, collector/time, retention/access policy and integrity information
UTC timeline: observation -> decision/approval -> action -> result -> next review
unverified/failed checks, limitations, remaining risks, follow-up owner and Issue/reference
recovery/rotation/patch/regression references; closure owner and criteria
```

Record failures and unavailable capability as unverified. Successful execution of one workflow does not prove complete containment, no exfiltration, or the integrity of all affected data. Project-configured telemetry availability, sample rates, sink failures and retention limits affect confidence.

## Recovery decision and safe return

| Finding | Decision boundary |
| --- | --- |
| Vulnerable or defective code; data compatible with a verified stable version | Evaluate forward fix or [code rollback](../operations/CODE_ROLLBACK_STABLE_MARKER.md) using immutable current/stable/target SHAs, schema compatibility, gated deploy and smoke. A known vulnerable target is not a safe stable version |
| Suspected data integrity loss | Preserve evidence, contain writes, assess the affected data and admissible restore point through [Recovery / Operations](../RECOVERY_OPERATIONS.md); code rollback alone does not undo writes |
| Confirmed need for data restore | Require a reason rollback/forward fix is insufficient, confirmed target/undo bookmark, accepted RPO/data-loss impact, independent explicit Human approval, then schema/integrity/API verification |
| Unknown compromise extent or restore point | Stop recovery mutations and investigate; restoring earlier state can reintroduce compromised access/credentials and erase investigation evidence |

Never automatically restore, downgrade migrations or recursively rollback from this runbook. Recovery instructions remain in their existing authoritative documents. A provider/secret rotation and invalidation plan must account for restored access/session state before re-opening service.

Before returning to normal, verify containment effectiveness, provider credentials/account controls, patched exact SHA, schema/data integrity and affected negative/regression paths. Reauthentication must use trusted credentials; issue new sessions and session-bound CSRF proof through the adopted provider workflow. Confirm protected routes reject old compromised access and ordinary authorized behavior recovers. Read the latest mode/version and use a separately approved PATCH to normal; no automatic resume on test success.

The commander closes the private record only after explicitly accepting remaining uncertainty, linking evidence and assigning corrective actions. Publish only a sanitized follow-up when safe; legal/communications owners decide external notification. Keep Template corrections separate from the affected Project's concrete incident and never copy incident identity/data into reusable tests.

## Tabletop and Local rehearsal

Use synthetic users, scopes, incidents and a disposable Local D1 database. No Preview/Production resources, real credentials, remote revoke, remote mode change, Time Travel or deployment are needed for this rehearsal.

| Rehearsal | Existing executable evidence | Expected result and limit |
| --- | --- | --- |
| Correlate a denial and a successful change | `tests/security-rejection-event.test.ts`, `tests/audit-correlation.test.ts`, `tests/log-redaction.test.ts`, `tests/operation-mode-api.test.ts` | Request/actor/scope context preserved; extra/secret fields excluded. Does not verify a deployed sink or retention |
| Contain a synthetic user's sessions | `tests/session-revocation.test.ts`, `npm run session-revocation:local` | Durable targeted revocation, idempotency and unrelated/current-session rules. Does not establish a Project operator revocation API |
| Read and change mode through real auth boundaries | `npm run operation-mode:local` | Actual D1 Store/API: reject missing auth, bad CSRF, insufficient role and wrong environment; prevent stale overwrite; exit maintenance deliberately |
| Stop unsafe recovery | `npm run recovery:validate`, rollback/deploy workflow self-tests in `npm run validate:local` | Static/local gate and compatibility contracts only; no remote restore/deploy demonstrated |
| Four scenarios above | Commander/operator tabletop using the private-record shape | Explain priority, evidence confidence, approval and recovery choice; record actual participant results, gaps and assigned owners rather than claiming an exercise from document existence |

Run `npm run validate:local`, `npm run lint` and `npm run build` for repository evidence. Required PR CI executes the local contracts; its success is not an incident exercise or Production verification. Organizations must schedule/record exercises and validate their deployed control plane, identity provider, telemetry access and recovery capability separately.
