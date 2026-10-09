# Risk-based CI / regression-test selection

## Rationale

Do **not** pay the full database, session, security, browser and performance regression cost on every README or isolated admin UI edit. A PR's test suite should reflect its actual changed files, while retaining a strong default for anything that can affect runtime correctness, data, permissions or deployment.

This policy is deliberately conservative: **path classification is not dependency analysis**. When a file could be shared across Worker/UI or has unclear impact, the selector uses FULL. A failed change diff also fails the required job, never silently chooses a cheap tier. Git renames/copies are evaluated as separate deleted and added paths using `git diff --no-renames`, so moving sensitive source code into a docs-only path cannot downgrade the change to DOCS.

## Required `validate` check — unchanged name and job identity

`.github/workflows/ci.yml` always runs its `validate` job for PRs; this is the sole required status check in the repository's main ruleset (verified 2026-10-09). Only its expensive *steps* are conditional.

| Tier | Intended changes | Required CI checks |
| --- | --- | --- |
| **DOCS** | Only README/CONTRIBUTING or non-security, non-operations Markdown | Classifier self-tests, changed-file classification, public repository entrypoint validation |
| **FRONTEND** | Only `src/reference/admin/**/*.tsx` or stylesheet changes (possibly alongside DOCS) | DOCS checks plus `npm ci`, lint, full TypeScript production build; separately triggered Browser E2E remains |
| **FULL** | Auth, authorization, Worker, shared code, domain, data model, migrations, config, test harness, dependencies, CI workflows, unknown or mixed changes | Always-on local D1 migration/schema, `validate:local:core`, lint/build, protected fixture and runtime/security boundary checks; expensive isolated D1 suites selected by change impact |

- `workflow_dispatch` and the Monday 03:30 JST weekly scheduled `Full-stack template CI` use FULL unconditionally.
- **Any** unknown or mixed path upgrades the whole PR to FULL. A missing/invalid commit SHA or failed `git diff` makes `validate` fail. Source and destination paths of renames are both checked. A `FULL` result cannot be downgraded because another file is docs-only.
- Workflow changes (including this policy) are always FULL.
- Existing `Secret detection` remains on **all** PRs, including DOCS.
- Browser E2E remains triggered on relevant source/config PRs, **but runs the desktop project only on PRs** to prioritize rapid feedback. Monday 04:00 JST weekly and manual runs retain desktop + mobile and production-build frontend performance evidence. Preview Browser acceptance is separate and must be run after actual Preview deployment for relevant release changes.
- Production validation and deployment Human Gates are unchanged. CI never implies authorization to deploy Production.

## Fast FULL: targeted expensive D1 regressions (2026-10-09)

For **pull requests**, FULL still always runs the local migration/schema, unit tests,
`validate:local:core` (auth/session, credential attack, idempotency, migration/deploy
self-tests, source safety, recovery, performance *policy* self-tests), lint/build
and the live protected-boundary HTTP/CSRF/authorization smoke. Two expensive tests
are no longer unconditional in every FULL PR:

| Slow suite | Trigger in PR | Weekly / manual |
| --- | --- | --- |
| `performance:local` (~53–58s in ordinary successful FULL logs) | D1/SQL/migration/shared/domain/worker changes, package/toolchain/CI impact, unknown changes; skips only for explicit independent UI/docs/Preview-E2E/test scopes | **Always run** |
| `operation-mode:local` (~69–74s) | Operation Mode, infrastructure, auth/http/admin Worker, domain/shared/migration/toolchain/CI/unknown changes; independent worker business endpoint can omit it | **Always run** |

The flag selector is `classifyExpensiveChecks` in `scripts/ci-change-impact.mjs`,
recorded as `performance` and `operation_mode` step outputs. Safe-path opt-outs
are narrowly explicit: Markdown/docs, independently scoped `src/reference` UI,
Preview/browser `e2e`, non-DB/non-performance/non-operation-mode `tests/*.test.ts`,
and `browser-e2e.yml`. A mixed PR takes the union of required suites.
`--full` for scheduled or `workflow_dispatch` always selects both.
Unknown paths, selector/CI changes, package changes and sensitive runtime
changes select both. Renames use `--no-renames` (both removed/added paths).

`npm run validate:local` is **unchanged**, remains the complete developer/weekly
command and can be invoked manually whenever confidence warrants.
`npm run validate:local:core` omits *only* the two expensive suites from the
core; CI runs them separately when selected. This is an **intentional tradeoff**:
non-affected PRs may have a latent cross-boundary failure detected by the weekly
full regression rather than at PR time. The developer currently prioritizes fast
feedback; safety-critical changes still fail closed. If an affected-change
misclassification is found, restore unconditional checks until mapping is fixed.

Observed baseline: sample of 30 CI runs, 26 FULL successes; FULL job median ~247s,
local suite median ~195s; two expensive suites together ~122–132s per typical run.
**Expected potential saving, not a measured after-change result:** up to about
two minutes in FULL PRs eligible to skip both. Measure actual after-change CI
before claiming realized time savings. Source: [Issue #529 measurements](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/529#issuecomment-6076809265).

## Speed-first Browser E2E (2026-10-09)

`.github/workflows/browser-e2e.yml` previously ran the same browser scenarios for both desktop and mobile, rebuilt the production bundle, and executed performance evidence for **every** relevant PR. These add time to PR feedback but overlap the required `validate` build and the separately scheduled regression.

- **PR:** run `npx playwright test --project=desktop-chromium` as the representative browser scenario; do not rerun the production build/performance evidence in the separate Browser E2E workflow. The required non-DOCS `validate` build still runs.
- **Weekly Monday 04:00 JST / manual `workflow_dispatch`:** run **both desktop and mobile projects**, production build, frontend bundle evidence and production-build browser performance checks as before.
- **Preview deployed acceptance:** if the application/runtime actually changes and is deployed, verify the affected functionality in Preview with the appropriate desktop/mobile personas; do not confuse faster PR smoke with release acceptance.
- **Explicit risk:** mobile-only regressions or frontend performance regressions may be detected later by weekly/manual checks. Request a manual full Browser E2E run for a release or meaningful mobile/layout change if earlier detection is important.
- Keep failed-test screenshots/traces. Pinning, Chromium installation, concurrency cancellation and existing workflow path triggers are unchanged.
- [Issue #529](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/529) records measured impact; E2E runtime savings should be verified on a real PR, not asserted from the workflow edit alone.

## Read-only Preview re-deploy / fixture plan (2026-10-09)

Unnecessary Preview deployments and D1 reseeds consume time and may affect
shared test fixtures. Before issuing any remote operation, inspect **separate
evidence for the last deployed runtime SHA and last successfully seeded fixture
SHA**. The planner does not contact or change Cloudflare:

```bash
node scripts/preview-change-plan.mjs \
  --deployed-sha=<actual-preview-deployed-full-sha> \
  --target-sha=<merged-main-full-sha> \
  --seeded-sha=<last-successful-preview-seed-full-sha>
```

- **Semantic package check:** `package.json` no longer forces redeploy if BOTH
  pinned revisions contain readable JSON, every non-script field (including all
  dependencies/tooling) is structurally equal, and every changed script is a
  `test`/`test:*` or `validate:local*` script. Other scripts, install hooks,
  a build/dev/preview change, lockfile changes, invalid JSON or missing SHAs
  still force redeploy. The CLI prints `packageDiff=test_scripts_only` only
  after verifying actual Git objects via `git show <sha>:package.json`.
- This is an advisory conclusion about code/runtime changes, NOT evidence of
  which SHA was actually deployed. Production and Preview Human Gates remain.
- `deploy:skip` means the diff is limited to known docs / GitHub workflow /
  tests / E2E / selector/planner content without an application or config change.
  Any Worker/UI/public/config/build/dependency/unknown change requires deploy.
- `seed:skip` is supported **only** if the actual last successful seeded SHA
  was provided and its diff has no seed/migration/fixture changes or unknown
  seed-affecting scripts. If unknown, report `seed:unverified` or `review`;
  never assume seed=deployment.
- `browser:recommended` means runtime or Browser E2E/harness changes should
  be validated; test-only updates can use the unchanged deployed Preview.
- Renames inspect **both** deleted source and added destination paths.
  Full exact Git SHAs and ancestry are required or the tool fails. A divergence
  is not silently treated as no change.
- The planner is **advisory/read-only**. No remote resource changes, seeding,
  production operations or implicit Human Gate approval. Never substitute a
  successful planner output for real deployment/test evidence.
- `node scripts/preview-change-plan.mjs --self-test` is run for FULL CI
  and checks supported paths, absent fixture evidence and protected renames.

This optimization is for avoiding operations that do not change running code
or fixtures, not for weakening acceptance of a runtime release.

## Optional PR checks selected by file domain

The following workflows are triggered by specific file paths rather than all PRs:
- Lockfile integrity, vulnerability scan, SBOM and license inventory: package manifests or the corresponding validators/policies/workflows
- Production migration preflight and schema baseline **static** self-tests: migrations, corresponding policy, implementation script and documentation
- SCS mapping: SCS mapping config/script/doc and auth/authorization code
- Security configuration: config/script/doc, Wrangler configuration and auth/authorization code

Dependency vulnerability scanning also runs **weekly** to catch advisory changes even when the dependency manifest is unchanged. These independent optional workflows continue supporting `workflow_dispatch` for manual checks. Only `validate` is enforced by the current main ruleset; if the required-check policy changes, revisit whether `paths` is appropriate (a required workflow skipped by path filters can remain pending).

## Operational decision rules

- A low-risk DOCS or UI-only change may pass the scoped PR gate; it does **not** mean the entire regression suite passed for that commit.
- A security fix, permission rule, SQL migration, audit, recovery, auth or shared code change must pass FULL and any matching domain checks.
- Run FULL explicitly when the PR risk cannot be determined or code-review concerns exceed the file-path heuristic. The fast FULL tier skips only specifically allowed expensive D1 suites, not the existing core/security/boundary checks.
- Release and Preview verification should target the affected feature and any boundary cases, not blindly rerun **every** mutable browser scenario. A failure requires triage; retrying without identifying its underlying cause is not proof of correctness.
- Track CI duration and fail rate by tier over real PRs; target fewer unnecessary job minutes and less flaky acceptance while retaining zero unreviewed high-risk skips.

## Verification and controls

1. `node scripts/ci-change-impact.mjs --self-test` exercises examples for safe docs, UI, mixed changes, fail-closed full paths, expensive-suite routing, and source-to-docs renames.
2. Open an isolated README-only PR to verify DOCS selection without triggering unrelated supply-chain jobs; open an admin UI-only PR to verify FRONTEND + E2E; modify a test/Worker file to verify FULL. A documentation change under `docs/operations/` must still choose the FULL **core** tier but may skip both isolated expensive D1 suites; this path is used as a real acceptance case for the fast FULL selector.
3. Verify the `validate` status check remains present on every PR, and main's strict required check still blocks failure.
4. Run `workflow_dispatch` FULL to establish a baseline after rollout. Scheduled full regression provides ongoing coverage.

**Not provided:** fine-grained test case selection for arbitrary Worker edits, static dependency graph analysis, a fully isolated ephemeral Preview authentication fixture, or a guarantee of zero test flakes. Those require separate measured engineering work.
