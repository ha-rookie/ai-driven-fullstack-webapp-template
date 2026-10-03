export type CsvByteSource = string | Uint8Array | ReadableStream<Uint8Array>;

export interface CsvImportPolicy {
  readonly maxBytes: number;
  readonly maxRows: number;
  readonly allowHeaderOnly?: boolean;
}

export type CsvValidationSeverity = "error" | "warning";

export interface CsvValidationIssue {
  readonly rowNumber: number;
  readonly column?: string;
  readonly code: string;
  readonly message: string;
  readonly severity: CsvValidationSeverity;
}

export interface CsvIssueDraft {
  readonly column?: string;
  readonly code: string;
  readonly message: string;
  readonly severity?: CsvValidationSeverity;
}

export type CsvValueParseResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface CsvColumnSpec<TValue = unknown> {
  readonly key: string;
  readonly header: string;
  readonly required?: boolean;
  readonly parse?: (raw: string, context: { readonly rowNumber: number; readonly header: string }) => CsvValueParseResult<TValue>;
}

export type CsvRowBuildResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings?: readonly CsvIssueDraft[] }
  | { readonly ok: false; readonly issues: readonly CsvIssueDraft[] };

export interface CsvImportSchema<T> {
  readonly columns: readonly CsvColumnSpec[];
  readonly unknownColumns?: "reject" | "ignore";
  readonly build: (
    values: Readonly<Record<string, unknown>>,
    context: {
      readonly rowNumber: number;
      readonly raw: Readonly<Record<string, string>>;
    },
  ) => CsvRowBuildResult<T>;
}

export interface CsvPreviewRow<T> {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
  readonly value?: T;
  readonly issues: readonly CsvValidationIssue[];
}

export interface CsvImportPreview<T> {
  readonly mode: "dry_run";
  readonly headers: readonly string[];
  readonly bytesRead: number;
  readonly rows: readonly CsvPreviewRow<T>[];
  readonly summary: {
    readonly totalRows: number;
    readonly validRows: number;
    readonly invalidRows: number;
    readonly warnings: number;
  };
}

export type CsvImportFailureCode =
  | "payload_too_large"
  | "too_many_rows"
  | "invalid_utf8"
  | "malformed_csv"
  | "empty_file"
  | "header_only"
  | "invalid_header"
  | "duplicate_header"
  | "unknown_column"
  | "missing_required_column";

export interface CsvImportFailure {
  readonly ok: false;
  readonly code: CsvImportFailureCode;
  readonly message: string;
  readonly rowNumber?: number;
  readonly column?: string;
}

export type CsvImportResult<T> =
  | { readonly ok: true; readonly preview: CsvImportPreview<T> }
  | CsvImportFailure;

interface ParsedCsvRows {
  readonly rows: readonly (readonly string[])[];
  readonly bytesRead: number;
}

const fail = (
  code: CsvImportFailureCode,
  message: string,
  details: Pick<CsvImportFailure, "rowNumber" | "column"> = {},
): CsvImportFailure => ({ ok: false, code, message, ...details });

const assertPositiveSafeInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
};

const assertPolicy = (policy: CsvImportPolicy): void => {
  assertPositiveSafeInteger("maxBytes", policy.maxBytes);
  assertPositiveSafeInteger("maxRows", policy.maxRows);
};

const sourceToStream = (source: CsvByteSource): ReadableStream<Uint8Array> => {
  if (typeof source === "string") {
    const bytes = new TextEncoder().encode(source);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  if (source instanceof Uint8Array) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(source);
        controller.close();
      },
    });
  }

  return source;
};

const parseCsvRows = async (
  source: CsvByteSource,
  policy: CsvImportPolicy,
): Promise<{ readonly ok: true; readonly parsed: ParsedCsvRows } | CsvImportFailure> => {
  const reader = sourceToStream(source).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let bytesRead = 0;
  let inQuotes = false;
  let quotePending = false;
  let skipNextLf = false;
  let rowTouched = false;
  let malformed: CsvImportFailure | null = null;

  const finishRow = (): void => {
    currentRow.push(currentField);
    rows.push(currentRow);
    currentRow = [];
    currentField = "";
    rowTouched = false;
  };

  const processOutsideQuotes = (character: string): void => {
    if (skipNextLf) {
      skipNextLf = false;
      if (character === "\n") return;
    }

    if (character === ",") {
      currentRow.push(currentField);
      currentField = "";
      rowTouched = true;
      return;
    }

    if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r") skipNextLf = true;
      if (rows.length > policy.maxRows + 1) {
        malformed = fail("too_many_rows", "CSV contains more data rows than allowed", {
          rowNumber: rows.length,
        });
      }
      return;
    }

    if (character === '"') {
      if (currentField.length !== 0) {
        malformed = fail("malformed_csv", "Quote must begin at the start of a CSV field", {
          rowNumber: rows.length + 1,
        });
        return;
      }
      inQuotes = true;
      rowTouched = true;
      return;
    }

    currentField += character;
    rowTouched = true;
  };

  const processText = (text: string): void => {
    for (const character of text) {
      if (malformed !== null) return;

      if (inQuotes) {
        if (quotePending) {
          if (character === '"') {
            currentField += '"';
            quotePending = false;
            rowTouched = true;
            continue;
          }

          inQuotes = false;
          quotePending = false;
          if (character !== "," && character !== "\r" && character !== "\n") {
            malformed = fail("malformed_csv", "Unexpected character after closing quote", {
              rowNumber: rows.length + 1,
            });
            return;
          }
          processOutsideQuotes(character);
          continue;
        }

        if (character === '"') {
          quotePending = true;
          continue;
        }

        currentField += character;
        rowTouched = true;
        continue;
      }

      processOutsideQuotes(character);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;

      bytesRead += value.byteLength;
      if (bytesRead > policy.maxBytes) {
        try {
          await reader.cancel("csv_import_payload_too_large");
        } catch {
          // Size rejection remains authoritative even when cancellation fails.
        }
        return fail("payload_too_large", "CSV exceeds the allowed byte size");
      }

      try {
        processText(decoder.decode(value, { stream: true }));
      } catch {
        return fail("invalid_utf8", "CSV must be valid UTF-8");
      }
      if (malformed !== null) return malformed;
    }

    try {
      processText(decoder.decode());
    } catch {
      return fail("invalid_utf8", "CSV must be valid UTF-8");
    }
    if (malformed !== null) return malformed;

    if (inQuotes) {
      if (quotePending) {
        inQuotes = false;
        quotePending = false;
      } else {
        return fail("malformed_csv", "CSV contains an unclosed quoted field", {
          rowNumber: rows.length + 1,
        });
      }
    }

    if (rowTouched || currentRow.length > 0 || currentField.length > 0) {
      finishRow();
    }

    if (rows.length > policy.maxRows + 1) {
      return fail("too_many_rows", "CSV contains more data rows than allowed", {
        rowNumber: policy.maxRows + 2,
      });
    }

    return { ok: true, parsed: { rows, bytesRead } };
  } finally {
    reader.releaseLock();
  }
};

const duplicateValue = (values: readonly string[]): string | null => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
};

const issueFromDraft = (rowNumber: number, draft: CsvIssueDraft): CsvValidationIssue => ({
  rowNumber,
  column: draft.column,
  code: draft.code,
  message: draft.message,
  severity: draft.severity ?? "error",
});

const normalizeSchema = <T>(schema: CsvImportSchema<T>): void => {
  if (schema.columns.length === 0) {
    throw new TypeError("CSV import schema must contain at least one column");
  }

  const keys = schema.columns.map((column) => column.key);
  const headers = schema.columns.map((column) => column.header);
  if (keys.some((key) => key.trim().length === 0) || headers.some((header) => header.trim().length === 0)) {
    throw new TypeError("CSV import schema keys and headers must not be empty");
  }
  if (duplicateValue(keys) !== null) throw new TypeError("CSV import schema keys must be unique");
  if (duplicateValue(headers) !== null) throw new TypeError("CSV import schema headers must be unique");
};

export const parseAndValidateCsvImport = async <T>(
  source: CsvByteSource,
  schema: CsvImportSchema<T>,
  policy: CsvImportPolicy,
): Promise<CsvImportResult<T>> => {
  assertPolicy(policy);
  normalizeSchema(schema);

  const parsedResult = await parseCsvRows(source, policy);
  if (!parsedResult.ok) return parsedResult;

  const { rows, bytesRead } = parsedResult.parsed;
  if (rows.length === 0) return fail("empty_file", "CSV is empty");

  const headers = rows[0]!.map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    return fail("invalid_header", "CSV headers must not be empty", { rowNumber: 1 });
  }

  const duplicateHeader = duplicateValue(headers);
  if (duplicateHeader !== null) {
    return fail("duplicate_header", "CSV contains a duplicate header", {
      rowNumber: 1,
      column: duplicateHeader,
    });
  }

  const knownHeaders = new Set(schema.columns.map((column) => column.header));
  if ((schema.unknownColumns ?? "reject") === "reject") {
    const unknownHeader = headers.find((header) => !knownHeaders.has(header));
    if (unknownHeader !== undefined) {
      return fail("unknown_column", "CSV contains a column that is not allowed by the import schema", {
        rowNumber: 1,
        column: unknownHeader,
      });
    }
  }

  const headerIndexes = new Map(headers.map((header, index) => [header, index] as const));
  const missingRequired = schema.columns.find(
    (column) => column.required === true && !headerIndexes.has(column.header),
  );
  if (missingRequired !== undefined) {
    return fail("missing_required_column", "CSV is missing a required column", {
      rowNumber: 1,
      column: missingRequired.header,
    });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0 && policy.allowHeaderOnly !== true) {
    return fail("header_only", "CSV must contain at least one data row");
  }

  const previewRows: CsvPreviewRow<T>[] = [];
  let warningCount = 0;

  for (let index = 0; index < dataRows.length; index += 1) {
    const rowNumber = index + 2;
    const cells = dataRows[index]!;
    const issues: CsvValidationIssue[] = [];
    const raw: Record<string, string> = {};

    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      raw[headers[headerIndex]!] = cells[headerIndex] ?? "";
    }

    if (cells.length > headers.length) {
      issues.push({
        rowNumber,
        code: "too_many_cells",
        message: "CSV row contains more cells than the header",
        severity: "error",
      });
    }

    const values: Record<string, unknown> = {};
    for (const column of schema.columns) {
      const cellIndex = headerIndexes.get(column.header);
      if (cellIndex === undefined) {
        values[column.key] = undefined;
        continue;
      }

      const rawValue = cells[cellIndex] ?? "";
      if (column.required === true && rawValue.trim().length === 0) {
        issues.push({
          rowNumber,
          column: column.header,
          code: "required_value_missing",
          message: "Required CSV value is empty",
          severity: "error",
        });
        continue;
      }

      if (column.parse === undefined) {
        values[column.key] = rawValue;
        continue;
      }

      const parsedValue = column.parse(rawValue, { rowNumber, header: column.header });
      if (!parsedValue.ok) {
        issues.push({
          rowNumber,
          column: column.header,
          code: parsedValue.code,
          message: parsedValue.message,
          severity: "error",
        });
        continue;
      }
      values[column.key] = parsedValue.value;
    }

    let builtValue: T | undefined;
    if (!issues.some((issue) => issue.severity === "error")) {
      const built = schema.build(Object.freeze({ ...values }), {
        rowNumber,
        raw: Object.freeze({ ...raw }),
      });
      if (built.ok) {
        builtValue = built.value;
        for (const warning of built.warnings ?? []) {
          const issue = issueFromDraft(rowNumber, { ...warning, severity: warning.severity ?? "warning" });
          issues.push(issue);
          if (issue.severity === "warning") warningCount += 1;
        }
      } else {
        for (const draft of built.issues) {
          const issue = issueFromDraft(rowNumber, draft);
          issues.push(issue);
          if (issue.severity === "warning") warningCount += 1;
        }
      }
    }

    previewRows.push({
      rowNumber,
      raw: Object.freeze({ ...raw }),
      value: builtValue,
      issues: Object.freeze(issues),
    });
  }

  const invalidRows = previewRows.filter((row) =>
    row.value === undefined || row.issues.some((issue) => issue.severity === "error"),
  ).length;

  return {
    ok: true,
    preview: {
      mode: "dry_run",
      headers: Object.freeze([...headers]),
      bytesRead,
      rows: Object.freeze(previewRows),
      summary: {
        totalRows: previewRows.length,
        validRows: previewRows.length - invalidRows,
        invalidRows,
        warnings: warningCount,
      },
    },
  };
};

export type CsvImportCommitMode = "all_or_nothing" | "partial";

export interface CsvImportCommitContext {
  readonly mode: CsvImportCommitMode;
  readonly idempotencyKey?: string;
}

export interface CsvImportCommitOptions<T, TResult> {
  readonly mode: CsvImportCommitMode;
  readonly idempotencyKey?: string;
  readonly revalidate?: (
    row: { readonly rowNumber: number; readonly value: T },
  ) => Promise<readonly CsvIssueDraft[]> | readonly CsvIssueDraft[];
  readonly commit: (
    rows: readonly { readonly rowNumber: number; readonly value: T }[],
    context: CsvImportCommitContext,
  ) => Promise<TResult>;
}

export type CsvImportCommitResult<TResult> =
  | {
      readonly ok: true;
      readonly result: TResult;
      readonly committedRowNumbers: readonly number[];
      readonly skippedRowNumbers: readonly number[];
      readonly revalidationIssues: readonly CsvValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly code: "preview_has_errors" | "revalidation_failed" | "no_rows_to_commit" | "commit_failed";
      readonly message: string;
      readonly skippedRowNumbers: readonly number[];
      readonly revalidationIssues: readonly CsvValidationIssue[];
    };

export const commitCsvImportPreview = async <T, TResult>(
  preview: CsvImportPreview<T>,
  options: CsvImportCommitOptions<T, TResult>,
): Promise<CsvImportCommitResult<TResult>> => {
  const previewInvalidRows = preview.rows
    .filter((row) => row.value === undefined || row.issues.some((issue) => issue.severity === "error"))
    .map((row) => row.rowNumber);

  if (options.mode === "all_or_nothing" && previewInvalidRows.length > 0) {
    return {
      ok: false,
      code: "preview_has_errors",
      message: "Import preview contains invalid rows; nothing was committed",
      skippedRowNumbers: Object.freeze(previewInvalidRows),
      revalidationIssues: Object.freeze([]),
    };
  }

  const revalidationIssues: CsvValidationIssue[] = [];
  const rowsToCommit: Array<{ readonly rowNumber: number; readonly value: T }> = [];
  const revalidationSkipped = new Set<number>();

  for (const row of preview.rows) {
    if (row.value === undefined || row.issues.some((issue) => issue.severity === "error")) continue;

    const drafts = options.revalidate === undefined
      ? []
      : await options.revalidate({ rowNumber: row.rowNumber, value: row.value });
    const issues = drafts.map((draft) => issueFromDraft(row.rowNumber, draft));
    revalidationIssues.push(...issues);

    if (issues.some((issue) => issue.severity === "error")) {
      revalidationSkipped.add(row.rowNumber);
      continue;
    }
    rowsToCommit.push({ rowNumber: row.rowNumber, value: row.value });
  }

  if (options.mode === "all_or_nothing" && revalidationSkipped.size > 0) {
    return {
      ok: false,
      code: "revalidation_failed",
      message: "Import changed or became invalid after preview; nothing was committed",
      skippedRowNumbers: Object.freeze([...previewInvalidRows, ...revalidationSkipped]),
      revalidationIssues: Object.freeze(revalidationIssues),
    };
  }

  const skippedRowNumbers = Object.freeze([...previewInvalidRows, ...revalidationSkipped]);
  if (rowsToCommit.length === 0) {
    return {
      ok: false,
      code: "no_rows_to_commit",
      message: "Import contains no valid rows to commit",
      skippedRowNumbers,
      revalidationIssues: Object.freeze(revalidationIssues),
    };
  }

  try {
    const result = await options.commit(Object.freeze(rowsToCommit), {
      mode: options.mode,
      idempotencyKey: options.idempotencyKey,
    });
    return {
      ok: true,
      result,
      committedRowNumbers: Object.freeze(rowsToCommit.map((row) => row.rowNumber)),
      skippedRowNumbers,
      revalidationIssues: Object.freeze(revalidationIssues),
    };
  } catch {
    return {
      ok: false,
      code: "commit_failed",
      message: "Import commit failed",
      skippedRowNumbers,
      revalidationIssues: Object.freeze(revalidationIssues),
    };
  }
};

export interface CsvExecutionThreshold {
  readonly asyncWhenBytesAtLeast?: number;
  readonly asyncWhenRowsAtLeast?: number;
}

export const recommendCsvImportExecution = (
  input: { readonly declaredBytes?: number; readonly rowCount?: number },
  threshold: CsvExecutionThreshold,
): "synchronous" | "async_job" => {
  if (threshold.asyncWhenBytesAtLeast !== undefined) {
    assertPositiveSafeInteger("asyncWhenBytesAtLeast", threshold.asyncWhenBytesAtLeast);
    if (input.declaredBytes !== undefined && input.declaredBytes >= threshold.asyncWhenBytesAtLeast) {
      return "async_job";
    }
  }

  if (threshold.asyncWhenRowsAtLeast !== undefined) {
    assertPositiveSafeInteger("asyncWhenRowsAtLeast", threshold.asyncWhenRowsAtLeast);
    if (input.rowCount !== undefined && input.rowCount >= threshold.asyncWhenRowsAtLeast) {
      return "async_job";
    }
  }

  return "synchronous";
};
