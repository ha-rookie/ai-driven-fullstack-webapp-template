export type CsvExportCell = string | number | boolean | null | undefined;

export interface CsvExportColumn<T> {
  readonly header: string;
  readonly select: (row: T) => CsvExportCell;
}

export interface CsvExportPolicy {
  readonly formulaProtection: "prefix_single_quote" | "reject";
  readonly includeUtf8Bom?: boolean;
  readonly lineEnding?: "\n" | "\r\n";
}

export class CsvFormulaInjectionError extends Error {
  readonly column: string;

  constructor(column: string) {
    super(`CSV cell in column ${column} could be interpreted as a spreadsheet formula`);
    this.name = "CsvFormulaInjectionError";
    this.column = column;
  }
}

const assertColumns = <T>(columns: readonly CsvExportColumn<T>[]): void => {
  if (columns.length === 0) throw new TypeError("CSV export requires at least one column");
  const seen = new Set<string>();
  for (const column of columns) {
    if (column.header.trim().length === 0) throw new TypeError("CSV export headers must not be empty");
    if (seen.has(column.header)) throw new TypeError("CSV export headers must be unique");
    seen.add(column.header);
  }
};

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

export const protectCsvFormulaCell = (
  value: string,
  column: string,
  mode: CsvExportPolicy["formulaProtection"],
): string => {
  if (!FORMULA_PREFIX.test(value)) return value;
  if (mode === "reject") throw new CsvFormulaInjectionError(column);
  return `'${value}`;
};

export const encodeCsvCell = (value: string): string => {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
};

const serializeCell = (
  value: CsvExportCell,
  column: string,
  policy: CsvExportPolicy,
): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`CSV export column ${column} contains a non-finite number`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return encodeCsvCell(protectCsvFormulaCell(value, column, policy.formulaProtection));
};

const createCsvChunks = async function* <T>(
  rows: Iterable<T> | AsyncIterable<T>,
  columns: readonly CsvExportColumn<T>[],
  policy: CsvExportPolicy,
  onComplete?: (metadata: { readonly rowCount: number }) => void | Promise<void>,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const lineEnding = policy.lineEnding ?? "\r\n";

  if (policy.includeUtf8Bom === true) yield new Uint8Array([0xef, 0xbb, 0xbf]);

  const header = columns
    .map((column) => encodeCsvCell(protectCsvFormulaCell(column.header, column.header, policy.formulaProtection)))
    .join(",");
  yield encoder.encode(`${header}${lineEnding}`);

  let rowCount = 0;
  for await (const row of rows) {
    const line = columns
      .map((column) => serializeCell(column.select(row), column.header, policy))
      .join(",");
    yield encoder.encode(`${line}${lineEnding}`);
    rowCount += 1;
  }

  await onComplete?.({ rowCount });
};

export const createCsvExportStream = <T>(
  rows: Iterable<T> | AsyncIterable<T>,
  columns: readonly CsvExportColumn<T>[],
  policy: CsvExportPolicy,
  onComplete?: (metadata: { readonly rowCount: number }) => void | Promise<void>,
): ReadableStream<Uint8Array> => {
  assertColumns(columns);
  const iterator = createCsvChunks(rows, columns, policy, onComplete)[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      if (iterator.return !== undefined) await iterator.return(undefined);
    },
  });
};
