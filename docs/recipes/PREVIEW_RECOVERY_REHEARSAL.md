# Recipe: Preview Recovery Rehearsal

## Inputs
- confirmed Preview D1 resource
- separately confirmed Production D1 resource
- recovery point / Time Travel expectation
- rehearsal dataset and verification query
- stop/abort condition

Read `../RECOVERY_OPERATIONS.md` and `../instructions/recovery-remote-operation.md` first.

## Stop Conditions
Stop immediately when:
- Preview resource identity is not confirmed
- Preview and Production cannot be proven different
- Production resource is selected as the target
- recovery point is ambiguous
- expected verification query/result is undefined
- the rehearsal would delete or overwrite Production data

## Steps
1. Validate recovery configuration without mutating Remote resources
2. Confirm Preview / Production resource separation
3. Record the intended recovery point and verification criteria
4. Run the Preview-only manual rehearsal through the provided workflow/script
5. Verify the recovered Preview state with bounded read-only checks
6. Capture Workflow logs/artifacts and exact commit SHA
7. Record lessons that change the recovery Runbook

## Validation
```bash
npm run recovery:validate
```

Remote rehearsal remains Human-triggered. Local validation only proves the safety checks and script contract, not actual Remote recoverability.

## Evidence
Record:
- exact SHA
- Preview resource identifier (non-secret)
- recovery point used
- verification checks
- Workflow result
- any deviation from expected RPO/RTO

## Do Not
- automate Production restore from ordinary PR CI
- reuse Production resource as a convenient rehearsal target
- infer Remote recovery success from Local self-tests
- hide failed verification because the restore command itself succeeded
- reset/reseed real data as a recovery shortcut
