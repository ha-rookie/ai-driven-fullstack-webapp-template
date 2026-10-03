# Data Lifecycle / Long-term Backup Foundation

## Purpose

This document defines the Full-stack Template boundary for data retention, deletion, long-term backup, backup evidence, and restore rehearsal.

It complements `RECOVERY_OPERATIONS.md`. D1 Time Travel is the baseline for short-window point-in-time recovery. This foundation covers requirements that remain after that recovery window: long-term preservation, explicit retention, deletion behavior, private storage, and verifiable backup evidence.

The Template does **not** choose a universal backup provider, retention period, RPO/RTO, legal basis, or deletion schedule.

## Responsibility split

```text
D1 Time Travel / Recovery
  └─ short-window incident recovery and restore decision

Data Lifecycle / Long-term Backup
  ├─ retention and deletion policy
  ├─ whether long-term backup is required
  ├─ private/encrypted backup storage decision
  ├─ Preview / Production separation
  ├─ restore rehearsal expectation
  └─ backup evidence and integrity verification

Project
  └─ provider, schedule, retention duration, data classes, legal/contract requirements
```

## Template safety invariants

The following are not Project-selectable defaults:

- Production backup payloads must not be uploaded to public repository artifacts
- normal PR CI must not create or export Production backups
- Preview and Production backup targets must be treated as separate resources
- backup manifests must not contain raw SQL/data payloads, tokens, cookies, passwords, private keys, or secrets
- a backup is not considered restorable only because an export command succeeded
- code rollback and data restore remain separate decisions

These invariants are represented in `config/data-lifecycle-policy.example.json` and validated by `scripts/validate-data-lifecycle-policy.mjs`.

## Project lifecycle decisions

The example policy requires explicit decisions for:

- `retentionPolicy`: how long each Project-defined data class is retained
- `deletionPolicy`: when and how active data is deleted or anonymized
- `longTermBackup`: whether recovery beyond provider Time Travel is required
- `backupStorage`: private storage provider/location class and non-secret reference
- `backupEncryption`: encryption expectations and key-management responsibility
- `backupAccessControl`: who or what may create/read/delete backups
- `backupEnvironmentSeparation`: Preview and Production must not share a backup target
- `restoreRehearsal`: how restore ability is proven before an incident
- `backupEvidenceRetention`: how long manifests and restore evidence are retained
- `deletedDataInBackups`: how deletion/anonymization requests interact with immutable or retained backups

All example decisions begin as `undecided`. Do not convert them into universal Template defaults.

## Policy validation

Structural validation:

```bash
npm run data-lifecycle:validate
```

Project policy validation:

```bash
node scripts/validate-data-lifecycle-policy.mjs \
  --file config/data-lifecycle-policy.json
```

Project-start / convergence gate:

```bash
node scripts/validate-data-lifecycle-policy.mjs \
  --file config/data-lifecycle-policy.json \
  --require-decided
```

`not-applicable` remains available when a decision genuinely does not apply, but a rationale is required.

When `backupStorage` is decided, its value must be an object whose `visibility` is `private`. When `backupEnvironmentSeparation` is decided, it must be `true`.

## Backup evidence manifest

`scripts/data-lifecycle-backup-evidence.mjs` creates **metadata only** for a Project-generated export file.

It records:

- environment (`local`, `preview`, or `production`)
- capture timestamp
- Project-defined export source label
- optional source revision
- backup artifact basename
- byte length
- SHA-256 digest
- optional Project-defined record count
- an explicit `containsBackupPayload: false`

It does not copy, upload, encrypt, delete, or restore the backup payload.

Example for Preview:

```bash
node scripts/data-lifecycle-backup-evidence.mjs \
  --create \
  --file /private/path/preview-export.sql \
  --environment preview \
  --captured-at 2026-10-03T00:00:00Z \
  --source project-d1-export \
  --source-revision <commit-sha> \
  --record-count 1234
```

Production evidence additionally requires an acknowledgement that the utility is handling metadata only:

```bash
node scripts/data-lifecycle-backup-evidence.mjs \
  --create \
  --file /private/path/production-export.sql \
  --environment production \
  --captured-at 2026-10-03T00:00:00Z \
  --source project-d1-export \
  --ack-production-metadata-only
```

This acknowledgement is **not** approval to create the Production backup. The export itself remains a Project-specific Human Gate operation.

## Evidence verification

To verify that a local/private backup file still matches its recorded evidence:

```bash
node scripts/data-lifecycle-backup-evidence.mjs \
  --verify \
  --file /private/path/preview-export.sql \
  --manifest artifacts/data-lifecycle/backup-evidence-preview-....json
```

Verification checks SHA-256, byte length, and artifact basename. A Project may add domain-specific row/count/invariant checks to its restore rehearsal; the Template does not invent a universal meaning for a single database row count.

## Record counts

`--record-count` is optional because a multi-table database has no universal single count that proves completeness.

Projects should prefer meaningful checks such as:

- count of critical business records
- count by tenant/resource scope
- migration/schema version
- important foreign-key/invariant checks
- sampled business-key checks

If no defensible count exists, leave it `not-measured` rather than recording a misleading number.

## Restore rehearsal

A long-term backup is not operationally complete until a restore path has been rehearsed in an isolated non-Production target.

A Project rehearsal should prove at least:

1. the backup payload can be retrieved from private storage
2. integrity metadata matches before restore
3. the target environment is not Production
4. schema can be reconstructed or validated
5. critical record/invariant checks pass
6. the application can read the restored dataset
7. the rehearsal leaves evidence linked to the source backup and application revision

Do not overwrite a shared Preview database just to simplify a rehearsal unless that environment is explicitly designated disposable for the test.

## Retention and purge

Retention is Project-defined. The policy must distinguish at least:

- active application data retention
- backup payload retention
- backup evidence retention
- audit retention, if different
- deletion/anonymization handling for data already present in backups

Automatic purge should not be added until the Project has an explicit retention decision, authorization boundary, dry-run/evidence behavior, and recovery implications documented.

## Deleted data in backups

Deleting active records does not automatically erase historical backups.

Projects must decide how deletion/anonymization requirements apply to retained backups, considering:

- provider capabilities
- immutable backup windows
- legal or contractual retention duties
- restore procedures that could reintroduce deleted data
- post-restore deletion/anonymization replay

The Template does not declare one universal legal answer.

## Private storage

The Template intentionally does not select D1 export + R2, object storage from another provider, encrypted offline storage, or an external backup service as the baseline.

Whichever provider a Project chooses, document:

- private visibility/access boundary
- encryption at rest and in transit
- key-management responsibility
- environment separation
- retention and deletion behavior
- retrieval path for restore rehearsal
- provider failure/lockout contingency where relevant

Do not store provider credentials in the policy JSON.

## CI boundary

Normal PR CI runs only self-tests for policy/evidence utilities. It must not:

- export Preview or Production D1
- upload backup payloads
- access private backup storage
- purge retained backups
- perform remote restore rehearsal

Remote evidence belongs to Human-triggered Project workflows or runbooks after concrete resources are provisioned.

## Relationship to Project Bootstrap Profile

`PROJECT_BOOTSTRAP_PROFILE.md` asks whether retention/deletion and backup/recovery have been decided. This document and policy file provide the deeper Full-stack contract once those decisions are needed.

The bootstrap profile remains the Project-start decision map; this policy is not a second Product requirement document.

## Related files

- `config/data-lifecycle-policy.example.json`
- `scripts/validate-data-lifecycle-policy.mjs`
- `scripts/data-lifecycle-backup-evidence.mjs`
- `docs/RECOVERY_OPERATIONS.md`
- `docs/PROJECT_BOOTSTRAP_PROFILE.md`
- `docs/recipes/LONG_TERM_BACKUP.md`
