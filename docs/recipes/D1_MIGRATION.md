# Recipe: D1 Migration

## Inputs
- schema change and business reason
- compatibility / rollback expectation
- affected tables, indexes, constraints and queries
- data preservation requirement
- whether Preview / Production migration is required

Read `../DATA_DESIGN.md` and `../instructions/database-migration.md` first.

## Stop Conditions
Stop before Remote/Production work when:
- migration can destroy or rewrite real data
- rollback requires data restoration rather than code rollback
- Preview / Production resource identity is not confirmed
- backup / recovery expectation is undecided
- the migration sequence is ambiguous

## Steps
1. Add a new numbered migration; never edit an already-applied migration to change history
2. Keep schema constraints aligned with runtime invariants
3. Update Local verification queries when schema verification coverage changes
4. Update affected repositories / handlers / tests in the same change contract
5. Run Local migration from a clean Local state and from the current migration baseline
6. Run migration preflight logic before any Production migration workflow
7. Treat Preview rehearsal and Production migration as separate evidence levels

## Validation
```bash
npm run db:migrate:local
npm run db:verify:local
npm run validate:local
```

When applicable, use the existing migration workflow self-tests and Preview-only manual workflow.

## Evidence
Record:
- migration filename and intent
- Local migration / schema verification result
- affected compatibility assumptions
- Preview evidence if explicitly run
- Production evidence only after the Production Human Gate and exact-SHA verification

## Do Not
- reset or reseed real data to make a migration pass
- run `--remote` implicitly from normal PR CI
- treat Local success as Production migration success
- hide destructive SQL inside a general refactor
- infer backup safety when no backup/recovery decision exists
