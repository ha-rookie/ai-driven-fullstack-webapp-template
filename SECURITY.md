# Security Policy

## Scope and supported versions

This policy covers this template's runtime foundations, scripts, workflows and documentation. A derived application's credentials, provider configuration and product rules belong to that project's security process unless the root cause is in this template.

| Revision | Security maintenance policy |
| --- | --- |
| Current `main` | Fixes are developed against the current baseline |
| Tagged releases, including `v0.1.0` | Published snapshots; no separate backport or support-duration commitment |
| Historical commits and derived projects | No automatic security updates; review and adopt relevant fixes explicitly |

Release existence does not establish a long-term support branch or guarantee a response deadline.

## Reporting a vulnerability

Do not publish secrets, exploit steps, proof-of-concept payloads or abuse-enabling details in a public Issue, PR, Discussion or comment.

1. Open this repository's **Security** tab.
2. If **Report a vulnerability** is available, use Private Vulnerability Reporting. This document does not claim that repository setting is enabled.
3. If no private reporting route is available, open only a minimal public request for a private security contact channel. Include no technical vulnerability details or sensitive data; wait for a private channel before sharing them.

A private report should identify the affected revision and file or behavior, impact, reproduction conditions, template versus derived-project scope and any mitigation. Include only necessary information, and redact credentials and unrelated personal data.

## Handling and disclosure

Assess reports against the actual affected code and revision. A documentation update or passing CI alone does not prove a vulnerability is fixed; verify the relevant behavior. Keep sensitive details private until disclosure is safe.

Repository changes follow [Contributing](CONTRIBUTING.md), including the Change Contract, Planned Files, CI evidence and Human Merge Gate. Security reporting does not authorize remote database changes, session revocation or Production operations.

Project-specific requirements and deployment controls remain with each project. Template foundations and their boundaries are indexed in [the implementation documentation](docs/README.md).
