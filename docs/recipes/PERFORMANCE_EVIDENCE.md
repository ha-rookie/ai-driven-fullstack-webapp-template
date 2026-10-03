# Recipe: Performance Evidence

## Inputs
- performance question being answered
- target layer: D1 query / frontend build+browser / HTTP load
- environment: Local / Preview
- Project-defined threshold if one exists
- workload / dataset / representative route

Read `../PERFORMANCE_CAPACITY.md`, `../FRONTEND_PERFORMANCE.md`, `../LOAD_STRESS_SOAK.md`, and `../instructions/performance-resource-budget.md` as applicable.

## Stop Conditions
Stop when:
- a Production load target is proposed
- Preview and Production origins/resources are not proven separate
- workload is write-heavy/destructive without a dedicated safety design
- a universal SLA/SLO is being invented for the Template
- a Local/browser value is about to be reported as Production performance
- dataset or route is too synthetic to answer the stated question

## Steps
1. State the performance question and target layer
2. Choose the smallest evidence path that answers it
3. For D1 query changes, capture query plan and bounded Local benchmark first
4. For frontend changes, build Production assets and capture size/browser evidence
5. For HTTP load, use bounded read-only Local profile first
6. Run Preview benchmark/load only through explicit Human-triggered paths
7. Compare against Project threshold only when the Project actually defined one
8. Store evidence with environment and exact SHA

## Validation
Common entrypoints:

```bash
npm run performance:local
npm run performance:frontend:bundle
npm run performance:frontend:browser
npm run performance:http:local -- --profile smoke --scenario mixed
```

Preview operations stay separate and Human-triggered.

## Evidence
Record:
- exact SHA and environment
- workload/profile/dataset
- bundle size / LCP / CLS / request count where relevant
- latency p50/p95/p99 / throughput / error rate where relevant
- query plan where relevant
- threshold status: configured / not-configured / pass / fail

## Do Not
- hard-code Template-wide SLO values
- hide `not-configured` as pass
- load test Production
- use Remote high-load tests in required PR CI
- compare metrics from different datasets/environments as if directly equivalent
- infer INP or another unavailable metric without a representative interaction
