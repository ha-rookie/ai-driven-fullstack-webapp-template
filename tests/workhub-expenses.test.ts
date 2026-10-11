import assert from "node:assert/strict";
import test from "node:test";
import {
  validateExpense,
  WorkhubExpenseError,
} from "../src/reference/workhub/expenses";

const valid = {
  purpose: "東京出張の交通費",
  lines: [
    { expenseDate: "2026-10-20", category: "TRANSPORT", description: "名古屋から東京", amountYen: 11000 },
    { expenseDate: "2026-10-21", category: "LODGING", description: "ホテル", amountYen: 8500 },
  ],
};

test("expense settlement totals integer JPY on the server and preserves line details", () => {
  const result = validateExpense({ ...valid, totalYen: 1 });
  assert.equal(result.totalYen, 19500);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].category, "TRANSPORT");
  assert.equal(result.travelRequestId, null);
});

test("expense validation rejects decimals, malformed dates, excess and incorrect categories", () => {
  const invalidCases = [
    { ...valid, lines: [{ ...valid.lines[0], amountYen: 11000.5 }] },
    { ...valid, lines: [{ ...valid.lines[0], amountYen: -4 }] },
    { ...valid, lines: [{ ...valid.lines[0], amountYen: 1000001 }] },
    { ...valid, lines: [{ ...valid.lines[0], expenseDate: "2026-02-30" }] },
    { ...valid, lines: [{ ...valid.lines[0], category: "SECRET" }] },
    { ...valid, lines: [{ ...valid.lines[0], description: "" }] },
    { ...valid, lines: [] },
    { ...valid, lines: Array.from({ length: 6 }, () => valid.lines[0]) },
    { ...valid, lines: [{ ...valid.lines[0], amountYen: 1000000 }, { ...valid.lines[1], amountYen: 1000000 }, { ...valid.lines[1], amountYen: 1 }] },
    { ...valid, purpose: "x".repeat(201) },
    { ...valid, travelRequestId: "x".repeat(257) },
  ];
  for (const input of invalidCases) {
    assert.throws(
      () => validateExpense(input),
      (error: unknown) => error instanceof WorkhubExpenseError && error.code === "invalid_input",
    );
  }
});
