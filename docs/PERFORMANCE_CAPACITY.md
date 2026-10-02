# Performance / Capacity Foundation

## Purpose

Define how this Full-stack Template measures D1 workload shape, access paths, execution time, and external-resource cost without turning every pull request into a remote load test.

Performance work is split into two layers:

```text
Required PR CI
  └─ Local D1 smoke benchmark
       ├─ representative fixture
       ├─ query-plan assertions
       ├─ result assertions
       ├─ timing capture
       └─ resource metrics when available

Human-triggered operation
  └─ Preview D1 capacity benchmark
       ├─ explicit confirmation
       ├─ Preview/Production separation guard
       ├─ quota-aware fixture
       ├─ timing + rows read/write evidence
       └─ cleanup
```

The Template does not define a universal Production SLA.

## Measurement vocabulary

The report intentionally keeps these measurements separate.

### SQL duration

`sqlDurationMs` comes from D1 `meta.timings.sql_duration_ms` when the runtime returns it.

It represents SQL execution time inside D1 and excludes CLI/network overhead.

### CLI wall time

`cliWallMs` measures the elapsed time around the Wrangler process.

It includes process startup and, for remote Preview runs, communication overhead. It must not be described as database execution time.

### Resource consumption

When D1 metadata is available, the report also records:

- `rowsRead`
- `rowsWritten`
- statement count

Performance result and external-resource consumption belong in the same evidence. A fast query that reads an unnecessarily large number of rows can still be a poor capacity design.

## Operation Budget

Latency is not treated as a proxy for efficiency. A user action can return quickly while still multiplying HTTP requests, D1 statements, rows read, or rows written.

The opt-in `OperationBudgetRecorder` records these dimensions separately:

- foreground HTTP requests
- background HTTP requests
- duplicate HTTP requests
- D1 statement executions
- D1 failures
- rows read when D1 metadata is available
- rows written when D1 metadata is available

`src/infrastructure/d1-operation-budget.ts` wraps a supplied D1 binding without changing the Domain/Store contract. It instruments `prepare/bind/first/all/run/raw`, `batch`, `withSession`, and `exec` execution paths.

The wrapper never records:

- SQL text
- bind values
- session tokens
- response bodies
- business row values

It is opt-in. The Template does not globally wrap `env.DB` or silently change every endpoint.

### Unavailable metadata is not zero

Some D1 APIs return row metadata while others, such as `first()` or `raw()`, do not expose equivalent metadata to the caller.

When row metadata is unavailable the recorder emits `null`, not `0`. A Project that configures a rows-read/written threshold cannot silently pass that threshold using unavailable metadata.

Statement/request counts remain available even when row metadata is not.

### Project-defined budget

`assessOperationBudget()` accepts optional Project thresholds such as:

- maximum HTTP requests per action
- maximum D1 statements per action
- maximum rows read per action
- maximum rows written per action
- expected actions per day for a simple daily resource forecast

The Template does not embed Cloudflare Free/Paid plan quotas because those limits, pricing, traffic shape, and account sharing change independently of this codebase.

Daily forecast values are arithmetic projections from the measured action and a Project-supplied action count. They are not load forecasts or billing guarantees.

### Duplicate/background traffic

Auth bootstrap, polling, refresh, retry, and duplicate fetches can consume D1 budget even when the visible business operation did not change.

The recorder therefore distinguishes background and duplicate request counts from the total. Frontend work such as #126 can later feed these values without changing the backend measurement vocabulary.

### Regression evidence

`diffOperationBudget()` compares two snapshots and reports request, statement, failure, and row deltas. This lets Performance review say, for example, "latency stayed flat but this change added three D1 statements per action" rather than relying only on milliseconds.

## Required Local benchmark

CI already applies all numbered migrations to Local D1 before `npm test`.

`npm test` includes:

```text
npm run performance:validate
npm run performance:local
```

The Local smoke profile creates approximately:

- 1,000 neutral `example_resources`
- 1,000 `example_resource_changes`

The fixture uses the reserved `__perf_template_` prefix and is deleted before and after the benchmark.

The resource count is a Template workload example, not an expected business-system limit.

Additional replaceable volume views are available through the benchmark script:

- `--profile=five-year` → 5,000 example resources
- `--profile=ten-year` → 10,000 example resources
- `--profile=capacity` → 10,000 example resources

The year labels are fixture-volume views for comparing cost curves. They do not imply universal retention, growth, or transaction assumptions. Projects should override fixture volume with their own data model and NFR assumptions.

## Representative workload

The baseline measures four query shapes.

### 1. Point lookup

Lookup by `example_resources.id`.

Purpose:
- verify primary-key access remains indexed
- detect accidental replacement with a scan-oriented lookup

### 2. Status page

Read a small page ordered by `updated_at` within a status.

Purpose:
- represent a common business list-screen access pattern
- verify `idx_example_resources_status_updated` is used

### 3. Change history

Read recent history for one resource.

Purpose:
- verify resource-scoped history lookup uses an index
- represent audit/history style access

### 4. Status aggregate

Count benchmark resources by status.

Purpose:
- provide an intentionally broader aggregation workload
- record the cost instead of pretending every valid query must be a point lookup

### N+1 versus aggregate action

The benchmark also reads the same representative set in two shapes:

1. N+1: one D1 command per selected resource
2. Aggregate: one `IN (...)` query for the same selected resources

The report compares:

- HTTP/CLI request count
- D1 statement count
- SQL duration when available
- CLI wall time
- rows read/written when available

Required Local CI asserts that the N+1 form uses more D1 statements than the aggregate form. It does not require the aggregate form to win an arbitrary millisecond threshold on a shared CI runner.

## Representative authenticated API evidence

`operation-mode:local` executes the real authenticated Operation Mode control-plane API against isolated Local D1 state.

The test now records the D1 statement count for a representative authenticated GET and PATCH through the same opt-in instrumentation. This proves the measurement works across Request → Authentication → Authorization → Store → D1 rather than only inside synthetic SQL benchmark code.

The assertion intentionally does not invent a rows-read value for `first()` based queries.

## Query-plan Gate

Required CI does not fail because a Local runner takes an arbitrary number of milliseconds.

It does fail when an access path that is expected to be indexed no longer has the expected query plan.

This protects structural performance characteristics while avoiding flaky latency gates caused by shared CI runners and process startup variance.

## Example index

`migrations/0006_performance_capacity.sql` adds:

```text
idx_example_resources_status_updated
  (status, updated_at DESC, id DESC)
```

This is intentionally tied to the representative status-page query. Projects should replace or extend indexes based on their real access patterns rather than copying indexes without a corresponding workload.

## Reports

Generated reports are written under:

```text
artifacts/performance/
```

and are gitignored.

Each report contains:

- execution mode: Local or Preview
- workload profile
- resource/change row count
- iterations
- SQL duration in **milliseconds** when available
- CLI wall time in **milliseconds**
- rows read/written when available
- statement count
- query plans
- N+1 versus aggregate action budget
- optional configured threshold result

The explicit unit names exist to prevent a value such as `12 ms` from being accidentally described as `12 seconds`.

## Absolute thresholds

The Template does not hard-code an absolute latency threshold into required CI.

A Project may opt in by setting:

```text
PERF_SERVER_TARGET_MS=<project threshold>
```

When configured, only available D1 SQL-duration measurements are compared with that Project-defined target.

The threshold must come from Project NFR/SLO requirements, not from this Template.

Operation-count and row thresholds belong to the Project's `OperationBudgetThresholds`; they are similarly not fixed by the Template.

## Preview capacity benchmark

A Project with real Preview/Production D1 resources may run:

```text
.github/workflows/d1-performance-benchmark.yml
```

The workflow is `workflow_dispatch` only.

It requires the operator to type:

```text
BENCHMARK_PREVIEW
```

before any remote benchmark runs.

Default Preview capacity profile:

- 10,000 example resources
- 10,000 change rows
- three measurements per representative query

The profile is a reusable capacity probe, not a Product requirement.

## Preview safety guards

Before remote execution, the benchmark refuses to proceed when:

- the explicit confirmation is missing
- Cloudflare credentials are missing
- Preview or Production D1 ID is missing
- either D1 ID is still a Template placeholder
- the IDs are malformed
- Preview and Production IDs are identical

Remote target arguments are always:

```text
--remote --preview
```

The benchmark script does not provide a Production target mode.

## Fixture lifecycle

Benchmark data is isolated by the `__perf_template_` prefix.

Execution performs:

1. pre-clean old benchmark rows
2. generate/load the selected fixture
3. capture query plans
4. execute representative queries
5. compare N+1 and aggregate action cost
6. write aggregate reports
7. delete benchmark rows in `finally`

Cleanup is best effort if the benchmark fails. If a remote run fails during cleanup, operators must verify Preview state before rerunning.

## External Resource Budget

Remote performance testing consumes a different budget from GitHub Actions runner time.

Before running the Preview benchmark, check:

- current D1 read/write allowance or billing impact
- account-wide/shared quota impact
- expected fixture writes
- repeated-query reads
- whether another Project is using the same account quota

For this reason the Preview benchmark is not triggered by:

- pull request
- push
- schedule

and is not part of required CI.

## Interpreting Local vs Preview evidence

Local benchmark proves:

- migration/index exists
- workload is executable
- expected query plan is present
- result assertions hold
- metric/report pipeline works
- N+1 statement/request amplification is visible

It does **not** prove Production latency or Production daily quota consumption.

Preview benchmark adds real remote D1 execution evidence, but still does not automatically establish a Production SLA. Production geography, workload concurrency, Worker logic, network path, real data distribution, and daily action frequency may differ.

## Verification status

This Template can verify the Local benchmark, representative Local API operation counts, and the safety contract in normal CI.

A successful remote Preview benchmark must only be claimed after a provisioned Project executes the manual workflow and records its actual run evidence.

## Out of scope

This foundation does not implement:

- Production benchmark
- stress/load/soak testing
- browser Core Web Vitals
- Worker concurrency saturation testing
- automatic query optimization
- Cloudflare billing optimization
- distributed tracing
- universal SLA/SLO or daily quota targets

Those require Project-specific workload and risk decisions.
