# Supply-chain Security

## Purpose

Define the dependency supply-chain baseline for this Full-stack Template. The first control is reproducible installation from a committed npm lockfile. Vulnerability scanning, SBOM generation, license inventory, and broader SCS control mapping are separate implementation units.

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

## Secrets and registries

The Template does not require a private registry and does not log registry tokens. Projects that add authenticated registries must use CI secret facilities and must not commit credentials into `.npmrc`, manifests, lockfiles, or workflow output.

## CI evidence

The required CI exposes distinct steps for lockfile validation, clean install, dependency-tree validation, and manifest/lockfile mutation detection. These step results can later be referenced by Release Evidence (#112) without introducing a separate external service.

## Scope boundary

This control does not:

- update dependencies automatically
- scan known vulnerabilities (#83)
- generate an SBOM (#85)
- inventory licenses (#119)
- provision a private registry
- change the package manager
