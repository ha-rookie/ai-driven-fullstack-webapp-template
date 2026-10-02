# Production Migration Preflight

This preflight prevents a Production D1 migration from starting when the migration set, target resource, recovery condition, or verification contract is unsafe or incomplete.

## Safety boundary

The preflight **does not connect to Production D1** and does not execute migrations. It evaluates repository migrations plus a non-secret operator snapshot. The Production migration workflow must treat a non-zero exit code as a Stop Condition.

Never use clean, reset, truncate, reseed, or destructive migration shortcuts against a Production database that contains real data.

## Command

```bash
npm run db:migration:preflight -- --snapshot=path/to/preflight-snapshot.json
```

CI uses only:

```bash
npm run db:migration:preflight -- --self-test
```

## Snapshot contract

The snapshot is supplied by the Project/Operator at release time and must not contain secrets or business row data.

```json
{
  "environment": "production",
  "productionDatabaseId": "non-placeholder-production-id",
  "previewDatabaseId": "different-preview-id",
  "previewValidated": true,
  "recoveryPointConfirmed": true,
  "verificationContractDefined": true,
  "previewEvidenceRef": "preview-validation-reference",
  "recoveryPointRef": "time-travel-or-backup-reference",
  "appliedMigrations": ["0001_core.sql"],
  "verificationQueries": [
    "row-count/invariant identifier; do not embed business data"
  ],
  "migrationContracts": {
    "0015_example.sql": {
      "reviewed": true,
      "backfillRequired": false,
      "verification": ["required-null-count", "domain-invariant"]
    }
  }
}
```

## Stop Conditions

The preflight stops when any of the following is true:

- migration numbering is invalid, duplicated, or has a gap
- applied migration metadata references a migration not present in the repository
- Production / Preview database identifiers are missing, placeholders, or identical
- Preview validation evidence is missing for a pending migration
- a recovery point cannot be confirmed
- a verification contract is missing
- a pending migration contains destructive SQL such as DROP or TRUNCATE
- a DELETE statement has no WHERE clause
- a migration requiring manual/backfill review has no explicit migration contract

## Review Conditions

Some changes are not always destructive but require explicit review, for example:

- `ALTER TABLE ... ADD COLUMN ... NOT NULL`
- data-changing `UPDATE`
- creation of a unique index on existing data

The Project must define how existing rows will be verified before and after the migration. Row-count equality alone is not sufficient proof of semantic integrity.

## Evidence

A release pipeline may retain the preflight report together with:

- applied and pending migration names
- Preview validation reference
- Recovery Point reference
- target environment/resource identifiers
- verification contract identifiers

Do not include secret values or bulk business-row dumps in evidence.

## Relationship to other controls

- `security:validate` validates non-secret Production/Preview security configuration and resource separation
- this preflight validates whether migration execution may begin
- Production Schema Verification (#109) validates expected schema/migration state before and after migration
- Production Migration Workflow (#108) will orchestrate the actual controlled execution
