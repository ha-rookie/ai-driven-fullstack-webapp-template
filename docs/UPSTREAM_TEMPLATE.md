# Upstream Template

## Source of truth

This repository is an implementation-layer template derived from the development standards in:

- Repository: `ha-rookie/ai-driven-webapp-template`
- Initial baseline commit: `c79d6bd8effeac114fb171dd4b208d7d336a4065`

The upstream repository remains the source of truth for Golden Path, governance, Human Gates, generic quality criteria, and technology-independent design guidance.

## Responsibilities added here

This repository adds concrete implementation patterns for:

- React
- TypeScript
- Vite
- Cloudflare Workers
- Cloudflare D1
- Authentication foundation
- Authorization
- Concurrency control
- Runtime/data integrity
- Audit logging
- Database migrations
- Boundary/integration tests

Not all responsibilities are implemented in Bootstrap. They are added incrementally by dedicated Issues.

## Duplication rule

Do not copy upstream Core Design documents merely to keep a second source of truth.

When upstream guidance changes, evaluate whether this implementation template requires a concrete runtime change. Record the reviewed upstream baseline here when that evaluation is performed.
