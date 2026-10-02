# License Inventory / Policy

## Purpose

This control makes dependency license metadata reviewable without turning the Template into a legal decision engine.

It is deliberately separate from vulnerability scanning and SBOM generation:

- SBOM answers which software components and dependency relationships are present
- vulnerability scanning checks known security advisories
- license inventory records declared dependency licenses and applies a project-owned review policy

None of these controls substitutes for legal advice.

## Generate the inventory

After a reproducible install, run:

```text
npm run supply-chain:licenses
```

The default output is `license-inventory.json`. The output path can be overridden with `LICENSE_INVENTORY_OUTPUT`.

The generator walks the dependency set represented by `package-lock.json` and reads the installed package manifests produced by `npm ci --ignore-scripts`. This allows it to capture license metadata that is not always retained directly in the lockfile.

Each inventory entry records at least:

- package name
- package version
- installed path
- normalized declared license
- license metadata kind
- policy decision

## License normalization

A non-empty string license declaration is retained as declared. Legacy array/object declarations are reduced to a deterministic textual expression where possible.

The inventory distinguishes:

- `spdx-like`: declaration has a machine-readable SPDX-style shape
- `unknown`: no usable declaration was found
- `custom`: declaration exists but does not fit the conservative SPDX-style shape

This is structural normalization only. The Template does not assert that an SPDX-looking declaration is legally valid, complete, or compatible with a product's distribution model.

`unknown` and `custom` are never automatically treated as safe. They are forced to `review`.

## Project-owned policy contract

The default policy file is:

```text
config/license-policy.json
```

A product may replace it or point to another file with `LICENSE_POLICY_PATH`.

The contract is:

```json
{
  "schemaVersion": 1,
  "defaultDecision": "review",
  "allow": [],
  "review": [],
  "deny": []
}
```

The same normalized license string cannot appear in more than one decision list. Invalid or overlapping policy entries fail closed.

### Decisions

`allow` means the project has decided no additional license review is required for that normalized declaration under its own policy.

`review` means human/project review is required. This is also the default for unlisted licenses and is mandatory for unknown/custom metadata.

`deny` means the project policy blocks that license declaration and CI exits non-zero when a matching dependency is present.

The Template intentionally ships with empty lists and `defaultDecision: review`. It does not encode an OpenAI, organization, or universal legal allow/deny list.

## Exceptions and review records

Do not weaken the Core scanner or silently relabel unknown/custom licenses to make CI green. If a product accepts a reviewed exception, keep the decision in a project-owned reviewable location and record at least:

- dependency and version
- normalized license declaration
- decision and rationale
- reviewer/owner
- scope of the decision
- expiry or next review date when appropriate

The policy file is a technical enforcement input; it is not the complete legal record.

## CI behavior

The `License inventory` workflow performs:

1. lockfile/manifest integrity validation
2. reproducible `npm ci --ignore-scripts`
3. license inventory generation
4. project policy evaluation
5. artifact upload even when policy blocks the run

The workflow fails only for malformed policy/input or an explicit `deny` match. `review` findings remain visible in the report without pretending a legal conclusion has been reached.

## Evidence

`license-inventory.json` is uploaded as a short-retention GitHub Actions artifact. It can be referenced by Release Evidence (#112) together with the SBOM, vulnerability report, secret scan result, and lockfile integrity result.

The generated inventory is not committed to the repository, avoiding generated-file churn when dependency versions change.

## Scope boundary

This control does not:

- provide legal advice or a legal compatibility opinion
- automatically remediate dependency licenses
- rewrite source headers
- infer licensing from source code when package metadata is absent
- define an organization-wide license policy
- replace SBOM or vulnerability scanning
