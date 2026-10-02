# Code Rollback / Stable Marker

## Purpose

Code rollback restores a previously verified application version without performing a database restore or downgrade migration.

A rollback target is an immutable 40-character commit SHA. Moving branches or tags are not accepted as rollback authority.

## Stable marker contract

The operator supplies three explicit values:

- `current_deployed_sha`: the code currently serving Production
- `previous_stable_sha`: the last version that completed the Production release checks
- `target_sha`: the requested rollback target

By default `target_sha` must equal `previous_stable_sha`, and it must differ from `current_deployed_sha`.

The durable audit record is the deploy/smoke/rollback Evidence tied to immutable SHAs. The workflow does not move a `stable` tag automatically.

## Safety sequence

1. Validate all SHAs, rollback reason, and exact typed confirmation
2. Checkout the current control-plane tooling separately from the rollback target
3. Verify the current Production schema is compatible with the rollback target
4. Validate and build the rollback target
5. Wait for the GitHub `production` Environment Human Gate
6. Repeat rollback and schema checks after approval
7. Revalidate Production security configuration
8. Rebuild and deploy the exact rollback target
9. Run bounded Production smoke verification
10. Persist rollback Evidence with actor, reason, current SHA, previous stable SHA, target SHA, and workflow run ID

## Why control and target are checked out separately

An older stable application commit may not contain the newest rollback, schema-verification, or smoke tooling. The workflow therefore keeps current control-plane tooling under `control/` and the code being restored under `target/`.

Safety checks always use the current control plane. Build and deploy operate only on the exact target SHA.

## Schema compatibility

Rollback is stopped if the current Production schema cannot satisfy the schema baseline expected by the target commit. A code rollback must not silently attempt to downgrade or restore D1 data.

If schema incompatibility is detected, stop and use the Recovery / Operations procedure instead of forcing the rollback.

## Data boundary

This workflow never performs:

- D1 restore
- downgrade migration generation
- reset / reseed / cleanup
- Production data deletion

Code rollback and data recovery are separate operational decisions.

## Failure handling

A failed rollback deploy or failed post-rollback smoke verification is not considered a successful release state. The workflow fails and preserves available Evidence. It does not recursively trigger another rollback or restore automatically.
