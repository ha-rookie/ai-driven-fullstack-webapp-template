# Health Contract

## Purpose

Separate process/runtime liveness from dependency readiness so operations and smoke verification do not treat a database outage as process death.

## Endpoints

| Endpoint | Meaning | Dependency check | Success | Failure |
| --- | --- | --- | --- | --- |
| `GET /api/health/live` | Worker/runtime is responding | None | `200 {"status":"ok","component":"runtime"}` | Runtime/process failure is observed as request failure |
| `GET /api/health/ready` | Application is ready to serve dependency-backed traffic | D1 `SELECT 1` | `200 {"status":"ok","component":"database"}` | `503 {"status":"unavailable","component":"database"}` |
| `GET /api/health` | Compatibility alias for liveness | None | Same as liveness | Same as liveness |
| `GET /api/health/database` | Compatibility alias for readiness | D1 `SELECT 1` | Same as readiness | Same as readiness |

## Security boundary

Health responses expose only the bounded status vocabulary and component name. They must not expose:

- exception messages or stack traces
- D1 identifiers, names, SQL details, row data, or schema detail
- user/session/authentication information
- secrets or environment configuration

Dependency failures may be recorded through the structured application logger, but external responses remain generic.

## Operational interpretation

- Liveness failure means the runtime itself cannot answer normally
- Readiness failure means the runtime is alive but a required dependency is unavailable
- A readiness failure must not be converted into liveness failure
- Health endpoints are low-cost probes, not load tests or full end-to-end verification
- Product-specific SLO thresholds and alert policy remain Project/Organization responsibilities

## Production smoke connection

Production Smoke Verification should use `/api/health/live` and `/api/health/ready` as separate checks. A failed readiness check is a release Stop Condition, but it should still be reported distinctly from a liveness failure.
