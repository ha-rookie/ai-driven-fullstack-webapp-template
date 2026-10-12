# Preview D1 remote migration Human Gate (#632)

## Why

The 2026-10-12 main push that contained migration `0035_workhub_travel_delegations.sql` launched `preview-d1-migration.yml` and applied that migration **before** the user explicitly approved the remote operation. A PR merge is not permission to mutate Preview D1.

## Default: no automatic remote D1 write

The workflow uses **only `workflow_dispatch`**. No `push`, `pull_request`, or schedule triggers exist. A normal PR or main merge, including a PR containing migrations, **does not dispatch an apply**. Local D1 tests remain independent of Preview D1. Deployment is separately controlled.

To apply migrations in the future, the **repository owner must first independently authorize that specific remote Preview D1 operation** (database, exact main SHA, and the exact pending filenames). This workflow change itself is **not** authorization to execute migrations.

## Manual procedure (separate human action)

1. Review the PR, exact files in `migrations/`, their contents, rollback / restore evidence, and the intended Preview database: `ai-driven-webapp-template-preview` (`f1ce1268-2be2-4a20-ab10-a94c32feee64`).
2. Confirm the desired target is the **current merged main HEAD** and record the full 40-character lowercase SHA. Approve the exact ordered pending SQL filenames in advance; do not guess from an earlier run. If another migration is pending, stop and investigate.
3. The **repo owner**, separately from the chat/code merge, opens GitHub Actions → **Preview D1 migration** → **Run workflow**, selects branch **main**, and supplies the approved `target_sha`, `expected_pending_migrations` (comma-separated basenames, e.g. `0036_example.sql`) and exact confirmation `MIGRATE PREVIEW D1`. Never trigger this workflow for a mere code deploy.
4. The preflight refuses any non-owner, non-manual event, non-main branch, stale/non-40-character target SHA, missing/incorrect confirmation, malformed/empty/duplicate migration list, or wrong Wrangler Preview DB binding. The later Preview-environment job **rechecks** the exact SHA and pinned DB after its environment gate.
5. Cloudflare token verification and an exact D1 name/UUID comparison must pass. Wrangler lists **remote Preview pending** SQL migrations; the guard parses the list, requires a valid nonempty table, and compares the ordered names with the owner's declaration. Immediately before apply the same remote list is fetched and checked again. Any failure stops **before write**. The dedicated `CLOUDFLARE_D1_MIGRATION_TOKEN` is retained, not widened.
6. After an explicitly authorized apply, collect GitHub run/step summary, changed Migration names, database ID, SHA, and any follow-up verification. The CI success/PR merge alone is not this evidence.

The workflow references the existing GitHub `preview` Environment. **This repository's environment protection / required reviewer configuration is not independently verified here.** Consequently, do not claim an independent second-person approval is enforced until an administrator has verified it. Owner-only explicit dispatch + exact-plan verification are coded safeguards, not an absolute protection against a repository administrator intentionally bypassing them. Concurrent database changes outside this workflow can still race the last list/apply interval.

## Pure offline checks (never access Cloudflare)

```bash
node scripts/preview-d1-migration-guard.mjs --self-test
node scripts/preview-d1-migration-guard.mjs --check-config
```

The `tests/preview-d1-migration-guard.test.ts` CI test verifies the absence of automatic triggers, the exact single remote apply step and guard call order, and that invalid actor, ref, SHA, database and migration plans are rejected. **Do not test remote mutation by executing this workflow without individual human permission.**

## Work Selection / continuation

The approved Stage4 #348 priority remains. A temporary #632-only Work Selection exception, authorized through the existing #597 governance mechanism, permits this blocker fix. After safe merge, remove that exception and proceed with #348's previously agreed WBS. #521 Preview authentication and #350 crosscutting quality remain independently open.
