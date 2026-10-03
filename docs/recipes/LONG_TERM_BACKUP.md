# Long-term Backup Recipe

## Use when

Use this Recipe when a Project needs data preservation beyond the provider's point-in-time recovery window, explicit backup retention, or reproducible restore evidence.

This Recipe does not authorize Remote or Production operations.

## Inputs

Before implementation, confirm:

- Project data classes and sensitivity
- retention/deletion requirement
- whether long-term backup is actually required
- private backup storage choice
- encryption and key-management responsibility
- Preview / Production separation
- who may create/read/delete backups
- restore rehearsal target
- backup evidence retention
- deleted/anonymized data behavior in retained backups

If these remain undecided, return to `PROJECT_BOOTSTRAP_PROFILE.md` and `DATA_LIFECYCLE_BACKUP.md`.

## Stop Conditions

Do not continue with Remote/Production backup automation if any of the following is true:

- backup storage is public or visibility is unknown
- Production and Preview share the same backup target without an explicit safe isolation design
- retention is unspecified but automatic purge is being added
- backup encryption/access control is unknown
- the operation would upload Production data to GitHub Actions artifacts
- the export/restore target cannot be proven before execution
- Production export/restore has no explicit Human approval
- a restore rehearsal would overwrite non-disposable shared data

## Steps

1. Copy `config/data-lifecycle-policy.example.json` to the Project-managed policy location
2. Resolve lifecycle decisions; do not invent Template defaults
3. Validate the policy with `--require-decided`
4. Implement the Project-specific export command or provider adapter outside the generic Template boundary
5. Keep export payload in approved private storage
6. Create a metadata-only evidence manifest with `data-lifecycle-backup-evidence.mjs`
7. Verify the manifest against the retained file before restore/rehearsal
8. Restore only into an isolated approved target for rehearsal
9. Run schema, count/invariant, and application smoke checks
10. Record the rehearsal result and any gaps

## Validation

Local/CI:

```bash
npm run data-lifecycle:validate
npm run data-lifecycle:evidence:validate
```

Project policy:

```bash
node scripts/validate-data-lifecycle-policy.mjs \
  --file config/data-lifecycle-policy.json \
  --require-decided
```

Backup file integrity:

```bash
node scripts/data-lifecycle-backup-evidence.mjs \
  --verify \
  --file <private-backup-path> \
  --manifest <manifest-path>
```

Remote Preview rehearsal is Project-specific and Human-triggered. Production restore remains a separate Human Gate under `RECOVERY_OPERATIONS.md`.

## Evidence

Retain metadata appropriate to the Project, including:

- application/repository revision
- environment
- capture time
- export method/source label
- backup payload SHA-256 and byte length
- meaningful record/invariant checks when available
- private storage reference that does not expose credentials
- rehearsal target
- restore verification results
- operator/approval where required

Do not place the raw backup payload into a public PR or public CI artifact.

## Do Not

- do not treat D1 Time Travel as indefinite archival backup
- do not treat a successful export as proof of restorability
- do not store secrets in lifecycle policy JSON
- do not copy Production data into source control
- do not fix a failed migration by resetting/reseeding real data
- do not invent a universal retention period
- do not automate Production purge or restore from normal PR CI
