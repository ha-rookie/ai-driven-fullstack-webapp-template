# Full-stack Architecture

## Purpose

Define only the technology-specific runtime structure added by this Full-stack Template. Technology-independent development process and governance remain in the upstream Generic Template.

## Target architecture

```text
Browser
  ↓
React SPA
  ↓ /api/*
Cloudflare Worker
  ↓
Application
  ↓
Domain
  ↓
Infrastructure
  ↓
D1 / External Services
```

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

- `GET /api/health` remains database-independent
- `GET /api/health/database` verifies only that the D1 binding can execute a minimal query
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
- roles, memberships, permissions, and product scope are deliberately absent

Detailed rules are defined in `docs/AUTH_DESIGN.md`.

## Planned layers

Later Issues add `application`, `domain`, persistence ports/adapters, authorization, concurrency/invariant enforcement, audit, recovery, and boundary tests.

Those layers may depend on the Shared, Data, and Authentication Foundations, but lower-level foundations must not depend on product-specific application behavior.
