# Full-stack Architecture

## Purpose

Define only the technology-specific runtime structure added by this Full-stack Template. Technology-independent development process and governance remain in the upstream Generic Template.

## Target architecture

```text
Browser
  ↓
React SPA
  ↓ /api/*
Cloudflare Worker
  ↓
Application
  ↓
Domain
  ↓
Infrastructure
  ↓
D1 / External Services
```

## Bootstrap implementation

Issue #1 implements only:

```text
Browser
  ├─ React SPA
  └─ /api/health
        ↓
     Worker
```

- `/api/*` is evaluated by the Worker first
- non-API requests are served through the Static Assets binding
- SPA fallback is enabled
- `/api/health` requires no secret, database, or external service

## Planned layers

Later Issues add `application`, `domain`, `infrastructure`, authentication, authorization, D1 persistence, concurrency, audit, and boundary tests.

Bootstrap must not invent those contracts before their dedicated design/implementation Issues.
