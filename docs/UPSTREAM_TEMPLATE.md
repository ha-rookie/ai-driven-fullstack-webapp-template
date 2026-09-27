# Upstream Template

## Source of truth

This repository is an implementation-layer template derived from the development standards in:

- Repository: `ha-rookie/ai-driven-webapp-template`
- Initial implementation baseline: `c79d6bd8effeac114fb171dd4b208d7d336a4065`
- Last reviewed upstream baseline: `596c385ea94b5277909d3acfa17f74bf22f69875`
- Last reviewed: 2026-09-27

The upstream repository remains the source of truth for:

- Golden Path
- governance and Human Gates
- Human / AI collaboration guardrails
- technology-independent quality criteria
- Change Contract / delivery process
- Development / Release Convergence
- Tool-neutral development Playbooks

## Upstream review since the initial baseline

The reviewed upstream baseline now includes additional generic delivery guidance, including:

- `docs/CONVERGENCE_GATE.md`
- `docs/playbooks/`

These changes define **how development work is executed and considered complete**. They do not introduce React, Workers, D1, authentication schema, optimistic locking, or other Full-stack runtime implementation requirements.

Decision for this review:

- keep Convergence Gate in the Generic Template
- keep Tool-neutral Playbooks in the Generic Template
- do not copy those documents into this repository
- reference the current Generic Template when bootstrapping or reviewing a Project
- create a Full-stack Issue only when an upstream change requires a concrete React / Workers / D1 implementation change

## Responsibilities added here

This repository adds concrete implementation patterns for:

- React
- TypeScript
- Vite
- Cloudflare Workers
- Cloudflare D1
- provider-independent authentication foundation
- scope/role authorization foundation
- optimistic concurrency and state transition
- runtime/data integrity and atomic multi-write
- structured audit and request correlation
- database migrations
- protected boundary tests
- D1 recovery operations
- performance / capacity measurement

Product-specific requirements, real Domain models, concrete Identity Providers, real Role vocabulary, NFRs, and Production release decisions remain Project responsibilities.

## No automatic inheritance

GitHub Template Repository creation is a copy operation, not an inheritance relationship.

Therefore:

- this Full-stack Template does not automatically receive later Generic Template changes
- a Project created from this Full-stack Template does not automatically receive later Full-stack changes
- important upstream changes must be deliberately reviewed
- reviewed baseline and resulting implementation decision should be recorded rather than inferred

## Project adoption model

A Project using this repository should combine two inputs deliberately:

```text
Current Generic Template
  └─ development governance / quality / Human Gates

Current Full-stack Template
  └─ React / Workers / D1 implementation baseline

        ↓
      Project
  └─ product-specific requirements and decisions
```

Using the Full-stack Template alone does not mean the Project has automatically adopted the latest Generic governance.

## Duplication rule

Do not copy upstream Core Design, Convergence, Playbook, or Governance documents merely to keep a second source of truth.

When upstream guidance changes:

1. review the changed generic responsibility
2. decide whether it implies a Full-stack runtime change
3. if no runtime change is needed, update only the reviewed baseline/reference when useful
4. if a concrete implementation change is needed, create a dedicated Full-stack Issue

Technology-independent meaning stays upstream; technology-specific implementation stays here.
