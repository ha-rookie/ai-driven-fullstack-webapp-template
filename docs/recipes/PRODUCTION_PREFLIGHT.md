# Recipe: Production Preflight

## Inputs
- exact release commit SHA
- Production environment/resource mapping
- migration requirement and sequence
- rollback / stable marker decision
- Production smoke verification criteria
- release owner and Human approval point

Read the applicable operation sources first:
- `../operations/PRODUCTION_MIGRATION_PREFLIGHT.md`
- `../operations/PRODUCTION_MIGRATION_WORKFLOW.md`
- `../operations/PRODUCTION_DEPLOY_WORKFLOW.md`
- `../operations/PRODUCTION_SCHEMA_VERIFICATION.md`
- `../operations/PRODUCTION_SMOKE_VERIFICATION.md`
- `../operations/CODE_ROLLBACK_STABLE_MARKER.md`
- `../operations/RELEASE_EVIDENCE_BUNDLE.md`

## Stop Conditions
Stop before Production when:
- release SHA is not fixed
- Production resource/origin identity is ambiguous
- Preview and Production are not proven separate
- migration preflight fails or destructive impact is not understood
- rollback/stable marker is missing for a release that needs it
- smoke verification criteria are not defined
- Human approval has not been given

## Steps
1. Freeze the exact candidate SHA and confirm required CI for that SHA
2. Run migration preflight even when the expected change appears small
3. Confirm whether a Production migration is required
4. Confirm Production deploy policy and resource mapping
5. Confirm rollback target / stable marker before mutation begins
6. Execute Production migration/deploy only through explicit Human-gated workflow
7. Run Production schema verification and smoke verification for the same release SHA
8. Generate/collect Release Evidence Bundle
9. Only then allow Runtime Evidence Status to describe Production as verified

## Validation
Local/self-test entrypoints prove workflow safety contracts only:

```bash
npm run db:migration:workflow -- --self-test
npm run deploy:production:validate -- --self-test
npm run smoke:production -- --self-test
npm run rollback:production:validate -- --self-test
npm run release-evidence:validate
```

These do not perform a Production release.

## Evidence
Record:
- exact candidate/released SHA
- Human approval / workflow run identity
- migration preflight result
- schema verification result
- smoke verification result
- rollback/stable marker
- Release Evidence Bundle

## Do Not
- deploy a different SHA from the reviewed/approved SHA
- run Production mutation from ordinary PR CI
- skip preflight because a migration is believed to be harmless
- treat successful deploy command as successful release verification
- report Production verified without exact-SHA evidence
- clean/reset/reseed Production data as a release workaround
