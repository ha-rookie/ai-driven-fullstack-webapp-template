# Report / Document Generation Foundation

Stage 1 defines the provider-neutral boundary for formal generated documents.

```text
Domain / persisted fact
  -> project Report Builder
  -> validated ReportViewModel
  -> ReportRenderer
  -> RenderedReport
  -> later stages: GeneratedArtifact metadata + #52 private Object Storage + #261 safe download
```

## Rules

- Domain entities are not renderer inputs. A project builder selects authorized/masked fields and creates a validated ReportViewModel.
- ReportDefinition and template versions are fixed into the view model and artifact metadata.
- SourceSnapshot identifies persisted facts/revisions used for generation.
- Generation intent distinguishes `original`, `regenerated_copy`, and `reissue`.
- Reports are projections, never the source of current business/workflow state.
- The HTML reference renderer rejects active HTML and arbitrary external assets. Business text must be escaped with `escapeReportHtml`.
- PDF/XLSX are adapter interfaces, not fixed libraries in Core.
- CSV reuses #262. Binary persistence/download reuse #52/#261. Heavy generation will reuse #51.
- Production/Remote artifact generation is not part of Stage 1.
