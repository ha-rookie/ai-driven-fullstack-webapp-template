# Database / Migration Scoped Instruction

## Applies When

Use this Instruction for D1 binding, schema, migration, index, Local database validation, or environment-specific database work.

## Scope Hints

- `migrations/**`
- D1 binding / schema verification
- database-related scripts or tests
- Local / Preview / Production DB selection

## Sources to Read

- `../DATA_DESIGN.md`
- `../FULLSTACK_ARCHITECTURE.md`
- applicable Common Template testing / security / cloud infrastructure Instructions

## Rules

- Add schema evolution through a new ordered migration; preserve already-applied migration history
- Keep repository migrations as the schema source of truth; do not rely on manual remote edits
- Validate migration and schema locally before deliberate remote application
- Keep Local, Preview, and Production database resources distinct
- Treat Preview/Production resource identity as explicit configuration, not an inferred default
- Preserve foreign keys, uniqueness, checks, and indexes that enforce documented invariants
- Tie new indexes to a known access pattern and validate the intended query plan when relevant
- When a schema change interacts with optimistic concurrency, auth, or authorization, load the corresponding Instruction too

## Do Not

- Do not run remote D1 migration from normal PR CI
- Do not point Preview at Production data
- Do not rewrite an applied Production migration to change history
- Do not use `clean`, reseed, destructive reset, or broad fixture deletion as a default preparation step
- Do not copy Template example schema mechanically into Product Domain design
- Do not expose database IDs, SQL errors, schema internals, secrets, or row data as public diagnostics

## Validation / Evidence

- all numbered migrations apply successfully to isolated Local D1
- local schema verification passes
- required constraints/indexes are present
- migration order has no duplicate or missing sequence introduced by the change
- no remote resource was contacted unless the Issue explicitly authorizes a Human-gated remote operation
- if remote work is authorized, record target environment/resource identity and actual execution evidence separately from Local validation
