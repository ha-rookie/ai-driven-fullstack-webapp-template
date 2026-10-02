# SCS Control Mapping

## Purpose and non-claim

This document maps the Japanese SCS evaluation scheme requirements to technical controls that this Full-stack Template can support, and separates them from Project and Organization responsibilities.

**This mapping is not an SCS conformity claim, certification, registration, or evidence that a project can obtain ★3 or ★4.** The official evaluation is performed against the complete official requirements and criteria, including organization processes, records, implementation scope, and the applicable evaluation scheme.

## Official source baseline

Verified on: **2026-10-02**

Primary sources:

- IPA requirements / criteria page: https://www.ipa.go.jp/security/scs/requirements-criteria.html
- IPA ★3 / ★4 requirements and criteria Excel: https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/20260327001-c.xlsx
- METI scheme construction policy: https://www.meti.go.jp/shingikai/mono_info_service/sangyo_cyber/wg_seido/wg_supply_chain/20260327_report.html
- IPA SCS portal: https://www.ipa.go.jp/security/scs/index.html
- IPA scheme regulations / committees: https://www.ipa.go.jp/security/scs/regulation-advisory-committeess.html

At this baseline, the official requirement set contains **26 requirements for ★3** and **43 requirements for ★4**. ★4 includes the ★3 requirements and adds 17 requirement-level items, while some shared requirements also have additional ★4 evaluation criteria.

The IPA requirements page still identifies the requirements/criteria file published on 2026-04-21 as the current requirements source. Scheme regulations and operational information have continued to be published during 2026. The mapping must therefore be rechecked when IPA updates the requirements/criteria, explanatory guide, acquisition guide, or scheme rules.

## Status vocabulary

Only these values are allowed:

- `Implemented`
- `Partially Implemented`
- `Project Responsibility`
- `Organization Responsibility`
- `Not Applicable`
- `Not Yet Implemented`

`Implemented` means only that the Template contains a reusable technical control and test/evidence for the stated Template portion. It does **not** mean the full SCS requirement is automatically satisfied in a product organization.

## Responsibility boundary

- **Template Responsibility**: reusable code, guard, script, test, CI control, or technical evidence can be provided by this repository
- **Project Responsibility**: configuration, infrastructure, data classification, runtime operation, service selection, or product-specific policy must be decided by each project
- **Organization Responsibility**: management system, contracts, employee rules, education, supplier governance, physical security, or executive oversight cannot be implemented by an application template

## Requirement mapping

The machine-readable source of truth is `config/scs-control-mapping.json`. The table below is the review view. Control/Test/Evidence details for every Template-supported row are also retained in that JSON and checked by CI.

| Requirement | Level | Responsibility / status | Template mapping summary |
| --- | --- | --- | --- |
| 1-1-1 | ★4 only | Organization Responsibility | Legal/contract requirements and internal rules are organization governance |
| 1-2-1 | ★3/★4 | Organization Responsibility | Assignment of security roles and executive authority is organization governance |
| 1-2-2 | ★4 only | Organization Responsibility | SOC/monitoring-analysis organization and operating model are outside Template scope |
| 1-2-3 | ★3/★4 | Organization Responsibility | Confidentiality obligations and employment/contract rules are organization controls |
| 1-3-1 | ★3/★4 | Organization Responsibility | Enterprise security policy and communication are organization controls |
| 1-4-1 | ★4 only | Organization Responsibility | Security improvement plan and executive reporting/approval are organization controls |
| 2-1-1 | ★3/★4 | Organization Responsibility | Supplier/business/system relationship inventory is maintained by the organization/project |
| 2-1-2 | ★3/★4 | Organization Responsibility | Supplier confidential-information handling is contractual/organizational |
| 2-1-3 | ★4 only | Organization Responsibility | Periodic supplier security assessment is organization governance |
| 2-1-4 | ★3/★4 | Organization Responsibility | Cross-company incident responsibilities and escalation are contractual/organizational |
| 2-1-5 | ★4 only | Organization Responsibility | Return/destruction of information and access at contract end is organizational/project procedure |
| 3-1-1 | ★3/★4 | Partially Implemented | Lockfile + SBOM provide software dependency/version inventory; full hardware/OS inventory remains Project responsibility |
| 3-1-2 | ★3/★4 | Project Responsibility | Network inventory/topology depends on deployed Cloudflare/network architecture |
| 3-1-3 | ★3/★4 | Project Responsibility | SaaS/external-service register must be maintained by each Project |
| 3-1-4 | ★3/★4 | Project Responsibility | Information classification and handling rules are Project/Organization policy |
| 3-1-5 | ★4 only | Organization Responsibility | Remote-work/BYOD rules are organization controls |
| 3-2-1 | ★4 only | Partially Implemented | Vulnerability scan + SBOM support software vulnerability management; ownership, triage and remediation process remain Project/Organization responsibilities |
| 4-1-1 | ★3/★4 | Implemented | Application-user lifecycle and Administration API boundary are reusable Template controls |
| 4-1-2 | ★3/★4 | Partially Implemented | Privileged membership safety and Administration API protect application admin changes; broader privileged identity governance remains external |
| 4-1-3 | ★3/★4 | Partially Implemented | Authentication and authorization are separated; provider/MFA/step-up requirements remain Project/provider dependent |
| 4-1-4 | ★3/★4 | Not Yet Implemented | Local credential attack/lockout control is a separate implementation unit |
| 4-1-5 | ★3/★4 | Project Responsibility | Password construction policy is authentication-provider/organization dependent |
| 4-1-6 | ★3/★4 | Project Responsibility | Password handling policy is authentication-provider/organization dependent |
| 4-1-7 | ★3/★4 | Implemented | Scoped authorization, membership roles and privileged membership safety provide application access-control primitives |
| 4-1-8 | ★4 only | Organization Responsibility | Physical server-area access is outside application-template scope |
| 4-1-9 | ★4 only | Organization Responsibility | Removable-media governance is outside application-template scope |
| 4-2-1 | ★4 only | Organization Responsibility | Organization-wide security awareness/training is outside Template scope |
| 4-2-2 | ★3/★4 | Organization Responsibility | Incident response exercises/training are organization controls |
| 4-3-1 | ★4 only | Project Responsibility | At-rest encryption depends on platform/data classification and Project configuration |
| 4-3-2 | ★4 only | Project Responsibility | Data storage locations/retention are Project/Organization decisions |
| 4-3-3 | ★4 only | Organization Responsibility | Supplier information-sharing rules are organizational/contractual controls |
| 4-3-4 | ★3/★4 | Partially Implemented | D1 recovery rehearsal and safety validation support technical restoration; backup policy/RTO/RPO remain Project/Organization responsibilities |
| 4-4-1 | ★3/★4 | Partially Implemented | Security headers, origin/CORS, CSRF and runtime-integrity controls provide secure application defaults; host/platform baselines remain Project responsibility |
| 4-4-2 | ★4 only | Partially Implemented | SBOM/license inventory expose dependency versions; OS and all-software end-of-support governance remains Project/Organization responsibility |
| 4-4-3 | ★4 only | Partially Implemented | Structured application logging, Audit and Correlation exist; retention and SIEM review procedures remain Project responsibility |
| 4-4-4 | ★3/★4 | Partially Implemented | Lockfile integrity and dependency vulnerability CI support patch/update decisions; remediation SLA and deployment procedure remain Project responsibility |
| 4-4-5 | ★3/★4 | Organization Responsibility | Endpoint/host malware protection belongs to runtime/organization controls |
| 4-5-1 | ★3/★4 | Project Responsibility | Network segmentation, WAF/firewall boundary and topology are deployment-specific |
| 5-1-1 | ★3/★4 | Project Responsibility | Network/data-transfer monitoring depends on Cloudflare/SIEM/runtime operations |
| 5-1-2 | ★4 only | Organization Responsibility | Endpoint/software behaviour monitoring such as EDR is runtime/organization control |
| 5-2-1 | ★4 only | Partially Implemented | Technical triage priority/confidence/scope and scenario decision aids exist; actual severity policy, deployment/telemetry evidence and organizational response remain Project/Organization responsibilities |
| 6-1-1 | ★3/★4 | Partially Implemented | Incident runbook connects Audit, session revoke, operation mode and recovery with Local contracts; staffed response, approved remote actions, private evidence retention and recorded exercises remain Project/Organization responsibilities |
| 7-1-1 | ★3/★4 | Partially Implemented | Recovery rehearsal/validation supports technical recovery; business continuity and target recovery objectives remain Project/Organization responsibilities |

## Template evidence currently mapped

Key repository-native evidence sources include:

- Full-stack template CI
- Lockfile integrity
- Dependency vulnerability scan
- Secret detection
- SBOM generation
- License inventory
- local D1 recovery rehearsal / safety validation
- authorization / administration / runtime-integrity tests
- Audit and Correlation tests
- [Security Incident Response](SECURITY_INCIDENT_RESPONSE.md) and its existing Local/tabletop evidence matrix (document existence does not prove an organizational exercise occurred)

A green workflow is evidence that the Template control executed successfully for that commit. It is not evidence that organization-owned procedures were performed.

## ★4 evaluation-criteria uplift

Requirement-level mapping alone is insufficient for ★4. The official ★4 set also adds evaluation criteria to requirements that already exist at ★3. Examples include stronger access review/MFA expectations, additional asset/network inventory controls, enhanced secure-configuration checks, vulnerability remediation evidence, network segmentation, and restoration verification.

Therefore, a Project targeting ★4 must assess the **complete official ★4 evaluation criteria**, not only the 17 ★4-only requirement IDs listed here.

## Update rule

Whenever IPA/METI changes the SCS requirements, criteria, acquisition guide, or scheme rules:

1. record the new official publication/update date and source URL
2. diff requirement IDs and ★3/★4 applicability against `config/scs-control-mapping.json`
3. add/remove/change rows explicitly; never infer a renamed or deleted requirement as satisfied
4. reassess every `Implemented` and `Partially Implemented` mapping against the changed evaluation criteria
5. update Control/Test/Evidence references if repository controls moved
6. run `npm run security:scs-mapping`
7. keep the CI artifact as mapping evidence for the reviewed commit

The validator deliberately pins the current 26/43/17 requirement counts and IDs. An official revision that changes the set should first break validation, forcing a reviewed mapping update instead of silently accepting drift.
