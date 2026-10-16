# Security Finding Contract — #724 (Stage8 prerequisite)

## Goal and boundary

This is the first, **pure local contract** slice from tracking #410 for the existing #132 Stage8 #420 Security / Self-Audit Center. It is not a scanner, finding database, HTTP API, runtime audit scheduler, admin UI or proof that the system is secure. #420's original acceptance and #410's remaining stages remain open. Reuse the existing CI security tools and their evidence; do not reconstruct CodeQL, Dependabot, SAST, CVE services or the organization's risk-acceptance process.

The shared source is `src/shared/security/security-finding.ts`. Test evidence is `tests/security-finding-contract.test.ts`. This model is separate from durable **Audit Events** (#44) and operational Finding/ActionRequired in #429. No D1 migrations, remote resources or Provider credentials are required.

## Existing source inventory (bounded to this slice)

| Existing mechanism | What it proves | What it does not prove |
| --- | --- | --- |
| GitHub required `validate` / dependency checks | A specific PR HEAD passed selected local tests | Production security configuration or every vulnerable dependency is absent |
| Secret detection workflow | A specific head was scanned with the currently configured rules | Every secret or sensitive string has been found |
| `config/scs-control-mapping.json` / `docs/security/SCS_MAPPING.md` | Reviewed mapping for Template controls, tests and evidence | Organization/project conformity or SCS ★3/★4 certification |

The #410 Stage0 inventory and full Control-to-Check coverage matrix are **not** complete. Future CI/Runtime adapters must provide explicit source provenance and a bounded, normalized record. Scanner results stay within their own trusted adapter boundary. No provider SDK or raw report is part of this Core.

## Provider-neutral Finding

`normalizeSecurityFinding(raw, sourceId, assessedAt)` accepts a strict, allowlisted DTO, not a raw scanner object. `normalizeSecurityFindingFromSource({sourceId, map}, raw, assessedAt)` gives a vendor-neutral adapter boundary. Both are pure; adapters must map external formats to the same safe DTO before normalization.

- Identity: `ruleId`, optional *opaque* `resourceRef`, `sourceId` (supplied by the adapter)
- Risk: `severity` (`critical | high | medium | low | info`), `category`, `status` (`open | resolved | accepted-risk | false-positive`)
- Timeline: `detectedAt` and `lastObservedAt` UTC ISO timestamps, source provenance and `assessedAt`
- Evidence: bounded array of **predeclared classification codes** and optional opaque evidence references, not free-form summaries, URLs or Provider payloads
- Action: optional controlled `remediationCode`
- Exception: only for `accepted-risk`, controlled `reasonCode`, opaque `approvalRef`, `expiresAt`. `riskDisposition` is `accepted-current` only while the exception is unexpired; otherwise `accepted-expired`. The historical status remains unchanged, but consumers MUST NOT treat expired exceptions as approved

Only explicit fields are emitted. Unknown keys (including `token`, `payload`, `headers`, `message`, `rawResponse`), invalid enum codes, malformed timestamps, oversize/multi-line/untrusted identifiers and unbounded evidence are rejected rather than redacted after storage. Predeclared codes are safe UI lookup keys, **not text copied from a scanner**. Arbitrary identifiers can still hide secrets; adapters must never construct these identifiers from raw credentials, PII or payloads. This bounded contract is not a substitute for secret scanning or classification.

## Source coverage, unavailability and freshness

`normalizeSecuritySourceCoverage` deliberately keeps **source observability** separate from Finding risk severity.

| coverageState | sourceHealth | count | freshness |
| --- | --- | --- | --- |
| `checked` | `ready` or `degraded` | Nonnegative checkedFindingCount (including zero) | `current` only with an unexpired `evidenceValidUntil`; otherwise `stale` or `unknown` |
| `not-checked` | `unmonitored` | `null` | `unknown` |
| `unavailable` | `unavailable` | `null` | `unknown`, even if older successful evidence exists |
| `not-applicable` | `unmonitored` | `null`, explicit reason code | `unknown` |

`checkedFindingCount: 0` means only **zero findings reported by that particular successful check**, NOT `secure` or SCS-conformant. Unknown/stale/unavailable cannot be rolled up to Green. Coverage status, `lastSuccessfulCheckAt`, freshness, Finding severity, and SCS Requirement status must remain separate axes. No numeric safety score exists here.

## Trust and acceptance

- Runtime validation fails closed for unexpected DTO keys, unknown enum states, non-canonical timestamps, inconsistent chronology/coverage, unsafely free-form evidence and expired risk approvals
- Unit tests cover two synthetic adapter formats, declared evidence, invalid data, secrets in raw fields, verified zero versus not checked/unavailable/stale, and exception expiry
- No actual Provider connection, GitHub ingestion, persistent store, authorization/HTTP boundary, UI, remote D1 or Production test is claimed by this PR
- The next implementation may use this contract only after separate exact-HEAD merge approval. #430 negative-path discipline applies; #694 formal System Test is distinct and Not Run
