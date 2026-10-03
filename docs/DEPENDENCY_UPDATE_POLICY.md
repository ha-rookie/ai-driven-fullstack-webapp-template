# Dependency Update Policy

## Purpose

Dependency updates must not be abandoned, but an automated update proposal is not a merge decision.

Template baseline separates the flow into:

```text
Dependabot proposal
      ↓
CI / supply-chain validation
      ↓
Human review
      ↓
merge / defer / reject with reason
```

There is intentionally **no dependency auto-merge workflow** in the baseline.

## Update sources

`.github/dependabot.yml` enables proposal PRs for:

- npm dependencies
- GitHub Actions

The included weekly cadence is a starter value, not an organizational rule. Projects may choose daily, weekly or monthly maintenance after documenting their release/support needs.

## Patch / minor / major

### Patch

Usually the smallest compatibility risk, but still requires normal CI and review. A patch number does not prove behavior is unchanged.

### Minor

Review release notes for new defaults, deprecations, runtime requirements and build-tool behavior. Run the same required CI/supply-chain checks as any other change.

### Major

Treat as an explicit migration/change. Review breaking changes, migration guidance, runtime/platform support and rollback implications. Template baseline never auto-merges major updates.

## Security updates

Security advisories are triaged separately from normal version-update cadence.

When a supported dependency has a relevant advisory:

1. determine exploitability and affected runtime/build surface
2. prefer the smallest safe remediation that removes the vulnerable range
3. run required CI, vulnerability, license and lockfile checks
4. record any temporary defer/ignore decision with rationale, owner/reviewer and re-evaluation condition
5. do not lower unrelated safety checks only to make the update mergeable

Repository-level Dependabot security updates/alerts are GitHub settings and may require explicit Project/organization enablement. The version-update schedule in `dependabot.yml` must not be mistaken for proof that security updates are enabled.

## Required validation for update PRs

Dependency PRs are ordinary pull requests and must pass the repository's existing required checks, including as applicable:

- Full-stack template CI
- lockfile integrity
- dependency vulnerability scan
- secret detection
- SBOM generation
- license inventory/policy
- security configuration / SCS mapping
- schema/migration safety checks
- Browser E2E when changed paths trigger it

Do not bypass failed checks just because the author is an automation account.

## Grouped updates

Baseline does **not** group dependencies automatically.

Grouping may be added by a Project when all of the following are true:

- packages have one coherent responsibility or release train
- combined failure/rollback is easier to reason about than independent updates
- CI can identify regressions with enough precision
- major updates are not hidden inside a broad group
- security remediation urgency is not delayed by waiting for unrelated updates

## Merge responsibility

Dependabot may create or refresh a PR. It does not own acceptance.

Human review remains responsible for:

- checking release notes / migration notes when material
- assessing runtime/build compatibility
- interpreting vulnerability/license findings
- deciding whether the change belongs in the current release window
- confirming the PR has converged before merge

Projects may add carefully scoped auto-merge later, but it is not a Template baseline requirement.

## Stale, deferred and ignored updates

Do not silently leave an important update indefinitely.

For a defer/ignore decision, record enough context to revisit it:

- dependency and affected version/range
- reason for defer/ignore
- known risk or compatibility blocker
- owner/reviewer
- review trigger or target date/release
- related advisory/issue/PR when applicable

Avoid permanent wildcard ignores without a written compatibility/security rationale.

## Project adoption checklist

Before adopting this policy, decide:

- update cadence
- supported Node/runtime/browser matrix
- security advisory response expectations
- whether any dependency groups are justified
- who reviews dependency PRs
- release/rollback expectations for major updates
- whether repository Dependabot security alerts/updates are enabled
