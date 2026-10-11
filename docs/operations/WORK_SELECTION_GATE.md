# Work Selection Gate — roadmap-first AI development

## Why

On 2026-10-11, a conversational "続けて" was wrongly interpreted as permission to start implementing recently filed PDF/attachment Issues #594/#595. PR #596 introduced a browser-print workaround instead of addressing the higher-priority Preview authentication failure #521. Post-hoc Issue/Notion notes did not prevent the mistake. This gate is a **work-admission control**, not another development checklist.

## Mandatory path when the user says "続けて"

1. **Read the sources before selecting work.** Fetch GitHub main HEAD, #132, relevant blocking/open Issues, current PRs/CI, and the Notion Roadmap when connected. Source of truth: main / GitHub Issue/PR/docs. Notion: decisions, status and cross-check. If unavailable, record that fact.
2. **Apply dependencies and the focus policy.** Use `config/work-selection-policy.json` **from main**. #521 (Preview auth 503) is the current focus. Filing a new Issue means backlog registration; it does not promote it. Existing tracked work may proceed only when eligible under the policy. If the focus is blocked by a Human Gate, explain the action and ask for permission; do not select a replacement feature without a roadmap decision.
3. **Select an Issue Change Contract** (Goal, In/Out, Planned Files, risks, validation, stop conditions). Tracking #132 is not the implementation Issue. If none is suitable, create a small Issue for the true focus work and ensure its eligibility is recorded *before coding*.
4. **Keep an auditable selection record in the PR**, including exact main baseline, #132, selected Issue, why now, higher-priority blockers, Notion evidence or explicit unavailability, Human Gate and acceptance outcome. Follow `.github/pull_request_template.md`.
5. **Validate before merge.** Existing required `validate` runs the fail-closed `scripts/work-selection-gate.mjs` on PR creation, code updates and edited PR descriptions. New human/AI PRs outside the base policy focus/approved exceptions fail, even if the PR body claims the priority was changed. Existing open PRs and verified Dependabot updates retain their existing route; this is not permission to silently merge them.
6. **Post-merge reconcile** #132, implementation Issue, Notion roadmap/testing and actual main SHA. Report CI verified separately from Preview or Production operation. Do not close an Issue because a partial workaround was merged.

## Gate design, protection and limits

- **Focus:** `#521`. **Approved exception:** `#597` only, because the user expressly requested the control itself. Current backlog #594/#595 does **not** enter the priority lane automatically.
- Gate reads the **base/main commit policy** using `git show <PR_BASE_SHA>:config/work-selection-policy.json`. Editing that policy inside a feature PR cannot grant its own exception.
- A policy/guard workflow change is accepted only for a governance Issue listed in **base** policy `governanceChangeIssues`. When the focus changes, record why in a separate, explicitly reviewed governance PR; do not make priority an AI-only silent choice. After #521 is resolved, promote the next dependent work from #132 using the same procedure.
- `notionCheck` is a truthful provenance declaration: the public GitHub runner cannot query private Notion and therefore **cannot prove** that the Notion page was read or interpreted correctly.
- Required `validate` can block a normal merge via GitHub ruleset; it cannot prevent a repository administrator from changing rulesets, directly pushing main if permitted, or falsely attesting to a source. Protecting those powers requires repository-side branch protection/required-check controls (and perhaps CODEOWNERS), which are **separate explicit Human Gate changes**. Never claim cryptographic or organizational enforcement when they are not configured.
- Historical PRs numbered below `enforceFromPrNumber` are excluded to avoid retroactive breakage; verified Dependabot bot-authored updates are excluded. Both cases must still follow existing review/security rules. The bootstrap PR establishing this policy is verified against its own policy by Issue #597.
- Review/CI **does not** authorize Preview/Production deploy, remote D1 migration, Cloudflare R2 changes, secrets or data destruction. When reaching such a boundary, present the specific action, impact and rollback risk and ask for approval.
- Do not add a separate required status check. The lightweight selection script runs **before** npm installation and costly DB/browser checks, with in-script offline self-tests.

## Decision and failure examples

| Case | Result |
|---|---|
| PR implementing #521 with complete evidence | PASS (subject to all other checks) |
| PR implementing #595 with only "PDF was just discussed" | FAIL: not an approved priority |
| PR implementing #595 that edits focus policy inside the same PR | FAIL: policy is read from the old main |
| PR implementing #597 governance mechanism, with complete evidence | PASS: approved exception |
| Any new PR with missing record, placeholder Issue, stale main baseline | FAIL |
| Existing pre-rollout PR / verified Dependabot dependency update | Work Selection Gate legacy/bot exemption; other checks still apply |
| Focus work blocked by Preview Human Gate | Stop **remote** action and request permission; do not substitute another feature |

## Continuous improvement

Keep #132 synchronized with the focus policy after any legitimate roadmap change. Treat mismatches as blockers, not invitations to choose whichever source is convenient. A future enhancement may verify GitHub Issue metadata/labels through read-only API, but do not move this low-cost local CI gate to network-dependent or privileged API operation without a measured benefit.
