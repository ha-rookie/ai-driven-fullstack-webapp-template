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

## WORKHUB #350 G — Generation failure is not approval failure

Report generation is a **secondary projection** of an already-persisted business decision. A failure of the renderer, asynchronous job, or private object storage must not undo or re-submit a completed approval. An approved TravelRequest/Workflow remains authoritative; an artifact can independently be `pending`, `generating`, `ready` or `failed`.

- An incomplete or failed artifact is **not downloadable** (the authorized-download endpoint continues to hide it as 404); it is not evidence that the approval failed.
- A retryable job execution failure does not prematurely mark the artifact as failed. The existing job retry policy may retry the **report job only**, never the TravelRequest approval mutation.
- Once an original artifact is terminally `failed`, a repeat request for that same historical original must **not publish another job** under the same deterministic identity or suggest that the failed report has become ready. Operator-controlled reconciliation/new generation policy is a separate decision; no blind re-approval or reissue.
- A future WORKHUB artifact-status screen must source approval from the Workflow/TravelRequest and generation status from the artifact store **separately**, show the safe next action (check read-only status / contact operator), and never turn a report error into a workflow retry button. There is currently no connected end-user report-status API/screen; do not mark scenario G as a complete live UI acceptance based on this foundation test.

Regression: `tests/report-artifact-async.test.ts` checks terminal failure, non-republication, the unchanged approved input snapshot, and the hidden download. The unit regression does not exercise a persisted TravelRequest/Workflow write or the browser UI. Formal authenticated Preview business System Test and end-user accessible/mobile recovery UI remain deferred under #350.
