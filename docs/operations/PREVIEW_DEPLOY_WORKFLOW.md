# Preview Deploy Workflow

## Purpose

Provide an explicit, Production-isolated Cloudflare Preview deployment path for browser/mobile verification of the Component Showcase and reference vertical slices.

A normal pull request, push, or schedule must not deploy the remote Preview environment. The first real remote Preview deployment is a Human Gate.

## Environment boundary

- Preview uses the repository's explicit named Wrangler `env.preview` environment
- Preview D1 is pinned to `f1ce1268-2be2-4a20-ab10-a94c32feee64`
- runtime evidence is labeled with `RUNTIME_ENVIRONMENT=preview`
- Production Wrangler configuration and `PRODUCTION_*` secrets are forbidden in this workflow
- code deployment and D1 migration remain separate workflows

## Required setup

GitHub Actions must provide:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The GitHub Environment named `preview` is the Human Gate for remote deployment. Configure required reviewers before first real Preview use.

This workflow does not create Cloudflare resources, register secrets, or modify Production configuration.

## Execution order

1. Operator supplies a full immutable commit SHA
2. confirmation must exactly equal `DEPLOY PREVIEW`
3. preflight checks out the exact SHA
4. Preview workflow policy and lockfile are validated; Vite builds with `CLOUDFLARE_ENV=preview` so the generated deploy configuration contains the Preview bindings
5. deploy waits on GitHub `environment: preview`
6. after approval, the exact SHA and validations are repeated
7. the pinned Preview target is checked
8. `wrangler deploy` deploys the Vite-generated Preview configuration; environment selection is intentionally not deferred to deploy time
9. non-secret deployment evidence is retained

## Separation from D1 migration

Preview deploy does not apply migrations. Schema changes use `Preview D1 migration`. A release that needs both must establish compatibility/order explicitly.

## Stop conditions

Stop before deployment when:

- target SHA is mutable or malformed
- confirmation does not match
- checked-out SHA differs
- build/validation fails
- Preview D1 identity is missing or mismatched
- Production configuration appears in the Preview workflow
- Preview credential scope is missing, ambiguous, or requires broadening
- GitHub Preview Environment approval is not granted

## Evidence

Successful remote deployment may retain only non-secret evidence: commit SHA, workflow run ID, environment, pinned Preview D1 ID, and deployment status.

Repository/CI validation proves the workflow is implemented. It is not evidence that a real remote Preview deployment has succeeded.
