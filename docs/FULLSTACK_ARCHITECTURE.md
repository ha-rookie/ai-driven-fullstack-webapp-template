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

## Planned layers

Later Issues add `application`, `domain`, `infrastructure`, authentication, authorization, D1 persistence, concurrency, audit, and boundary tests.

Those layers may depend on the Shared Foundation, but the Shared Foundation must not depend on them.
