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
- Under #350, the WORKHUB TravelRequest **owner-authorized detail GET** now reads the latest historical original approval report status from D1 only after `TravelRequestService.get` authorizes access. The response contains only `reportStatus.state`; it contains no private storage identifiers, failure codes, or downloadable object link. The UI displays approval from the persisted Workflow **separately** from report status, and provides a GET-only refresh. This is an informational status surface, not an API for scheduling reports or re-approving a business request.
- If no artifact exists, the status is `not_generated` (not silently `ready`). If the artifact read fails, it is `unavailable` (not a false 0). `pending`, `generating`, `ready`, `failed` and `expired` remain distinct. The existing WORKHUB browser print/PDF-save is still **not** a historical generated report; no report job scheduling or actual download link is added.
- This is a thin read-only integration. Until a real report generation trigger, persistent async execution wiring and end-to-end authenticated tests are complete, do **not** claim that an approved request automatically generates a downloadable report, or close #350.

Regression: `tests/report-artifact-async.test.ts` checks terminal failure, non-republication, the unchanged approved input snapshot, and the hidden download. The unit regression does not exercise a persisted TravelRequest/Workflow write or the browser UI. Formal authenticated Preview business System Test and end-user accessible/mobile recovery UI remain deferred under #350.

Added scoped status and UI checks: `tests/workhub-report-status.test.ts`, `tests/report-artifact-d1.test.ts` and `e2e/tests/workhub-report-status-recovery.spec.ts`. The browser test injects a simulated failed/ready report projection after a real owner-authorized local GET; it does not prove live generation. Android/iOS physical device and assistive technology validation remains in consolidated formal System Test.
