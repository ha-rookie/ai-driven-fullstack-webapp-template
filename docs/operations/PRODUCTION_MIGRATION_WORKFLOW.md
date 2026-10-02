# Production Migration Workflow

## Purpose

Production D1 migration is a manual release operation. It is not triggered by pull request, push, or schedule.

The workflow enforces this sequence:

1. validate an exact target commit SHA and explicit Production/Preview resource identifiers
2. capture current Production metadata using a read-oriented Cloudflare token
3. run Production Migration Preflight (#107)
4. publish the pending migration plan and preflight evidence
5. enter the GitHub `production` environment Human Gate
6. revalidate the exact SHA, resource identity, and confirmation
7. recapture Production metadata and rerun preflight to detect state changes while approval was pending
8. explicitly run `wrangler d1 migrations apply <DATABASE_NAME> --remote`
9. capture metadata after migration
10. run Production Schema Verification (#109)
11. preserve migration and verification evidence

No restore is executed automatically.

## Required repository / environment setup

### GitHub environment

Create a GitHub Environment named `production` and configure required reviewers before treating this workflow as production-ready.

The workflow contains `environment: production`, but repository owners remain responsible for configuring the environment protection rule. The typed confirmation and manual dispatch are additional gates; they are not substitutes for an independently configured reviewer gate where the plan requires one.

### Cloudflare credentials

Configure these secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_READ_TOKEN`
- `CLOUDFLARE_D1_MIGRATION_TOKEN`

Use separate credentials for read-oriented preflight and mutation where the Cloudflare account policy permits it. Keep the mutation token scoped to the GitHub `production` environment where possible.

Do not commit API tokens, account credentials, or Production secrets.

## Manual inputs

The operator must provide:

- full 40-character target commit SHA
- immutable Production D1 database name
- Production D1 database UUID
- Preview D1 database UUID
- Preview validation evidence reference
- recovery-point / backup evidence reference
- verification query / invariant descriptions as JSON
- per-migration review/backfill contracts as JSON when required by #107
- exact confirmation text: `MIGRATE PRODUCTION`

Production and Preview database IDs must differ.

The workflow checks out the exact SHA and verifies `git rev-parse HEAD` before any remote mutation.

## Why database name is required

The workflow executes migrations using the D1 database name instead of relying only on a Worker binding. Bindings can be renamed or remapped. The workflow separately verifies the supplied Production database UUID against `wrangler d1 info` before using the database.

## Preflight and TOCTOU protection

A successful preflight before Human approval is not sufficient by itself. Production state may change while an approval is pending.

Therefore the mutation job performs these checks again after the Human Gate and immediately before `migrations apply`:

- exact checkout SHA
- typed confirmation
- Production / Preview resource separation
- actual Production D1 UUID
- applied migration state
- #107 destructive-change / review / recovery / verification contract

If any check fails, migration does not start.

## Metadata capture

The helper queries only schema and migration metadata:

- `d1_migrations` names
- `sqlite_master` table/index names
- column names for baseline tables

It does not dump business rows.

The resulting snapshot is compatible with #109 Production Schema Verification.

## Migration execution

The mutation is explicit:

```text
wrangler d1 migrations apply <DATABASE_NAME> --remote
```

`--remote` is mandatory. The workflow never relies on Wrangler's default local/remote mode.

A failed migration stops the job. The workflow does not run Time Travel restore, cleanup, reseed, reset, or any compensating write automatically.

## Evidence

The preflight job retains:

- pre-deploy schema metadata snapshot
- #107 preflight snapshot
- preflight report
- pending migration plan

The Production mutation job retains:

- pre-apply schema metadata snapshot
- second preflight snapshot / report
- Wrangler migration output
- post-migration schema metadata snapshot
- #109 schema verification report

Evidence artifacts are retained for 14 days by the template default. Projects may adjust retention to their release / audit policy.

## Stop Conditions

Do not start or continue migration when any of these applies:

- target SHA is not a full immutable commit SHA
- Production / Preview database IDs are equal
- Production database identity cannot be verified
- confirmation text is wrong
- Preview evidence is missing
- recovery point is not confirmed
- #107 preflight fails
- required review/backfill contract is missing
- remote migration fails
- #109 post-migration schema verification fails

A post-migration verification failure is an incident requiring operator review. It is not authorization for automatic restore.

## Scope boundary

This workflow covers Production D1 migration orchestration only.

It does not:

- deploy application code
- automatically restore Production data
- decide Product-specific backfill semantics
- replace GitHub Environment protection configuration
- replace Cloudflare IAM / token governance
