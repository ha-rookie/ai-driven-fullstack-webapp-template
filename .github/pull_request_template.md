## What is usable after this PR?
Describe the complete user-facing or operational outcome, not merely the files changed.

## Issue / validation / known limits
- Refs #<ISSUE_NUMBER> (incremental, Issue remains Open) OR Closes #<ISSUE_NUMBER> (only when the complete Issue acceptance gate is actually met)
- User-visible outcome:
- Relevant evidence:
- Unverified or remaining work:

## Work Selection Record

**Edit the JSON below with the current main SHA and actual checked sources before starting implementation.** Do not remove the marker or insert imaginary Notion evidence.

<!-- work-selection:v1
{
  "issue": 0,
  "roadmap": 132,
  "mainSha": "REPLACE_WITH_CURRENT_MAIN_SHA",
  "priorityBasis": "focus",
  "completion": "incremental",
  "whyNow": "Explain why the selected Issue is next under #132 and the current main policy.",
  "higherPriorityDisposition": "List the currently higher-priority Issues, and why this change is allowed before them.",
  "notionCheck": "checked",
  "notionReference": "https://app.notion.com/p/3eed7c109faf810c8e9af72915fdfe85",
  "humanGate": "none",
  "acceptanceOutcome": "State the acceptance criteria for the entire business feature or the actual planned vertical slice."
}
-->

Completion: `incremental` must have exactly one `Refs #<ISSUE_NUMBER>`, and must leave the incident Open; `final` requires exactly one `Closes #<ISSUE_NUMBER>` and evidence that the Issue acceptance criteria are fulfilled. Do not use `Closes` just to satisfy a CI gate. PriorityBasis: `focus` or `approved-exception` (main's `config/work-selection-policy.json` is authoritative). NotionCheck: `checked` or `not-accessible` (only claim `checked` after reading it). HumanGate: `none` or `remote-approval-required`. Code-only PRs can be merged without performing a remote action; record pending authorization explicitly. A not-accessible Notion check must include a GitHub roadmap reference in `notionReference`.

If the PR fails the selection gate, do not retitle the work or spoof its selection record: correct the prioritization through a **separate** governance change and explicit approval.
