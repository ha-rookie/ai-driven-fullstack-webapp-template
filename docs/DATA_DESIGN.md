# Data Design

## Purpose

Define the D1-specific persistence baseline added by this Full-stack Template. Product-domain schema and production data operations remain explicit later decisions. Authentication persistence is introduced by Issue #9, authorization persistence by Issue #11, runtime-integrity persistence by Issue #13, and protected-boundary scope binding by Issue #17.

## D1 binding

The Worker receives a `DB: D1Database` binding.

`wrangler.jsonc` contains safe placeholder IDs only. Before any Preview or Production deployment, replace the placeholder database names and IDs with resources created for that environment.

Preview and Production must use separate D1 resources. Do not point Preview at Production data.

## Local-first validation

Database development and CI use Local D1 first:

```text
npm run db:migrate:local
npm run db:verify:local
```

The baseline CI must not apply migrations to remote D1 resources. This avoids consuming shared quotas and prevents CI from mutating Preview or Production data.

## Migration policy

Schema changes are represented by ordered SQL files under `migrations/`.

- add schema changes through a new numbered migration
- do not rewrite already-applied production migrations to change history
- do not rely on manual schema edits as the repository source of truth
- validate migrations locally before any deliberate remote application

## Core example resource

`migrations/0001_core.sql` creates a deliberately neutral `example_resources` table:

```text
example_resources
  id
  name
  created_at
  updated_at
```

Its purpose is to prove the migration path and provide a target for later persistence, API, authorization, and concurrency examples without introducing product-specific domain language.

## Authentication data

`migrations/0002_auth_foundation.sql` adds only the data required for provider-independent identity and application sessions:

```text
users
external_identities
application_sessions
```

Rules:

- external provider subjects map to internal `users.id`
- provider subjects are unique within a provider
- application sessions reference internal users
- only a SHA-256 session token hash is stored in D1
- raw session tokens are never persisted
- session rows carry explicit expiry and optional revocation timestamps
- foreign keys cascade identity/session cleanup when an internal user is deleted

## Authorization data

`migrations/0003_authorization_foundation.sql` adds generic resource scopes and memberships:

```text
resource_scopes
scope_memberships
```

Rules:

- a user may have at most one membership row per resource scope
- membership role must be a non-empty string
- role vocabulary is not fixed by the database
- memberships reference both an internal user and a resource scope
- deleting a user or scope cascades its memberships
- indexes support lookup by user/scope and scope/role

The authorization migration intentionally does **not** add a global administrator role, permission table, ABAC attributes, or product-specific scope names.

## Runtime Integrity data

`migrations/0004_runtime_integrity.sql` upgrades the neutral example resource into an executable concurrency/state-integrity example:

```text
example_resources
  ...
  status   draft | active | finalized
  version  >= 1

example_resource_changes
  resource_id
  version
  change_kind
  from_status
  to_status
  created_at
```

Rules:

- existing rows start in `draft` at version `1`
- each successful mutation increments the resource version
- status is constrained to the example state machine vocabulary
- change rows reference the resource and are unique per resource/version
- rename changes do not carry status fields
- status-transition changes must carry valid from/to states
- deleting a resource cascades its example change history

Application code still performs explicit optimistic-concurrency and transition checks. Database constraints are complementary and must not be replaced by UI-only validation.

Detailed behavior is defined in `docs/RUNTIME_INTEGRITY.md`.

## Protected boundary scope binding

`migrations/0005_protected_boundary.sql` connects the neutral resource to generic authorization scopes without rewriting earlier migration history:

```text
example_resources
       ↓ 1:1
example_resource_scope_bindings
       ↓
resource_scopes
```

Rules:

- each example resource may bind to at most one scope
- a binding must reference an existing example resource and scope
- deleting the resource or scope cascades the binding
- an unbound resource is not exposed through the protected Example API
- the sample binding exists to demonstrate boundary composition, not to prescribe every project's schema

A project whose resource is inherently scoped may put `scope_id` directly on that domain table instead of retaining the bridge table.

Detailed protected-boundary behavior is defined in `docs/BOUNDARY_TESTING.md`.

## Schema verification

Local validation verifies these baseline tables:

- `example_resources`
- `example_resource_changes`
- `example_resource_scope_bindings`
- `users`
- `external_identities`
- `application_sessions`
- `resource_scopes`
- `scope_memberships`

CI also verifies that `example_resources` contains the `status` and `version` columns after all numbered migrations are applied.

## Health checks

`GET /api/health` stays independent of D1 and reports only that the Worker runtime is reachable.

`GET /api/health/database` performs a minimal `SELECT 1` through the D1 binding. It returns `200` when the binding is usable and `503` when it is unavailable. It does not expose database identifiers, SQL errors, schema details, or application data.

## Environment boundary

```text
Local
  └─ isolated D1 state used by developer/CI

Preview
  └─ dedicated Preview D1 resource

Production
  └─ dedicated Production D1 resource
```

Remote migration, performance benchmark, backup/recovery rehearsal, and quota-sensitive operations are intentionally outside the baseline and must be deliberate operations.
