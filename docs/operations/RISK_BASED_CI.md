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
| **FULL** | Auth, authorization, Worker, shared code, domain, data model, migrations, config, test harness, dependencies, CI workflows, unknown or mixed changes | All existing CI steps: local D1 migrate/schema, `validate:local`, lint/build, protected fixture, runtime/security boundary tests |

- `workflow_dispatch` and the Monday 03:30 JST weekly scheduled `Full-stack template CI` use FULL unconditionally.
- **Any** unknown or mixed path upgrades the whole PR to FULL. A missing/invalid commit SHA or failed `git diff` makes `validate` fail. Source and destination paths of renames are both checked. A `FULL` result cannot be downgraded because another file is docs-only.
- Workflow changes (including this policy) are always FULL.
- Existing `Secret detection` remains on **all** PRs, including DOCS.
- Browser E2E is still triggered on relevant source/config PRs, and now also runs weekly (Monday 04:00 JST). Preview Browser acceptance is separate and must be run after actual Preview deployment for relevant release changes.
- Production validation and deployment Human Gates are unchanged. CI never implies authorization to deploy Production.

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
- Run FULL explicitly when the PR risk cannot be determined or code-review concerns exceed the file-path heuristic.
- Release and Preview verification should target the affected feature and any boundary cases, not blindly rerun **every** mutable browser scenario. A failure requires triage; retrying without identifying its underlying cause is not proof of correctness.
- Track CI duration and fail rate by tier over real PRs; target fewer unnecessary job minutes and less flaky acceptance while retaining zero unreviewed high-risk skips.

## Verification and controls

1. `node scripts/ci-change-impact.mjs --self-test` exercises examples for safe docs, UI, mixed changes, and fail-closed full paths.
2. Open an isolated README-only PR to verify DOCS selection without triggering unrelated supply-chain jobs; open an admin UI-only PR to verify FRONTEND + E2E; modify a test/Worker file to verify FULL.
3. Verify the `validate` status check remains present on every PR, and main's strict required check still blocks failure.
4. Run `workflow_dispatch` FULL to establish a baseline after rollout. Scheduled full regression provides ongoing coverage.

**Not provided:** fine-grained test case selection for arbitrary Worker edits, static dependency graph analysis, a fully isolated ephemeral Preview authentication fixture, or a guarantee of zero test flakes. Those require separate measured engineering work.
