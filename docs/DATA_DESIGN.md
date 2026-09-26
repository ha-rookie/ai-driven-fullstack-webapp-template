# Data Design

## Purpose

Define the D1-specific persistence baseline added by this Full-stack Template. Product-domain schema, authentication data, authorization rules, concurrency control, and production data operations are introduced only by later dedicated Issues.

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

## Example resource

`migrations/0001_core.sql` creates a deliberately neutral `example_resources` table:

```text
example_resources
  id
  name
  created_at
  updated_at
```

Its purpose is to prove the migration path and provide a later target for repository, API, authorization, and concurrency examples.

This first migration intentionally does **not** include:

- users or external identities
- roles or memberships
- application sessions
- optimistic-concurrency `version`
- status/state-transition rules
- product-specific fields

Those concepts belong to later Issues so their design decisions remain explicit.

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

Remote migration, performance benchmark, backup/recovery rehearsal, and quota-sensitive operations are intentionally outside this baseline Issue and must be deliberate operations.
