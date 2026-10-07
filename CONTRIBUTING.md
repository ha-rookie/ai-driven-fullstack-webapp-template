# Contributing

This repository provides React / Workers / D1 implementation patterns for business web applications. Development governance remains in the reviewed Common Template referenced by [Upstream Template](docs/UPSTREAM_TEMPLATE.md); do not duplicate its design documents here.

## Change workflow

1. Use one Issue as the Change Contract: Goal, In Scope, Out of Scope, Planned Files, Risk Level, Impact Flags, Validation and Stop Conditions.
2. Read [the implementation design index](docs/README.md) and the applicable [scoped instructions](docs/instructions/README.md), together with the reviewed Common Template guardrails.
3. Create one Issue-specific branch from current `main`; do not modify `main` directly.
4. Update the responsible design source before changing behavior. Keep changes within Planned Files. If another file is necessary, stop and resolve the scope change before editing it; avoid unrelated cleanup. Prefer the smallest change that satisfies the Change Contract; preserve existing credentials, permissions, environment bindings, triggers, and other operational configuration unless changing them is explicitly required by the Goal and validated separately.
5. Open one Pull Request closing exactly one Issue (`Closes #<number>`). Explain behavior, changed design, evidence, unresolved items and recovery considerations.
6. Verify changed paths against the Issue's Planned Files and confirm the `validate` CI job. This repository currently has no automated Planned Files Scope Guard; do not claim that it ran.
7. Reconcile Issue, design, implementation and validation evidence for Development Convergence. Stop at the Human Merge Gate until a maintainer explicitly approves the reviewed head SHA.
8. If the initially assumed tool or execution path is unavailable, do not equate that with the Goal being impossible. Before requesting manual maintainer action, check same-service triggers/APIs, existing workflows/scripts, and a small safe configuration change that can achieve the same Goal. Manual operation is the last resort, subject to the same Human Gates.

The default is **1 Issue = 1 Branch = 1 PR**. Tracking Issues organize child work and are not implementation contracts.

## Source editing safety

AI-assisted and scripted edits must treat escape-sensitive source changes as structural edits, not blind text substitution.

- Do not use broad source-code `replace()` / global replacement to translate `\\n`, `\\r`, `\\t`, quotes, regex escapes, or similar syntax-sensitive tokens between escaped and physical characters.
- Prefer a clean whole-file rewrite for generated scripts and workflows. For narrow changes, use line-aware or syntax-aware edits.
- Immediately after an automated edit, re-read the changed file and run the applicable parser/syntax check before opening a PR.
- Run `npm run source-editing:validate` before the wider validation suite. CI is the final safety net, not the first syntax check.
- Never repair escape corruption with a repository-wide inverse replacement. Restore the intended construct explicitly and validate legitimate escaped string/regex cases remain intact.

Required sequence:

```text
edit -> syntax/structural validation -> re-read/diff inspection -> PR -> CI
```

The source-editing validator intentionally detects only known high-confidence corruption patterns in addition to parser checks; legitimate string and regular-expression escapes must remain valid.

## Local validation

Follow [Local development](README.md#local-development) for installation and local migrations. Then run:

```bash
node scripts/validate-public-readiness.mjs
npm run validate:local
npm run lint
npm run build
```

The CI `validate` job also checks local schema and protected HTTP boundaries. CI success is not Production verification. Record checks that did not run as unverified, with their reason.

## Environment and security boundaries

- Use local D1 for ordinary validation. Do not consume remote quota to prove local behavior.
- Preview and Production resources must remain separate. Remote workflows and Production changes require their documented Human Gates.
- Do not commit credentials, secrets, private data or environment-specific resource identifiers.
- Neutral example resources and roles demonstrate foundations; product vocabulary, identity providers and operational thresholds belong to derived projects.
- Follow [Security Policy](SECURITY.md) for vulnerabilities; do not disclose exploit details in public Issues or PRs.

Public repository evidence is sufficient to contribute; private Notion, Drive or Box access is not required. This repository is under the [MIT License](LICENSE). Identify third-party provenance and compatible licensing when adding material.

## Change history

Use reviewed PRs, Git history and GitHub Releases as change evidence. This contribution baseline does not introduce a separate CHANGELOG or promise that generated projects automatically inherit later changes.
