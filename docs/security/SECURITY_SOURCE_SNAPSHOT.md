# Security Source Snapshot Adapter — #727 (Stage8 #420 prerequisite)

## Scope and purpose

The closed #724 SecurityFinding contract describes safe Findings and coverage; it does **not** fetch them. This slice supplies a **pure read-only projection of trusted, structured CI check observations** to #724's `SecuritySourceCoverage`. It permits a later #420 Admin Security Center to distinguish an actually verified zero finding count from a successful CI job, an unexecuted check, an unavailable source, and stale evidence. No scanner, GitHub API, Provider SDK, persistent store, Worker route, Admin UI, migration, or Production check is created.

Use `src/shared/security/security-source-snapshot.ts` with `normalizeSecuritySourceSnapshot(observation, expectedSha, asOf)` from a caller that **independently authenticates and authorizes** its trusted structured inputs. This pure parser cannot verify that a CI job, run ID, approval, or independent finding evidence actually exists. No source-specific GitHub URLs, private logs, credentials, or arbitrary paths are accepted. Only a positive numeric run ID and controlled opaque evidence reference can be carried to a future resolver that separately checks authorization.

## Existing source inventory (bounded, not a full #410 Stage0 audit)

| Existing repository asset | Trigger / nature | Safe observation / important limit |
| --- | --- | --- |
| `.github/workflows/secret-detection.yml` (`scan-secrets`) | PR / manual | A successful job proves the configured candidate scanner ran for a particular commit; **not** that every secret was found or that the finding count is zero |
| `.github/workflows/dependency-vulnerability.yml` (`audit-dependencies`) | Weekly, manual and dependency-related PR paths | npm audit checks use separate thresholds; a given PR can have **no run**. Successful job is not a complete environment/Production vulnerability audit |
| `.github/workflows/security-configuration.yml` (`validate-security-configuration`) | Relevant configuration paths / manual | Validator self-test and uploaded policy are not a live Production configuration audit |
| `.github/workflows/scs-mapping.yml` (`validate-scs-mapping`) | Relevant paths / manual | Structural mapping validation is not organizational SCS conformity or ★3/★4 certification |

These are **possible** source observations, not live configured or connected providers. This work does not execute or retrieve them. The full #410 Control-to-Check matrix, #488 official-evidence freshness assessment, live provider authorization, and incident monitoring remain separate uncompleted work.

## Strict data boundary and source semantics

The source adapter must pass an explicit, plain-object DTO: `sourceId`, allowlisted `sourceKind`, `checkId`, exact lowercase 40-hex `targetSha`, canonical UTC `observedAt`, `checkStatus`, optional `checkConclusion` for completed jobs, and optional positive numeric `runId`. For non-completed jobs, a conclusion is invalid. A GitHub-style `completed/success` input **alone** yields `coverageState: not-checked`, `checkedFindingCount: null`, and `freshness: unknown` even though `checkConclusion: success` remains visible on a different axis. A skipped or missing run is likewise `not-checked`; failed/cancelled/timed-out/unavailable means `coverageState: unavailable`. The source status is **not** Finding severity, compliance status, or a green security state.

An independent, previously authenticated and validated *structured finding result* can be supplied as `verifiedFindings`, with allowlisted `evidenceRefId`, `verifiedAt`, `evidenceValidUntil`, and a nonnegative `checkedFindingCount` tied to a completed successful run. The result must apply to the **same expected SHA and source** by the trusted caller's evidence verification; the DTO parser checks required chronology and ties the projection to the caller-provided SHA. This is **not an attestation issued by this code**. Only this separate input allows `checked` and an actual numerical count (possibly zero). If `evidenceValidUntil` precedes `asOf`, the resulting `coverage.freshness` is `stale`, never assumed current. `checkedFindingCount: 0` means zero **only in the verified result's bounded source/scope**, not system-wide security.

The parser rejects unknown keys, raw output text or objects, array evidence, accessors, arbitrary URLs, malformed timestamps, wrong SHAs, unbounded/secret-like identifiers, negative counts, inconsistent check states, and unsupported source kind/status/conclusion. No automatic sanitizing of sensitive payloads after acceptance: input is rejected before output.

## Downstream handoff, SCS and test evidence

`SecuritySourceSnapshot.checkStatus/checkConclusion` describe **CI execution**. `SecuritySourceSnapshot.coverage` is a distinct #724 **finding observability** record. There is no SCS requirement status or security grade and no claim of finding severity. #420 must add an independently authorized, authenticated, scope-limited server-side source resolver and safe evidence lookup before displaying real per-user data. A successful CI check cannot bypass that boundary.

#488 requirement responsibility (`Template/Project/Organization`), SCS evidence freshness and official criteria must be handled separately; a green CI signal never auto-promotes the SCS mapping to `Implemented`. #430 failure-safety applies on later runtime/UI work. Formal System Test #694 remains **Not Run**.

Focused `tests/security-source-snapshot.test.ts` use **only synthetic** secret/dependency check records and exercise wrong SHA, unknown statuses, incomplete/failed/skipped runs, unsafe fields, future/stale evidence, verified zero and no false security claim. Tests are run by the existing TypeScript unit-test CI; no workflow or remote resource change is required.
