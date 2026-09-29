# Recovery / Remote Operation Scoped Instruction

## Applies When

Use this Instruction for Preview recovery rehearsal, Production restore decision, remote D1 mutation, Time Travel, rollback/restore coordination, or other Human-gated recovery work.

## Scope Hints

- recovery scripts/workflows
- remote D1 bookmark/restore commands
- Preview/Production resource configuration
- incident recovery runbooks
- schema/data verification after restore

## Sources to Read

- `../RECOVERY_OPERATIONS.md`
- `../DATA_DESIGN.md`
- `../FULLSTACK_ARCHITECTURE.md`
- applicable Common Template cloud infrastructure / security / testing Instructions

## Rules

- Treat remote recovery as shared-state mutation requiring an explicit Human Gate
- Keep Preview and Production resource identities distinct and fail closed on placeholders, missing IDs, or identical IDs
- Prefer Local/static validation in normal CI; real Preview rehearsal must be manually triggered
- Before Production restore, determine whether forward-fix or code rollback is sufficient; data restore is a separate decision
- Capture an undo/current bookmark before an approved Production restore when supported
- Choose restore target from evidence, not from guesswork
- After restore, verify migration/schema state, affected data invariants, health/database health, authentication, and critical protected flows
- Keep claims of “implemented” separate from “operationally verified on a real remote resource”

## Do Not

- Do not run Production restore from PR, push, schedule, or normal deploy automation
- Do not auto-restore Production after migration/deploy failure
- Do not contact remote D1 from ordinary PR CI for recovery testing
- Do not use Production as the rehearsal target
- Do not assume code rollback reverses successful schema/data mutation
- Do not publish Production exports/bookmarks/secrets or sensitive recovery data in public artifacts
- Do not continue when the target environment/resource identity is ambiguous

## Validation / Evidence

For Preview rehearsal, retain:
- repository commit / workflow run
- explicit Preview target identity and confirmation Production was not targeted
- bookmark capture and probe verification
- restore success and post-restore verification

For Production incident/restore, retain:
- incident scope and latest healthy deployment
- restore rationale and approved target
- pre-restore bookmark/undo point when applicable
- operator/approval evidence
- restore result
- schema/data/API smoke verification
- follow-up Issue for defect and reusable guardrails
