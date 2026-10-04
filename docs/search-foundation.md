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

## Security invariants

- Provider/index presence never means the principal may read the resource.
- Unauthorized candidates are never passed to the hydrator.
- Hydrators cannot add resources that were not authorized.
- Frontend filtering is not an authorization control.
- Search and AI/RAG must share the same application authorization boundary.
- Raw user search queries should not be written to normal application logs.
- Provider-specific query DSL must not be exposed through the public application API.

## Index consistency

An index is secondary data and may be stale. Current existence, authorization and presentation are resolved after candidate discovery. A later Stage may connect index mutation/reconciliation to #304 Integration Event and #51 Async Job; business mutations must not be rolled back merely because an external index update is delayed.

## Deliberately not claimed by Stage 1

- D1 FTS implementation
- external search engine implementation
- vector or embedding provider
- opaque provider cursor wrapping
- multi-provider fan-out / timeout / partial-result policy
- persistent indexing and reconciliation
- browser search UI
- Production/Preview search resources

Those remain follow-up stages under #305. Production credentials, remote index creation and external provider configuration remain Human Gate items.
