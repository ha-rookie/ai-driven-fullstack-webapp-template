# Application Metrics / Alert Policy Baseline

## Purpose

This baseline separates four concerns that are easy to mix together:

1. **Application Log** — diagnostic events and request correlation
2. **Runtime Metrics** — numeric observations suitable for aggregation
3. **Alert Policy Evaluation** — state transition from observations to alert candidates
4. **Notification / Export** — Slack, email, Pager, SaaS exporters (OPTIONAL #105)

No external monitoring vendor, fixed SLO or fixed threshold is required by Template Core.

## Metrics contract

`ApplicationMetricsRecorder` emits provider-neutral samples for:

- `http_request_count`
- `http_request_duration_ms`
- `http_error_count`
- `dependency_failure_count`

The Worker API boundary records request count/latency/error samples for API requests. Known D1 dependency failures at readiness/authentication boundaries also emit dependency-failure samples.

### Low-cardinality rules

Aggregation labels are deliberately constrained:

- `environment`
- `component`
- declared `route`
- normalized HTTP `method`
- HTTP `statusClass`
- declared `errorCategory`
- declared `dependency` / `operation`

Dimension values accept only a short identifier vocabulary. Raw URLs such as `/api/users/123`, free-form messages and whitespace-bearing user input are rejected as dimensions.

Do **not** use these as standard metric labels:

- user ID / account ID
- email address
- raw route/path parameter
- request ID
- session/token/secret
- free-form exception message
- request/response body

`requestId` is allowed only in the separate `correlation` context. This keeps log/metric tracing possible without turning request IDs into high-cardinality aggregation labels.

## Environment identity

Metrics support `local`, `test`, `preview`, `production` and `unknown`.

Projects should explicitly provide `RUNTIME_ENVIRONMENT` when wiring a deployed Worker. If the binding is absent or invalid, the recorder emits `unknown`; it does **not** guess that a deployment is Preview or Production.

This matters because alert policies are environment-specific. An `unknown` observation does not satisfy a Preview/Production policy.

## Sink boundary

`ApplicationMetricSink` receives safe structured samples. The default baseline sink writes one JSON line to the runtime console.

A sink failure never changes the HTTP/business result. External time-series backends or OpenTelemetry/SaaS exporters belong to OPTIONAL #105.

## Alert policy contract

`evaluateAlertPolicy(policy, state, observation)` is a **pure state transition**:

```text
previous state + policy + observation
                 ↓
          next state + decision
```

It supports:

- metric threshold conditions
- health unavailable conditions
- required consecutive breaches
- minimum breach duration
- Preview/Production policy separation
- cooldown/repeat candidates
- `trigger` / `repeat` / `resolve` events
- maintenance/read-only suppression
- bounded suppression duration so a persistent serious failure cannot stay hidden forever
- safe requestId/component/signal context

Template Core does not persist alert state. The caller or monitoring adapter owns persistence. This is intentional: Cloudflare Workers and other serverless runtimes may execute observations on different isolates, so process-local memory must not be treated as authoritative duration/cooldown state.

## Suppression semantics

A Project may suppress a matured condition during `maintenance` or `read-only` mode, but it must set `maxDurationMs`.

When the same breach survives beyond that maximum duration, the evaluator can emit a trigger even while the operation mode remains active. This prevents maintenance suppression from hiding a persistent dependency/runtime failure indefinitely.

## Notification boundary

An `alert_candidate` is not a sent notification.

Core intentionally does not decide:

- Slack vs email vs Pager
- on-call roster
- escalation schedule
- external monitoring vendor
- Product-specific SLO/threshold values

Those belong to Project configuration and OPTIONAL export/notification adapters.

## Validation baseline

Tests cover:

- low-cardinality metric labels and request correlation separation
- latency/count/error/dependency samples
- sink failure isolation and idempotent request completion
- actual Worker HTTP-boundary metric emission
- threshold + consecutive + duration maturation
- cooldown/repeat behavior
- Preview/Production isolation
- maintenance/read-only suppression expiry
- health-based alert conditions
- resolve events
- unsafe context rejection and monotonic observation ordering
