# Supply-chain Security

## Purpose

Define the dependency supply-chain baseline for this Full-stack Template. The baseline starts with reproducible installation from a committed npm lockfile and adds dependency vulnerability scanning. SBOM generation, license inventory, and broader SCS control mapping remain separate implementation units.

## Lockfile as install source of truth

`package-lock.json` is committed and reviewed together with dependency declaration changes.

CI must not use `npm install` to repair or rewrite the lockfile. A manifest/lockfile mismatch is a failure, not a warning.

The baseline validation order is:

1. validate `package.json` and `package-lock.json` structure and root dependency declarations
2. run a clean `npm ci` from the committed lockfile
3. validate the installed dependency tree with `npm ls --all`
4. verify CI did not modify `package.json` or `package-lock.json`

## Pre-install validation

Run:

```text
npm run supply-chain:lockfile
```

The validator fails closed when:

- `package.json` is missing or invalid JSON
- `package-lock.json` is missing or invalid JSON
- the lockfile format is unsupported
- the lockfile root package is missing
- root package name/version disagree when both are present
- dependencies, devDependencies, optionalDependencies, or peerDependencies differ between the manifest and lockfile root

The validator intentionally does not reimplement npm's full package resolution algorithm. `npm ci` and `npm ls --all` remain authoritative for the resolved dependency tree.

## Reproducible clean install

Required CI uses:

```text
npm ci --ignore-scripts
```

`npm ci` must fail if the committed lockfile cannot reproduce the manifest. CI does not regenerate the lockfile.

Lifecycle/install scripts are disabled in the required baseline because arbitrary dependency scripts expand the execution boundary during dependency installation. If a product project genuinely requires a lifecycle script, it must make that exception explicit, document why it is required, identify the affected package, and keep the exception reviewable instead of silently changing the baseline.

## Dependency tree integrity

After installation CI runs:

```text
npm ls --all
```

An invalid or unmet dependency tree fails the build. The check is lockfile-backed; it does not perform an automatic dependency update.

## Lockfile mutation policy

After dependency installation CI checks that these files are unchanged:

```text
package.json
package-lock.json
```

A dependency update must therefore be an explicit repository change. Review should treat a lockfile change as executable supply-chain input, not generated noise.

When reviewing a dependency update, inspect at least:

- the direct dependency declaration change
- resolved package/version changes in the lockfile
- newly introduced transitive packages
- registry source changes
- lifecycle/install-script implications
- unexpected large lockfile churn unrelated to the intended update

## Dependency vulnerability scanning

The required dependency scan uses npm's lockfile-backed advisory check after a reproducible install. It does not update dependencies and does not require a paid external service.

Two scopes are intentionally separated.

### Production dependencies

Production dependencies are checked with:

```text
npm audit --omit=dev --audit-level=high
```

`high` or `critical` findings fail CI. Production runtime exposure receives the stricter threshold because these dependencies are part of the deployed application boundary.

### Full dependency tree

The complete dependency tree, including development dependencies, is checked with:

```text
npm audit --audit-level=critical
```

`critical` findings fail CI. `high`, `moderate`, and `low` findings remain visible in the audit output and must not be silently discarded, but they do not fail the Template baseline automatically. This prevents tooling-only transitive findings from permanently blocking development while still keeping them visible for remediation.

A product can choose a stricter threshold. It must not weaken the production baseline without documenting the accepted risk.

## Accepted risk and false positives

The Template does not encode package-specific vulnerability exceptions or advisory allowlists. A project that temporarily accepts a finding should record, in a reviewable project-owned location:

- affected package and advisory identifier
- whether the package is production or development-only
- why the vulnerable path is or is not reachable in that product
- compensating controls when applicable
- owner
- expiry or next review date
- remediation plan

Do not suppress findings only to make CI green. An accepted risk is a time-bounded engineering decision, not an invisible CI exception.

## Vulnerability scan evidence

The dependency scan workflow captures the npm audit output for both production-only and full-tree scans and uploads it as a short-retention GitHub Actions artifact. The workflow log also retains the exact pass/fail step result.

This gives Release Evidence (#112) a repository-native source without requiring an external vulnerability platform. Audit evidence must not include registry credentials or other secrets.

## Secrets and registries

The Template does not require a private registry and does not log registry tokens. Projects that add authenticated registries must use CI secret facilities and must not commit credentials into `.npmrc`, manifests, lockfiles, or workflow output.

## CI evidence

Required supply-chain CI exposes distinct steps for lockfile validation, clean install, dependency-tree validation, manifest/lockfile mutation detection, production dependency audit, and full dependency-tree audit. These step results and dependency audit artifacts can later be referenced by Release Evidence (#112).

## Scope boundary

These controls do not:

- update dependencies automatically
- generate an SBOM (#85)
- inventory licenses (#119)
- provision a private registry
- change the package manager
- scan container images
