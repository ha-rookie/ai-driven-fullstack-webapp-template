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


## Stage 3 — WORKHUB reference integration

The WORKHUB reference application exercises the Search Foundation against real reference business data rather than static search fixtures.

- TravelRequest is projected into the derived Search Index with only search-oriented fields.
- `GET /api/workhub/search?q=...` resolves the authenticated principal on the server.
- D1 search returns candidates only; every candidate is re-authorized against the current TravelRequest / Workflow state before hydration.
- Hydration reads the current TravelRequest record. Search-index content is not returned as authoritative business data.
- TravelRequest mutations refresh the derived index on a best-effort basis. Index failure does not roll back the business mutation.
- The browser reference UI exposes enterprise search and Browser E2E verifies authorization changes across the Aoi / Ren workflow scenario.
- A manager losing the current approval assignment no longer sees the request through search even if a stale index candidate remains.

Stage 3 does not add RAG, AI-generated answers, MCP tools, vector search, or remote/Production resources.


## Stage 4 — Multi-resource / Masking / Partial Failure

The authorization invariant remains:

`Search provider/index → candidate → current authorization → current hydration → safe projection`

- Multiple resource types may share the same `SearchApplicationService`.
- `SearchResultProjector` runs only after current authorization and hydration. It is the bounded presentation/masking extension point; it does not grant authorization.
- `CategoryFanoutSearchProvider` can query category-specific providers in parallel.
- A category provider failure is returned as `categoryFailures`; it is never silently converted into an empty result set.
- Successful categories remain usable when another category fails.
- The fan-out provider cursor tracks completed categories so later pages do not restart already exhausted providers.
- The outer Search cursor remains opaque and bound to principal, environment, query and categories.
- Search Index/provider content remains candidate data. Stale title/snippet never overrides current hydrated resource state.
- AI/RAG/MCP sharing is intentionally deferred to the next stage; Stage 4 strengthens the normal search boundary first.
- Production / Remote Search Provider changes are not required.


## Stage 5 — Shared Web / AI-RAG / MCP consumer boundary

Web UI, AI/RAG and MCP must not create separate retrieval paths that bypass current authorization.

`consumer → SharedSearchConsumer → SearchApplicationService → provider candidate → current authorization → current hydration → projection/masking`

- `SharedSearchConsumer` is consumer-neutral; `web`, `ai_rag` and `mcp` are intent labels, not authorization grants.
- `AiSearchContextBuilder` consumes only the already-authorized, current-hydrated, projected `SearchResponse`.
- AI context carries stable resource identity and available source metadata; it never receives raw provider/index documents.
- Permission changes are evaluated on every search, so stale index candidates cannot remain in AI context after access is revoked.
- Category provider failures remain explicit context metadata and are not converted to “no evidence found”.
- MCP transport/server implementation remains #273 responsibility. This stage proves the shared application-service adapter boundary only.
- LLM calls, answer generation, embeddings, vector DB provisioning and Production endpoints remain out of scope.


## Stage 6 — External/vector provider, query privacy and performance evidence

- `ExternalSearchProvider` adapts an external full-text client to the existing provider-neutral `SearchProvider` contract.
- `VectorSearchProvider` proves the same boundary can wrap vector retrieval without changing `SearchApplicationService`.
- Provider-specific raw hits/payloads do not enter the API contract; only bounded candidate identity/category/score and opaque provider cursor cross the adapter.
- Raw query text is intentionally absent from `SearchObservation`. Normal observability records counts, environment and cursor/failure state only.
- Existing #122 `ApplicationMetricsRecorder` is reused for bounded dependency-failure telemetry.
- Integration Event (#304) can map aggregate identity to a Search Index projection job using the existing #51 Async Job envelope. Event business payload is not copied into the job.
- Existing search projection/reconciliation remains the repair path for stale/missing index state.
- Existing post-hydration projection remains the #74-style masking boundary.
- Locale remains an explicit `SearchQuery.locale` input; provider adapters do not infer browser/OS locale.
- Batch evidence verifies 50 candidates require one authorization batch and one hydration batch, preventing per-result N+1 behavior at the Search Application Service boundary.
- Production external search/vector services, embeddings, secrets, bindings and remote resources remain out of scope and Human Gate.
