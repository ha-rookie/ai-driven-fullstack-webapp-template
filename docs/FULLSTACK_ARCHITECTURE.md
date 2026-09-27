# Full-stack Architecture

## Purpose

Define only the technology-specific runtime structure added by this Full-stack Template. Technology-independent development process and governance remain in the upstream Generic Template.

## Target architecture

The baseline reflects the runtime structure that actually exists in this repository.

```text
Browser
  ↓
React SPA
  ↓ /api/*
Cloudflare Worker HTTP Boundary / Composition
  ├─ Authentication / Authorization
  ├─ Validation / HTTP mapping
  ├─ Audit / Correlation
  ├─ Domain rules
  └─ Infrastructure adapters
         ↓
      D1 / External Services
```

The baseline does **not** require a separate `src/application/` or Use Case layer.

That is intentional. The upstream Generic Template describes `Presentation -> Application -> Domain -> Infrastructure` as a common logical model, but explicitly does not require all four layers. This Full-stack Template therefore documents the responsibility split that its executable example actually uses rather than adding an empty abstraction only to satisfy a diagram.

### Baseline dependency rules

- React/UI calls `/api/*`; it does not import Worker, D1, or server-only implementation modules
- the Worker HTTP boundary owns protocol concerns and composes Authentication, Authorization, validation, Audit, Domain rules, and Infrastructure adapters
- Domain logic must not depend on HTTP, Cloudflare Worker types, D1, Cookies, or concrete logging sinks
- Infrastructure owns external I/O such as D1 access and may use Domain types/rules where needed to preserve invariants
- Shared primitives must not depend on product Domain, Worker routing, D1, or concrete identity providers
- Authorization policy remains independent of HTTP response mapping even though its baseline module lives under `src/worker/authorization/`
- lower-level modules must not import the Worker HTTP boundary

### When to add an Application / Use Case layer

A Project may add an explicit Application / Use Case layer when it solves a real orchestration problem, for example when:

- one business operation coordinates multiple repositories or external services
- the same use case must be reused from HTTP and another entry point such as a queue, scheduled job, or CLI
- Worker route handlers begin to contain product business decisions instead of protocol mapping and composition
- transaction, authorization, workflow, or retry orchestration should be testable independently of HTTP
- several routes repeat the same multi-step business operation

When introduced, the Application layer should contain reusable use-case orchestration, not duplicate HTTP parsing or D1 adapter details.

## Bootstrap implementation

Issue #1 implements only:

```text
Browser
  ├─ React SPA
  └─ /api/health
        ↓
     Worker
```

- `/api/*` is evaluated by the Worker first
- non-API requests are served through the Static Assets binding
- SPA fallback is enabled
- `/api/health` requires no secret, database, or external service

## Shared Foundation

Issue #5 adds runtime primitives that can be reused by later layers without introducing database, authentication, HTTP, or product-domain dependencies.

```text
src/shared/
  ├─ errors/
  │    ├─ AppError
  │    └─ Result<T, E>
  ├─ logging/
  │    ├─ Logger
  │    └─ NoopLogger
  └─ validation/
       └─ ValidationResult
```

Responsibilities:

- `AppError` keeps internal diagnostic text separate from optional user-facing text and carries a stable error code
- `Result<T, E>` expresses expected success/failure without requiring exceptions for normal control flow
- validation primitives collect structured issues and combine independent validation results
- `Logger` is a port; concrete output destinations remain outside the shared contract
- `NoopLogger` supports tests and components that do not require an active logging sink
- shared primitives must not import D1, OAuth providers, HTTP response types, or application-specific domain models

Unit tests are compiled with TypeScript and executed with Node's standard test runner. This keeps the baseline small while providing executable contracts for the shared primitives.

## Data Foundation

Issue #7 connects the Worker to Cloudflare D1 without introducing authentication, authorization, or concurrency semantics.

```text
Worker Env
  ├─ ASSETS
  └─ DB: D1Database
        ↓
     numbered migrations
        ↓
     example_resources
```

- `/api/health` remains database-independent
- `/api/health/database` verifies only that the D1 binding can execute a minimal query
- Local D1 is used for CI migration and schema verification
- Preview and Production are modeled as separate D1 resources and use placeholder identifiers until a project deliberately provisions them
- remote migrations are not part of baseline CI
- `example_resources` is intentionally neutral and exists to make later persistence patterns executable without introducing product-specific domain language

Detailed D1 rules are defined in `docs/DATA_DESIGN.md`.

## Authentication Foundation

Issue #9 adds provider-independent identity and application-session infrastructure.

```text
External Identity Provider
        ↓ provider adapter
Verified External Identity
        ↓
Internal User
        ↓
DB-backed Application Session
        ↓
Authenticated Worker Request
```

Runtime structure:

```text
src/worker/auth/
  ├─ auth-provider.ts
  ├─ application-session.ts
  ├─ types.ts
  └─ index.ts
```

Persistence:

```text
users
external_identities
application_sessions
```

Authentication responsibilities:

- concrete identity providers remain adapters outside the baseline
- external provider subjects map to internal user IDs
- session tokens are opaque cryptographically random values
- only session-token hashes are stored in D1
- expired or revoked sessions are rejected
- logout performs server-side revoke before clearing the browser cookie
- `/api/auth/me` exposes only authenticated internal user identity
- roles, memberships, permissions, and product scope are deliberately absent from Authentication

Detailed rules are defined in `docs/AUTH_DESIGN.md`.

## Authorization Foundation

Issue #11 adds generic scope membership and role-based authorization without choosing product-specific role names.

```text
Authenticated User
        ↓
Scope Membership (D1)
        ↓
Pure Role Policy
        ↓
Resource Scope Guard
        ↓
Authorization Decision
```

Runtime structure:

```text
src/worker/authorization/
  ├─ membership.ts
  ├─ policy.ts
  ├─ types.ts
  └─ index.ts
```

Persistence:

```text
resource_scopes
scope_memberships
```

Authorization responsibilities:

- D1 adapter loads membership but does not decide role semantics
- Project code supplies Action → allowed role mapping
- unconfigured actions fail closed
- membership in one scope never authorizes a resource in another scope
- policy code is independent of D1 and HTTP
- Authentication remains responsible for establishing the internal user before Authorization runs
- missing authentication maps to HTTP 401 at the boundary; authorization denial maps to 403

Detailed rules are defined in `docs/AUTHORIZATION_DESIGN.md`.

## Runtime Integrity

Issue #13 adds concrete shared-state integrity patterns around the neutral example resource.

```text
src/domain/example-resource.ts
        ↓ transition rules
src/infrastructure/d1-example-resource-store.ts
        ↓
D1 optimistic mutation
  ├─ expected version
  ├─ mutable-state predicate
  ├─ version increment
  └─ change record in the same batch
```

Persistence is extended with:

```text
example_resources
  ├─ status
  └─ version

example_resource_changes
```

Runtime Integrity responsibilities:

- stale callers cannot overwrite a newer version silently
- `draft -> active -> finalized` is the explicit example state machine
- `finalized` is terminal and immutable
- successful multi-write mutations use one D1 `batch()`
- zero-row updates are classified rather than reported as success
- SQL constraints provide a second integrity boundary behind application checks
- Domain transition logic is independent of D1 and HTTP
- the D1 adapter does not decide Authentication or Authorization

Detailed rules are defined in `docs/RUNTIME_INTEGRITY.md`.

## Audit & Correlation

Issue #15 adds API request correlation and a structured accountability event contract.

```text
/api/* Request
    ↓
Request Context
  ├─ requestId
  ├─ method
  └─ path
    ↓
Boundary decision / important operation
    ↓
AuditEvent
    ↓
Explicit field projection
    ↓
Worker console JSON
```

Audit & Correlation responsibilities:

- request ID priority is `CF-Ray` → validated `x-request-id` → UUID
- client-provided request IDs are length/character validated before reuse
- API responses return the resolved `x-request-id`
- Request Context stores pathname, not query parameters
- Audit uses generic actor/scope/resource identifiers
- the serializer only emits an explicit bounded field set
- token, Cookie, request body, secrets, and unnecessary PII are outside the Audit contract
- Audit sink failure is isolated from Core request behavior
- traffic analytics and general application diagnostics remain separate concerns

Detailed rules are defined in `docs/AUDIT_OBSERVABILITY.md`.

## Protected Boundary Composition

Issue #17 connects the previously independent foundations through a concrete protected Example API. The Worker HTTP boundary is the baseline composition point; this sequence is not represented as a separate mandatory Application layer.

```text
HTTP Request
   ↓
Worker HTTP Boundary / Example API
   ├─ resolveApplicationSession
   ├─ findExampleResourceScopeId
   ├─ findScopeMembership
   ├─ authorizeScopedAction
   ├─ validate request body
   ├─ call Domain / D1 Example Resource Store
   └─ emit Audit + map HTTP response
```

Protected routes:

```text
GET   /api/scopes/:scopeId/example-resources/:resourceId
PATCH /api/scopes/:scopeId/example-resources/:resourceId
POST  /api/scopes/:scopeId/example-resources/:resourceId/status
```

Persistence gains a one-to-one scope bridge:

```text
example_resources
       ↓
example_resource_scope_bindings
       ↓
resource_scopes
```

Boundary responsibilities:

- unauthenticated requests fail before protected behavior runs
- authorization checks membership, role, requested scope, and actual resource scope
- Example-only roles are `viewer` for read and `editor` for read/write
- invalid input never reaches a successful mutation
- Runtime Integrity failures map to explicit HTTP conflicts
- authorization and mutation decisions emit structured Audit events
- rejected operations are followed by persisted-state assertions
- Local D1 fixture tests positive and negative paths without remote quota use

The example roles and routes are replaceable project examples, not fixed product requirements.

Detailed behavior and the negative-path matrix are defined in `docs/BOUNDARY_TESTING.md`.

## Recovery / Operations Foundation

Issue #19 adds a recovery control plane around D1 without putting destructive Production restore into normal automation.

```text
Normal PR CI
  └─ Local D1 + static recovery-safety validation only

Human-triggered Preview rehearsal
  └─ confirmation
       ↓
     config guard
       ↓
     baseline bookmark
       ↓
     temporary probe
       ↓
     Preview Time Travel restore
       ↓
     post-restore verification

Production incident
  └─ runbook + explicit Human restore approval
```

Recovery responsibilities:

- Preview and Production resources must be distinct
- placeholder resources fail closed before remote recovery work
- Preview rehearsal is `workflow_dispatch` only and requires `REHEARSE_PREVIEW`
- an interrupted rehearsal attempts best-effort return to the captured Preview baseline
- Production restore is not exposed as an automated workflow
- Production recovery requires a pre-restore undo bookmark, confirmed restore target, Human approval, integrity checks, and post-restore smoke
- code rollback and persistent-data restore remain separate decisions
- RPO/RTO are Project operational requirements, not universal Template constants
- PR CI never uses remote D1 merely to prove that recovery automation exists
- actual Time Travel operability is only considered verified after a provisioned Project records a successful manual Preview rehearsal

Detailed procedures are defined in `docs/RECOVERY_OPERATIONS.md`.

## Performance / Capacity Foundation

Issue #21 adds a Local-first D1 benchmark plus a separate quota-aware Preview benchmark.

```text
Required PR CI
  └─ Local D1 smoke
       ├─ 1k neutral resources
       ├─ query-plan assertions
       ├─ result assertions
       ├─ SQL-duration / CLI-wall separation
       └─ rows-read/write evidence when available

Human-triggered Preview benchmark
  └─ BENCHMARK_PREVIEW confirmation
       ↓
     config / environment guard
       ↓
     Preview fixture
       ↓
     representative workload
       ↓
     timing + resource-cost report
       ↓
     cleanup
```

Performance responsibilities:

- Local CI verifies the workload shape and expected indexed access paths without hard-coding a universal millisecond threshold
- `idx_example_resources_status_updated` demonstrates an index tied to a known list-screen access pattern
- D1 `sql_duration_ms` and Wrangler CLI wall time are recorded as different metrics
- rows read/written are captured beside timing when metadata is available
- benchmark reports always label time units explicitly
- an optional `PERF_SERVER_TARGET_MS` may be supplied by a Project whose NFR defines a target
- the remote benchmark has only a Preview mode and refuses placeholder or Preview=Production configuration
- Preview benchmark is `workflow_dispatch` only and requires `BENCHMARK_PREVIEW`
- benchmark fixtures use a reserved prefix and are cleaned before/after execution
- remote performance work is an External Resource Budget decision and is not run on every PR or schedule
- actual remote benchmark success is only considered verified when a provisioned Project records manual Preview evidence

Detailed workload, safety, and interpretation rules are defined in `docs/PERFORMANCE_CAPACITY.md`.

## Planned layers

Later Issues or Projects may add an explicit Application / Use Case layer when the orchestration criteria above are met, as well as production deployment controls, maintenance/read-only mode, concrete identity-provider adapters, long-term private backup storage, alerting, browser performance, and load/stress testing.

Those layers may depend on the Shared, Data, Authentication, Authorization, Runtime Integrity, Audit/Correlation, Protected Boundary, Recovery/Operations, and Performance/Capacity Foundations. Lower-level foundations must not depend on product-specific application behavior.
