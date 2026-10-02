# Persisted Decision Integrity

## Purpose

Business decisions that were final at write time must not silently change because today's rule code produces a different answer.

This contract applies only when a derived value is itself a business fact that requires reproducibility, auditability, or historical meaning. Display-only calculations should continue to be derived on read when persistence adds no semantic value.

## Persisted fact vs derived-on-read

Use a persisted fact when the value represents a final decision or result, such as an approval outcome, ranking, finalized amount, closing result, classification, or risk decision whose meaning depends on the rule in force at the time.

Use derived-on-read when the value is presentation-only, inexpensive to recompute, and is intentionally expected to reflect current logic.

Do not materialize every derived value by default.

## Reference schema

`migrations/0014_persisted_decision_integrity.sql` adds the neutral `example_resource_decisions` reference table:

```text
resource_id
source_snapshot
decision_value
rule_version
decision_version
decided_at
decided_by
```

The Template does not define Product-specific decision vocabulary. `decision_value` and `rule_version` remain bounded strings supplied by the Project.

## Write contract

A persisted decision is created by:

1. capturing the bounded source snapshot used for the decision
2. recording the rule version applied at that time
3. evaluating the decision exactly at the write boundary
4. persisting source snapshot, decision value, rule version, actor, and timestamp together

The source snapshot is evidence of what was evaluated; it is not a command to re-evaluate later reads.

## Read contract

A read path returns the stored `decision_value` as the authoritative fact.

The reference `loadPersistedDecision(...)` function deliberately accepts no evaluator. A caller therefore cannot accidentally substitute current rule logic for the historical persisted fact through the normal read API.

Changing application rules must not rewrite historical persisted decisions implicitly.

## Correction contract

A correction is a new write decision, not a display-time recalculation.

When a source value was wrong or an approved correction is required, source snapshot, decision value, rule version, actor, timestamp, and `decision_version` are updated in one guarded mutation. The reference store uses optimistic concurrency through `expectedDecisionVersion` so a stale correction cannot overwrite a newer correction.

Projects that must also correct source data in another table should keep that source mutation and persisted-decision mutation in the same database transaction/batch boundary.

## Migration and backfill

Do not infer an ambiguous historical decision merely because today's rule can calculate one.

Safe migration choices are:

- migrate an already authoritative historical value as-is
- backfill only when the historical source and historical rule are both known and reproducible
- leave the persisted fact absent when historical meaning cannot be established safely
- require explicit Human correction when business ownership is needed

A migration must not convert uncertainty into a fabricated historical fact.

## Audit and reproducibility

At minimum retain:

- the persisted decision/result
- source snapshot or stable source reference sufficient for reproduction
- rule/version identity when rule changes can alter meaning
- actor and decision time
- concurrency/version metadata when corrections are allowed

This is separate from Event Sourcing. The Template does not require storing every intermediate computation or every past state.

## Reference tests

`tests/persisted-decision-integrity.test.ts` verifies that:

- evaluation happens at write time
- read returns the persisted value without invoking current decision logic
- a rule change does not silently change historical reads
- correction replaces source snapshot and decision in the same mutation
- stale corrections fail closed
