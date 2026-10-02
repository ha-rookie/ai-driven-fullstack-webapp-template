import assert from "node:assert/strict";
import test from "node:test";

import {
  correctPersistedDecision,
  createPersistedDecision,
  loadPersistedDecision,
  type DecisionEvaluator,
  type PersistedDecision,
} from "../src/infrastructure/d1-persisted-decision-store";

const fakeDb = () => {
  const rows = new Map<string, PersistedDecision>();

  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (/INSERT INTO example_resource_decisions/.test(sql)) {
                const [resourceId, sourceSnapshot, decisionValue, ruleVersion, decidedAt, decidedBy] = values as string[];
                if (rows.has(resourceId)) throw new Error("UNIQUE constraint failed");
                rows.set(resourceId, {
                  resourceId,
                  sourceSnapshot,
                  decisionValue,
                  ruleVersion,
                  decisionVersion: 1,
                  decidedAt,
                  decidedBy,
                });
                return { meta: { changes: 1 } } as D1Result<unknown>;
              }

              if (/UPDATE example_resource_decisions/.test(sql)) {
                const [sourceSnapshot, decisionValue, ruleVersion, decidedAt, decidedBy, resourceId, expectedVersion] = values as [string, string, string, string, string, string, number];
                const current = rows.get(resourceId);
                if (!current || current.decisionVersion !== Number(expectedVersion)) {
                  return { meta: { changes: 0 } } as D1Result<unknown>;
                }
                rows.set(resourceId, {
                  ...current,
                  sourceSnapshot,
                  decisionValue,
                  ruleVersion,
                  decisionVersion: current.decisionVersion + 1,
                  decidedAt,
                  decidedBy,
                });
                return { meta: { changes: 1 } } as D1Result<unknown>;
              }

              throw new Error("unexpected run() call");
            },
            async first<T>() {
              if (!/FROM example_resource_decisions/.test(sql)) {
                throw new Error("unexpected first() call");
              }
              const [resourceId] = values as string[];
              const row = rows.get(resourceId);
              if (!row) return null;
              return {
                resourceId: row.resourceId,
                sourceSnapshot: row.sourceSnapshot,
                decisionValue: row.decisionValue,
                ruleVersion: row.ruleVersion,
                decisionVersion: row.decisionVersion,
                decidedAt: row.decidedAt,
                decidedBy: row.decidedBy,
              } as T;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, rows };
};

const countingEvaluator = (fn: (source: string, ruleVersion: string) => string) => {
  let calls = 0;
  const evaluator: DecisionEvaluator = {
    decide({ sourceSnapshot, ruleVersion }) {
      calls += 1;
      return fn(sourceSnapshot, ruleVersion);
    },
  };
  return { evaluator, calls: () => calls };
};

test("read returns the persisted fact without invoking current decision logic", async () => {
  const { db } = fakeDb();
  const initial = countingEvaluator((_source, rule) => `approved-by-${rule}`);

  await createPersistedDecision(db, initial.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: '{"score":80}',
    ruleVersion: "rule-v1",
    decidedAt: "2026-10-02T00:00:00.000Z",
    decidedBy: "user-1",
  });
  assert.equal(initial.calls(), 1);

  const currentLogic = countingEvaluator(() => "rejected-by-new-rule");
  const loaded = await loadPersistedDecision(db, "resource-1");

  assert.equal(currentLogic.calls(), 0, "read path must not require or invoke an evaluator");
  assert.equal(loaded?.decisionValue, "approved-by-rule-v1");
  assert.equal(loaded?.ruleVersion, "rule-v1");
  assert.equal(loaded?.sourceSnapshot, '{"score":80}');
});

test("correction updates source snapshot and persisted decision in the same mutation", async () => {
  const { db } = fakeDb();
  const initial = countingEvaluator(() => "review");
  await createPersistedDecision(db, initial.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: '{"score":50}',
    ruleVersion: "rule-v1",
    decidedAt: "2026-10-02T00:00:00.000Z",
    decidedBy: "user-1",
  });

  const corrected = countingEvaluator((source, rule) => `${rule}:${source.includes("90") ? "accept" : "review"}`);
  const result = await correctPersistedDecision(db, corrected.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: '{"score":90}',
    ruleVersion: "rule-v2",
    expectedDecisionVersion: 1,
    decidedAt: "2026-10-02T01:00:00.000Z",
    decidedBy: "user-2",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(corrected.calls(), 1);
  assert.equal(result.decision.sourceSnapshot, '{"score":90}');
  assert.equal(result.decision.decisionValue, "rule-v2:accept");
  assert.equal(result.decision.ruleVersion, "rule-v2");
  assert.equal(result.decision.decisionVersion, 2);
  assert.equal(result.decision.decidedBy, "user-2");
});

test("stale correction is rejected without replacing the persisted fact", async () => {
  const { db } = fakeDb();
  const evaluator = countingEvaluator(() => "accept");
  await createPersistedDecision(db, evaluator.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: "source-v1",
    ruleVersion: "rule-v1",
    decidedAt: "2026-10-02T00:00:00.000Z",
    decidedBy: "user-1",
  });

  const first = await correctPersistedDecision(db, evaluator.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: "source-v2",
    ruleVersion: "rule-v2",
    expectedDecisionVersion: 1,
    decidedAt: "2026-10-02T01:00:00.000Z",
    decidedBy: "user-2",
  });
  assert.equal(first.ok, true);

  const stale = await correctPersistedDecision(db, evaluator.evaluator, {
    resourceId: "resource-1",
    sourceSnapshot: "stale-source",
    ruleVersion: "rule-v3",
    expectedDecisionVersion: 1,
    decidedAt: "2026-10-02T02:00:00.000Z",
    decidedBy: "user-3",
  });

  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.reason, "stale");
  assert.equal(stale.current?.sourceSnapshot, "source-v2");
  assert.equal(stale.current?.ruleVersion, "rule-v2");
  assert.equal(stale.current?.decisionVersion, 2);
});
