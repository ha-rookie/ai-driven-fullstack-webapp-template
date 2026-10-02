import assert from "node:assert/strict";
import test from "node:test";

import { instrumentD1Database } from "../src/infrastructure/d1-operation-budget";
import {
  OperationBudgetRecorder,
  assessOperationBudget,
  diffOperationBudget,
} from "../src/shared/performance/operation-budget";

const result = (rowsRead: number, rowsWritten: number) => ({
  success: true,
  results: [],
  meta: { rows_read: rowsRead, rows_written: rowsWritten },
});

const fakeDb = () => {
  const statement = {
    bind() { return this; },
    async first<T>() { return { id: "row-1" } as T; },
    async all<T>() { return result(4, 0) as unknown as D1Result<T>; },
    async run<T>() { return result(1, 2) as unknown as D1Result<T>; },
    async raw<T>() { return [["row-1"]] as unknown as T[]; },
  };
  const session = {
    prepare() { return statement as unknown as D1PreparedStatement; },
    async batch<T>() { return [result(2, 0)] as unknown as D1Result<T>[]; },
    getBookmark() { return "bookmark"; },
  };
  return {
    prepare() { return statement as unknown as D1PreparedStatement; },
    async batch<T>() { return [result(3, 0), result(1, 1)] as unknown as D1Result<T>[]; },
    async exec() { return { count: 1, duration: 1 }; },
    async dump() { return new ArrayBuffer(0); },
    withSession() { return session as unknown as D1DatabaseSession; },
  } as unknown as D1Database;
};

test("operation budget separates foreground, background, duplicate and D1 cost", () => {
  const recorder = new OperationBudgetRecorder("screen.bootstrap");
  recorder.recordHttpRequest();
  recorder.recordHttpRequest("background");
  recorder.recordHttpRequest("background", true);
  recorder.recordD1({ statements: 2, rowsRead: 10, rowsWritten: 1 });

  assert.deepEqual(recorder.snapshot(), {
    actionId: "screen.bootstrap",
    httpRequests: 3,
    backgroundRequests: 2,
    duplicateRequests: 1,
    d1Statements: 2,
    d1Failures: 0,
    rowsRead: 10,
    rowsWritten: 1,
    metadataUnavailableEvents: 0,
  });
});

test("project thresholds and daily forecast are explicit and unknown row metadata is not treated as zero", () => {
  const recorder = new OperationBudgetRecorder("save.resource");
  recorder.recordHttpRequest();
  recorder.recordD1({ statements: 3, rowsRead: null, rowsWritten: null });

  const assessment = assessOperationBudget(recorder.snapshot(), {
    maxHttpRequests: 2,
    maxD1Statements: 4,
    maxRowsRead: 100,
    expectedActionsPerDay: 500,
  });
  assert.equal(assessment.ok, false);
  assert.ok(assessment.failures.includes("rowsRead unavailable"));
  assert.deepEqual(assessment.dailyForecast, {
    actions: 500,
    httpRequests: 500,
    d1Statements: 1500,
    rowsRead: null,
    rowsWritten: null,
  });
});

test("budget diff exposes request and statement regressions", () => {
  const baseline = new OperationBudgetRecorder("list.refresh");
  baseline.recordHttpRequest();
  baseline.recordD1({ statements: 1, rowsRead: 25, rowsWritten: 0 });
  const current = new OperationBudgetRecorder("list.refresh");
  current.recordHttpRequest();
  current.recordHttpRequest("background", true);
  current.recordD1({ statements: 4, rowsRead: 100, rowsWritten: 0 });

  assert.deepEqual(diffOperationBudget(current.snapshot(), baseline.snapshot()), {
    actionId: "list.refresh",
    httpRequests: 1,
    backgroundRequests: 1,
    duplicateRequests: 1,
    d1Statements: 3,
    d1Failures: 0,
    rowsRead: 75,
    rowsWritten: 0,
  });
});

test("instrumented D1 preserves statement results while recording available metadata", async () => {
  const recorder = new OperationBudgetRecorder("api.read");
  const db = instrumentD1Database(fakeDb(), recorder);

  const all = await db.prepare("SELECT hidden").bind("secret-bind").all();
  assert.equal(all.success, true);
  await db.prepare("UPDATE hidden").run();

  assert.deepEqual(recorder.snapshot(), {
    actionId: "api.read",
    httpRequests: 0,
    backgroundRequests: 0,
    duplicateRequests: 0,
    d1Statements: 2,
    d1Failures: 0,
    rowsRead: 5,
    rowsWritten: 2,
    metadataUnavailableEvents: 0,
  });
});

test("first/raw/exec keep operation count but mark unavailable row metadata instead of inventing zero", async () => {
  const recorder = new OperationBudgetRecorder("api.mixed");
  const db = instrumentD1Database(fakeDb(), recorder);
  assert.deepEqual(await db.prepare("SELECT hidden").first(), { id: "row-1" });
  await db.prepare("SELECT hidden").raw();
  await db.exec("PRAGMA hidden");

  const snapshot = recorder.snapshot();
  assert.equal(snapshot.d1Statements, 3);
  assert.equal(snapshot.rowsRead, null);
  assert.equal(snapshot.rowsWritten, null);
  assert.equal(snapshot.metadataUnavailableEvents, 3);
});

test("batch and session calls are instrumented without changing returned values", async () => {
  const recorder = new OperationBudgetRecorder("api.batch");
  const db = instrumentD1Database(fakeDb(), recorder);
  const one = db.prepare("SELECT one");
  const two = db.prepare("SELECT two");
  const batch = await db.batch([one, two]);
  assert.equal(batch.length, 2);

  const session = db.withSession("first-unconstrained");
  const sessionBatch = await session.batch([session.prepare("SELECT session")]);
  assert.equal(sessionBatch.length, 1);

  const snapshot = recorder.snapshot();
  assert.equal(snapshot.d1Statements, 3);
  assert.equal(snapshot.rowsRead, 6);
  assert.equal(snapshot.rowsWritten, 1);
});

test("instrumentation rethrows dependency failures and records them", async () => {
  const recorder = new OperationBudgetRecorder("api.failure");
  const base = fakeDb();
  const failing = {
    ...base,
    prepare() {
      return {
        bind() { return this; },
        async all() { throw new Error("database unavailable"); },
      } as unknown as D1PreparedStatement;
    },
  } as D1Database;
  const db = instrumentD1Database(failing, recorder);

  await assert.rejects(db.prepare("SELECT hidden").all(), /database unavailable/);
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.d1Statements, 1);
  assert.equal(snapshot.d1Failures, 1);
  assert.equal(snapshot.rowsRead, null);
});
