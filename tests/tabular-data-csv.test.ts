import assert from "node:assert/strict";
import test from "node:test";

import {
  commitCsvImportPreview,
  createCsvExportStream,
  CsvFormulaInjectionError,
  parseAndValidateCsvImport,
  recommendCsvImportExecution,
  type CsvImportSchema,
} from "../src/shared/tabular-data";
import { createAuthorizedCsvExportResponse } from "../src/worker/http/csv-export";

interface PersonRow {
  readonly id: number;
  readonly name: string;
  readonly note: string;
}

const schema: CsvImportSchema<PersonRow> = {
  columns: [
    {
      key: "id",
      header: "id",
      required: true,
      parse: (raw) => {
        const value = Number(raw);
        return Number.isSafeInteger(value) && value > 0
          ? { ok: true, value }
          : { ok: false, code: "invalid_id", message: "id must be a positive integer" };
      },
    },
    { key: "name", header: "name", required: true },
    { key: "note", header: "note" },
  ],
  build: (values) => ({
    ok: true,
    value: {
      id: values.id as number,
      name: values.name as string,
      note: (values.note as string | undefined) ?? "",
    },
  }),
};

const importPolicy = {
  maxBytes: 16 * 1024,
  maxRows: 10,
} as const;

const readStreamText = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  new Response(stream).text();

test("CSV import parses quoted comma, newline and escaped quote with injected schema", async () => {
  const csv = 'id,name,note\r\n1,Alice,"hello, world"\r\n2,Bob,"line 1\nline 2 and ""quote"""\r\n';
  const result = await parseAndValidateCsvImport(csv, schema, importPolicy);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.preview.summary, {
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    warnings: 0,
  });
  assert.deepEqual(result.preview.rows[0]?.value, {
    id: 1,
    name: "Alice",
    note: "hello, world",
  });
  assert.deepEqual(result.preview.rows[1]?.value, {
    id: 2,
    name: "Bob",
    note: 'line 1\nline 2 and "quote"',
  });
  assert.ok(result.preview.bytesRead > 0);
});

test("CSV import returns row-numbered validation issues and never silently skips invalid rows", async () => {
  const result = await parseAndValidateCsvImport(
    "id,name,note\n1,Alice,ok\nnot-a-number,Bob,bad\n3,,missing-name\n",
    schema,
    importPolicy,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.preview.rows.length, 3);
  assert.equal(result.preview.summary.invalidRows, 2);
  assert.equal(result.preview.rows[1]?.rowNumber, 3);
  assert.deepEqual(result.preview.rows[1]?.issues.map((issue) => issue.code), ["invalid_id"]);
  assert.equal(result.preview.rows[2]?.rowNumber, 4);
  assert.deepEqual(result.preview.rows[2]?.issues.map((issue) => issue.code), ["required_value_missing"]);
});

test("CSV import rejects duplicate, unknown and missing required headers", async () => {
  const duplicate = await parseAndValidateCsvImport("id,id,name\n1,1,Alice\n", schema, importPolicy);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.ok ? undefined : duplicate.code, "duplicate_header");

  const unknown = await parseAndValidateCsvImport("id,name,note,secret\n1,Alice,ok,x\n", schema, importPolicy);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.ok ? undefined : unknown.code, "unknown_column");

  const missing = await parseAndValidateCsvImport("id,note\n1,ok\n", schema, importPolicy);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok ? undefined : missing.code, "missing_required_column");
});

test("CSV import is bounded by actual bytes and data row count", async () => {
  const tooLarge = await parseAndValidateCsvImport(
    "id,name,note\n1,Alice,abcdefghijklmnopqrstuvwxyz\n",
    schema,
    { ...importPolicy, maxBytes: 20 },
  );
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.ok ? undefined : tooLarge.code, "payload_too_large");

  const tooMany = await parseAndValidateCsvImport(
    "id,name,note\n1,A,a\n2,B,b\n",
    schema,
    { ...importPolicy, maxRows: 1 },
  );
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.ok ? undefined : tooMany.code, "too_many_rows");
});

test("CSV import rejects invalid UTF-8, malformed quotes, empty file and header-only by default", async () => {
  const invalidUtf8 = await parseAndValidateCsvImport(
    new Uint8Array([0xff, 0xfe, 0xfd]),
    schema,
    importPolicy,
  );
  assert.equal(invalidUtf8.ok, false);
  assert.equal(invalidUtf8.ok ? undefined : invalidUtf8.code, "invalid_utf8");

  const malformed = await parseAndValidateCsvImport(
    'id,name,note\n1,"Alice,broken\n',
    schema,
    importPolicy,
  );
  assert.equal(malformed.ok, false);
  assert.equal(malformed.ok ? undefined : malformed.code, "malformed_csv");

  const empty = await parseAndValidateCsvImport("", schema, importPolicy);
  assert.equal(empty.ok, false);
  assert.equal(empty.ok ? undefined : empty.code, "empty_file");

  const headerOnly = await parseAndValidateCsvImport("id,name,note\n", schema, importPolicy);
  assert.equal(headerOnly.ok, false);
  assert.equal(headerOnly.ok ? undefined : headerOnly.code, "header_only");
});

test("dry-run is separate from commit and all-or-nothing rejects invalid preview without calling commit", async () => {
  const parsed = await parseAndValidateCsvImport(
    "id,name,note\n1,Alice,ok\nbad,Bob,no\n",
    schema,
    importPolicy,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  let commitCalled = false;
  const result = await commitCsvImportPreview(parsed.preview, {
    mode: "all_or_nothing",
    commit: async () => {
      commitCalled = true;
      return "committed";
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, "preview_has_errors");
  assert.equal(commitCalled, false);
});

test("partial commit is explicit, reports skipped rows and passes idempotency context", async () => {
  const parsed = await parseAndValidateCsvImport(
    "id,name,note\n1,Alice,ok\nbad,Bob,no\n3,Carol,ok\n",
    schema,
    importPolicy,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const result = await commitCsvImportPreview(parsed.preview, {
    mode: "partial",
    idempotencyKey: "import-2026-10-03",
    revalidate: ({ value }) => value.id === 3
      ? [{ code: "duplicate_business_key", message: "already exists" }]
      : [],
    commit: async (rows, context) => ({
      ids: rows.map((row) => row.value.id),
      mode: context.mode,
      idempotencyKey: context.idempotencyKey,
    }),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.result, {
    ids: [1],
    mode: "partial",
    idempotencyKey: "import-2026-10-03",
  });
  assert.deepEqual(result.committedRowNumbers, [2]);
  assert.deepEqual(result.skippedRowNumbers, [3, 4]);
  assert.equal(result.revalidationIssues[0]?.rowNumber, 4);
});

test("commit-time revalidation can stop all-or-nothing import before persistence", async () => {
  const parsed = await parseAndValidateCsvImport(
    "id,name,note\n1,Alice,ok\n2,Bob,ok\n",
    schema,
    importPolicy,
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  let commitCalled = false;
  const result = await commitCsvImportPreview(parsed.preview, {
    mode: "all_or_nothing",
    revalidate: ({ value }) => value.id === 2
      ? [{ code: "changed_since_preview", message: "record changed" }]
      : [],
    commit: async () => {
      commitCalled = true;
      return undefined;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, "revalidation_failed");
  assert.equal(commitCalled, false);
});

test("large imports can be routed to an Async Job boundary without depending on a job provider", () => {
  assert.equal(
    recommendCsvImportExecution(
      { declaredBytes: 10_000 },
      { asyncWhenBytesAtLeast: 8_000, asyncWhenRowsAtLeast: 1_000 },
    ),
    "async_job",
  );
  assert.equal(
    recommendCsvImportExecution(
      { declaredBytes: 1_000, rowCount: 20 },
      { asyncWhenBytesAtLeast: 8_000, asyncWhenRowsAtLeast: 1_000 },
    ),
    "synchronous",
  );
});

test("CSV export streams selected fields and neutralizes spreadsheet formula injection", async () => {
  const rows = [
    { id: 1, name: "Alice", internalSecret: "never-export", comment: "=HYPERLINK(\"https://evil.test\")" },
    { id: 2, name: "Bob, Jr.", internalSecret: "never-export-2", comment: "normal" },
  ];
  let completedRows = -1;

  const stream = createCsvExportStream(
    rows,
    [
      { header: "id", select: (row) => row.id },
      { header: "name", select: (row) => row.name },
      { header: "comment", select: (row) => row.comment },
    ],
    { formulaProtection: "prefix_single_quote" },
    ({ rowCount }) => { completedRows = rowCount; },
  );

  const text = await readStreamText(stream);
  assert.equal(
    text,
    "id,name,comment\r\n1,Alice,\'=HYPERLINK(\"\"https://evil.test\"\")\r\n2,\"Bob, Jr.\",normal\r\n",
  );
  assert.equal(text.includes("internalSecret"), false);
  assert.equal(text.includes("never-export"), false);
  assert.equal(completedRows, 2);
});

test("CSV export can reject formula-looking untrusted cells instead of escaping them", async () => {
  const stream = createCsvExportStream(
    [{ value: " @SUM(A1:A2)" }],
    [{ header: "value", select: (row) => row.value }],
    { formulaProtection: "reject" },
  );

  await assert.rejects(() => readStreamText(stream), CsvFormulaInjectionError);
});

test("authorized CSV export checks access before creating rows and returns private safe headers", async () => {
  let rowsCreated = false;
  const denied = await createAuthorizedCsvExportResponse({
    request: new Request("https://example.test/api/export"),
    requestId: "req-denied",
    filename: "顧客一覧.csv",
    authorize: async () => ({
      allowed: false,
      status: 403,
      code: "forbidden",
      message: "Access denied",
    }),
    rows: () => {
      rowsCreated = true;
      return [];
    },
    columns: [{ header: "id", select: (row: { id: number }) => row.id }],
    policy: { formulaProtection: "prefix_single_quote" },
  });

  assert.equal(denied.status, 403);
  assert.equal(rowsCreated, false);

  let completedRows = 0;
  const allowed = await createAuthorizedCsvExportResponse({
    request: new Request("https://example.test/api/export"),
    requestId: "req-export",
    filename: "顧客一覧.csv",
    authorize: async () => ({ allowed: true }),
    rows: () => [{ id: 1, name: "Alice" }],
    columns: [
      { header: "id", select: (row) => row.id },
      { header: "name", select: (row) => row.name },
    ],
    policy: { formulaProtection: "prefix_single_quote" },
    onComplete: ({ rowCount }) => { completedRows = rowCount; },
  });

  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(allowed.headers.get("cache-control"), "private, no-store");
  assert.equal(allowed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(allowed.headers.get("x-request-id"), "req-export");
  assert.match(allowed.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
  assert.equal(await allowed.text(), "id,name\r\n1,Alice\r\n");
  assert.equal(completedRows, 1);
});
