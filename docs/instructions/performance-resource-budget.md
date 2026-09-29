# Performance / External Resource Budget Scoped Instruction

## Applies When

Use this Instruction for D1 benchmark, query-plan validation, fixture sizing, remote Preview capacity tests, or quota/cost-sensitive performance work.

## Scope Hints

- performance benchmark scripts/workflows
- representative fixtures
- `EXPLAIN QUERY PLAN`
- D1 rows read/written / statement count
- Preview benchmark configuration
- performance evidence and thresholds

## Sources to Read

- `../PERFORMANCE_CAPACITY.md`
- `../DATA_DESIGN.md`
- applicable Common Template testing / cloud infrastructure Instructions

## Rules

- Keep required PR CI Local-first and use it to prove migration/index presence, workload correctness, and expected access paths
- Separate SQL execution time from CLI/network wall time; preserve units explicitly
- Record resource consumption (rows read/written, statement count when available) together with timing evidence
- Tie every Template index/performance assertion to a representative workload
- Use Project-defined SLO/NFR values for absolute thresholds; do not invent a universal Template latency target
- Run remote Preview benchmark only through explicit Human-triggered flow with Preview/Production separation guards
- Before a remote run, estimate fixture writes, repeated-query reads, shared quota/billing impact, and whether retained fixtures are cheaper/safer than regeneration
- Keep benchmark fixture lifecycle separate from benchmark result interpretation

## Do Not

- Do not run remote load/capacity tests on every PR, push, or schedule by default
- Do not provide a Production benchmark target as the baseline
- Do not describe Local or Preview evidence as Production SLA proof
- Do not call CLI wall time “database execution time”
- Do not fail required CI on arbitrary Local-runner millisecond thresholds
- Do not repeatedly clean/reseed large remote fixtures without considering quota/cost and reuse
- Do not copy example fixture size/indexes into Product requirements mechanically

## Validation / Evidence

- representative query results are correct
- expected indexed access paths are asserted where required
- report identifies Local vs Preview mode and measurement units
- SQL duration and CLI wall time are separated
- rows read/written and statement count are recorded when available
- remote benchmark proves explicit Preview target, rejects Production/placeholder/mismatched configuration, and records quota/cost context
- fixture cleanup/reuse decision is documented when remote data lifecycle is material
