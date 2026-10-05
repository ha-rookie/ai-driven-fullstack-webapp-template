# Report / Document Generation Foundation

Issue: #306 / Stage 1: #383

## Responsibility

This foundation creates versioned report artifacts from explicit Report View Models. It is separate from browser print UX.

```text
Domain / Persisted Fact
  -> ReportBuilder
  -> validated ReportViewModel
  -> ReportRenderer
  -> private ObjectStorage
  -> GeneratedArtifact metadata
```

A report artifact is derived evidence. It is never the source of truth for current business state.

## Stage 1 contracts

- `ReportDefinition`: report key, definition version, template key/version, supported output types
- `ReportBuilder`: converts authorized domain facts into a report-specific view model
- `ReportViewModelValidator`: schema boundary before rendering
- `ReportRenderer`: provider-neutral HTML/PDF/XLSX/CSV renderer boundary
- `GeneratedArtifact`: records source snapshot, template version, checksum, object reference and generation intent
- `ReportAuthorizationPolicy`: separate generation-time and download-time authorization
- `ReportArtifactStore`: metadata and generation identity persistence boundary
- `SafeHtmlReportRenderer`: deterministic Local/Test HTML reference renderer
- `InMemoryReportArtifactStore`: deterministic Local/Test metadata adapter

## Security and integrity

- Domain entities are not passed directly to renderers.
- Builders must include only fields allowed for the report.
- View models are validated before rendering.
- Business text embedded in HTML must be escaped with `escapeHtml`; arbitrary user-authored templates are out of scope.
- Generated binary is stored through private Object Storage (#52).
- Download authorization is re-evaluated against current policy before an artifact is resolved.
- Storage identifiers are opaque and are not download URLs.
- SHA-256 detects artifact corruption; it is not a legal signature.
- Template/definition/source snapshot versions are recorded on the artifact.
- `original`, `regenerated_copy`, and `reissue` are distinct generation intents.
- Repeating the same generation identity returns the existing artifact instead of silently producing unlimited duplicates.
- Renderer/storage failure does not mutate or roll back business state.

## Provider boundaries

HTML is the Stage 1 reference implementation. PDF and XLSX are supported by the `ReportRenderer` contract but no concrete library is fixed in Template Core. CSV should reuse #262 rather than introduce a second CSV implementation.

## Next stage

Stage 2 should integrate a WORKHUB TravelRequest approval report using historical Office revision and Workflow decision facts, then expose generation/download through the existing server-side authorization and safe download boundary (#261). Heavy rendering should delegate to #51 rather than block synchronous HTTP.

Production/Remote storage, queues, secrets and migrations remain Human Gate operations.
