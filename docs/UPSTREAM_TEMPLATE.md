# Upstream Template

## Source of truth

This repository is an implementation-layer template derived from the development standards in:

- Repository: `ha-rookie/ai-driven-webapp-template`
- Initial implementation baseline: `c79d6bd8effeac114fb171dd4b208d7d336a4065`
- Last reviewed upstream release: `v0.4.0`
- Last reviewed upstream commit: `15c318672ead1dc4aa33585b79b8327ff23cad3f`
- Release URL: `https://github.com/ha-rookie/ai-driven-webapp-template/releases/tag/v0.4.0`
- Last reviewed: 2026-09-30

The upstream repository remains the source of truth for:

- Golden Path
- governance and Human Gates
- Human / AI collaboration guardrails
- technology-independent quality criteria
- Change Contract / delivery process
- Development / Release Convergence
- Tool-neutral development Playbooks
- Release Candidate Gate / User Test Ready
- User Test feedback triage / Template backflow
- provider-neutral authentication / authorization principles
- generic mutation / concurrency principles
- generic environment-isolation / safe-test principles

## Upstream adoption review: v0.4.0

The reviewed upstream release `v0.4.0` includes the generic governance and delivery baseline from `v0.3.1`, plus additional technology-independent boundaries learned from real application development.

### Reference upstream only

The following remain Generic / Common Template responsibilities and are **not copied into this repository**:

- Human / AI collaboration guardrails
- Release Candidate Gate / User Test Ready
- User Test feedback triage and Template backflow
- generic environment isolation / safe test execution / fixture lifecycle
- generic mutation / stale update / concurrency principles
- generic External Identity / Application User / Session lifecycle principles
- generic Role / Permission / Resource Scope authorization principles

These define meaning, review criteria, and workflow. They do not by themselves prescribe React, Workers, D1, schema, middleware, or provider-specific implementation.

### Full-stack foundations already present

This repository already has implementation-layer foundations corresponding to part of the upstream guidance:

- Authentication Foundation: #9
- Authorization Foundation: #11
- Runtime Integrity / optimistic concurrency: #13
- Audit & Correlation: #15
- Boundary Tests: #17
- Recovery / Operations: #19
- Performance / Capacity: #21

These remain Full-stack responsibilities because they implement the upstream principles with React / Workers / D1 concrete behavior.

### Concrete Full-stack follow-up

Where `v0.4.0` generic guidance implies a concrete implementation boundary, reuse the existing Full-stack Issues instead of creating duplicate Issues:

- #34 Full-stack Scoped Instructions
- #62 Authorization Guard
- #70 Session Idle Timeout
- #71 Session Revocation Service
- #88 Session Rotation Guard
- #89 CSRF Protection Guard
- #90 User Lifecycle Guard
- #91 Security Rejection Event
- #124 HTTP Concurrency Precondition
- #42 / #86 / #107-#112 Production / Environment safety
- #61 Load / Stress / Soak Testing Foundation

A generic upstream change does not automatically require all related Full-stack Issues to be implemented immediately. Priority is determined by the Full-stack backlog and Project need.

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

- this Full-stack Template does not automatically receive later Common Template changes
- a Project created from this Full-stack Template does not automatically receive later Full-stack changes
- important upstream changes must be deliberately reviewed
- reviewed Release / Tag and commit must be recorded rather than inferred from moving `main`
- later upstream `main` changes remain outside the reviewed baseline until the next explicit adoption review

## Project adoption model

A Project using this repository should combine two inputs deliberately:

```text
Reviewed Common Template Release
  └─ development governance / quality / Human Gates

Current Full-stack Template
  └─ React / Workers / D1 implementation baseline

        ↓
      Project
  └─ product-specific requirements and decisions
```

Using the Full-stack Template alone does not mean the Project has automatically adopted later Common Template changes after the recorded upstream Release.

## Duplication rule

Do not copy upstream Core Design, Convergence, Playbook, Release Candidate Gate, User Test feedback, or Governance documents merely to keep a second source of truth.

When upstream guidance changes:

1. identify the next stable Common Template Release / Tag
2. review the changed generic responsibility against the previously reviewed Release
3. classify each relevant change as:
   - upstream reference only
   - already covered by an existing Full-stack foundation
   - concrete Full-stack implementation follow-up
4. if no implementation change is needed, update only the reviewed Release / commit and review notes
5. if a concrete implementation change is needed, reuse or create a dedicated Full-stack Issue
6. do not infer adoption from upstream `main` alone

Technology-independent meaning stays upstream; technology-specific implementation stays here.
