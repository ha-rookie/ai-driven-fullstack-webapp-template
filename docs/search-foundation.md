# Search Foundation

## Purpose

Search is a candidate-discovery mechanism, not an authorization source of truth.

```text
Search Provider candidates
        ↓
Current principal authorization
        ↓
Authorized candidates only
        ↓
Current resource hydration
        ↓
Search results
```

The same Search Application Service is intended to be reused by Web UI, AI/RAG and MCP adapters so those callers do not invent separate authorization logic.

## Stage 1 baseline

- provider-neutral `SearchProvider`
- server-resolved `SearchPrincipal`
- batch authorization boundary
- authorization before hydration
- batch hydration boundary
- bounded query/category/limit validation
- deterministic InMemory provider for Local/Test
- WORKHUB Reference scenario showing Aoi/Ren receive different results from the same candidate source

## Stage 2a opaque cursor boundary

Provider continuation tokens remain provider-internal and are never returned directly from the public Search Application Service.

The application-issued opaque cursor is bound to the current principal, environment and normalized query shape. Reusing a cursor after changing the query, category scope, locale, limit, principal or environment is rejected as `invalid_cursor` before provider continuation is resumed.

The cursor payload is limited to continuation metadata. It must not contain business data, secrets, raw authorization state or provider topology that should remain private.

Local/Test uses a deterministic in-memory codec. Production projects inject a codec appropriate to their deployment and threat model; the template does not require a specific signing or encryption provider.

## Security invariants

- Provider/index presence never means the principal may read the resource.
- Unauthorized candidates are never passed to the hydrator.
- Hydrators cannot add resources that were not authorized.
- Frontend filtering is not an authorization control.
- Search and AI/RAG must share the same application authorization boundary.
- Raw user search queries should not be written to normal application logs.
- Provider-specific query DSL must not be exposed through the public application API.
- Provider raw continuation tokens must not escape through the application response.
- Opaque cursors are continuation state, not an authorization source of truth.

## Index consistency

An index is secondary data and may be stale. Current existence, authorization and presentation are resolved after candidate discovery. A later Stage may connect index mutation/reconciliation to #304 Integration Event and #51 Async Job; business mutations must not be rolled back merely because an external index update is delayed.

## Deliberately not claimed yet

- D1 FTS implementation
- external search engine implementation
- vector or embedding provider
- multi-provider fan-out / timeout / partial-result policy
- persistent indexing and reconciliation
- browser search UI
- Production/Preview search resources

Those remain follow-up stages under #305. Production credentials, remote index creation and external provider configuration remain Human Gate items.
