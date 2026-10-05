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

## Stage 2b D1 index baseline

The template includes a D1-backed secondary search index with a SQL provider that does not require FTS5. It stores only search projection fields selected by the application: resource identity, category, title/search text, optional keywords, source version timestamps and tombstone state.

Index mutation is asynchronous by design. Integration Events map only to a resource key, and the #51 Async Job handler resolves the current source again before writing the index. Search text or full business payload is not copied into the job envelope merely to update the index.

`sourceVersion` and `sourceUpdatedAt` prevent an older projection from replacing a newer index record. Deletion is represented as a tombstone so delayed events and reconciliation can reason about source state without treating physical index row deletion as the business source of truth.

Reconciliation scans source resource keys page by page, projects the current source and repairs missing, stale or incorrectly tombstoned index rows. Business mutations are never rolled back because indexing or reconciliation is delayed.

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
- Index update failure must not roll back the business transaction.
- Async index jobs carry resource keys, not the raw business/search body.
- Current authorization and presentation are always resolved after candidate discovery.

## Deliberately not claimed yet

- FTS5 as a mandatory dependency
- external search engine implementation
- vector or embedding provider
- multi-provider fan-out / timeout / partial-result policy
- browser search UI
- Production/Preview search resources

Those remain follow-up stages under #305. Production credentials, remote index creation and external provider configuration remain Human Gate items.
