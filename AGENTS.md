# Work selection contract for AI coding agents

This file applies to ChatGPT, Codex, Claude and all other agents contributing to this repository.

**The instruction "続けて" (continue) means continue the approved GitHub/Notion Roadmap, NOT implement the most recently mentioned feature.** A request to file an Issue does not authorize an implementation priority change.

Before choosing work, read the current GitHub main SHA, the open [Implementation Roadmap #132](https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/issues/132), the relevant open Issue / dependencies, and the current Notion roadmap when connected. GitHub main / Issues / PRs / docs are authoritative; Notion is an operational summary and cross-check. If Notion cannot be accessed, do not pretend to have read it; cross-check the public GitHub roadmap and explicitly record the limitation.

Then inspect `config/work-selection-policy.json`. Its **focus issue(s)** win over newly mentioned backlog requests, unless a previously approved exception is listed in the policy **on main**. Do not change this file in the same implementation PR to authorize your own exception. If the desired Issue is not eligible, **do not create implementation code or a PR**. Reconcile the roadmap first; any explicit user reprioritization requires a recorded policy transition, not conversational inference.

Write a Work Selection Record in every new human/AI PR (see `.github/pull_request_template.md`). The existing required `validate` check enforces the record and checks the target Issue against the **base-commit** focus policy. It cannot independently verify private Notion or semantic truth: agents must inspect actual sources, not fill the form dishonestly.

Human Gate: never deploy Preview/Production, mutate remote D1, create/change Cloudflare resources, add secrets, or perform destructive operations without explicit user approval. Do not quietly substitute a lesser feature to avoid a Human Gate. Explain the requested action and ask for that approval. Code/CI PRs alone are not remote deployment.

Follow `CONTRIBUTING.md` and `docs/operations/WORK_SELECTION_GATE.md`; use one Issue Change Contract, small reviewed changes, risk-based CI, and honest completion evidence. Policy or CI guardrail changes are governance-sensitive and require their own Issue.
