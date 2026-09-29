# Full-stack Scoped Instructions

## Purpose

`docs/instructions/` contains **additional Full-stack-specific constraints** that are loaded only when the current task touches the corresponding implementation boundary.

These files do not replace the Common Template guardrails or its Tool-neutral Scoped Instructions. They also do not create a new source of truth for architecture, security, operations, or requirements.

```text
Common Template guardrails / Scoped Instructions
        ↓
Issue Change Contract / Full-stack Design Sources
        ↓
Full-stack Scoped Instruction
        ↓
Implementation / Validation / Evidence
```

If an Instruction conflicts with its Design Source or the reviewed Common Template baseline, the higher-level source wins and the Instruction must be corrected.

## How to apply

At task start, select only the Instructions implied by the Issue Planned Files, Impact Flags, and intended behavior.

1. Read the applicable Common Template guardrails / Scoped Instructions
2. Read the Issue and the Full-stack Design Source(s)
3. Add only the relevant Full-stack Instruction(s)
4. Combine Instructions only when the task crosses boundaries
5. Do not load every file mechanically

Path is a hint, not the sole selector. A documentation-only change that alters authentication semantics still requires `authentication-session.md`.

## Instruction map

| Instruction | Main use | Primary Design Source |
| --- | --- | --- |
| `database-migration.md` | D1 schema, migration, binding, Local/Preview/Production DB boundary | `../DATA_DESIGN.md` |
| `authentication-session.md` | external identity, internal user, application session, cookie/session lifecycle | `../AUTH_DESIGN.md` |
| `authorization-resource-scope.md` | role policy, membership, resource scope, deny-by-default decisions | `../AUTHORIZATION_DESIGN.md` |
| `runtime-integrity.md` | optimistic concurrency, state transition, atomic multi-write, invariants | `../RUNTIME_INTEGRITY.md` |
| `audit-correlation.md` | request ID, audit events, safe accountability fields | `../AUDIT_OBSERVABILITY.md` |
| `recovery-remote-operation.md` | Preview rehearsal, Production restore decision, remote mutation guardrails | `../RECOVERY_OPERATIONS.md` |
| `performance-resource-budget.md` | Local/Preview benchmark, query plan, D1 quota/cost evidence | `../PERFORMANCE_CAPACITY.md` |

## Responsibility boundary

These Instructions add implementation-specific constraints only. They must not duplicate the Common Template's `testing`, `security`, `frontend-ui`, `cloudflare-infrastructure`, or `documentation` Instructions.

Do not fix the following as Template-wide values:

- product-specific Domain vocabulary
- concrete Role names or permissions
- concrete Identity Provider
- Project SLO / SLA / RPO / RTO
- Production resource IDs or secrets
- Project retention/privacy requirements

## Common format

Every Full-stack Instruction contains:

- Applies When
- Scope Hints
- Sources to Read
- Rules
- Do Not
- Validation / Evidence

The Instruction summarizes constraints needed while changing that area. Detailed meaning remains in the referenced Design Source.

## Context minimization

The goal is not to minimize reading at any cost. It is to avoid unrelated context without dropping relevant constraints.

- DB-only migration work does not require loading every Auth/Audit instruction
- Auth endpoint work often requires both `authentication-session.md` and `audit-correlation.md`
- protected mutations commonly require Authn + Authz + Runtime Integrity, and may require Audit
- remote recovery/performance operations always require their dedicated Instruction even if the code diff is small
- when uncertain, add the related Instruction rather than assuming a lower-risk boundary
