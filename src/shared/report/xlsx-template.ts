import type { ReportDefinition, ReportViewModel } from "./report";

export type XlsxCellValue = string | number | boolean | null;

export interface XlsxSheetModel {
  readonly name: string;
  readonly rows: readonly (readonly XlsxCellValue[])[];
}

export interface XlsxWorkbookModel {
  readonly sheets: readonly XlsxSheetModel[];
}

export interface XlsxWorkbookTemplate<TData> {
  readonly key: string;
  readonly version: string;
  build(viewModel: ReportViewModel<TData>): XlsxWorkbookModel;
}

const INVALID_SHEET_CHARS = /[\\/?*\[\]:]/u;
const FORMULA_PREFIX = /^[=+\-@]/u;
const MAX_SHEETS = 32;
const MAX_ROWS = 10000;
const MAX_COLUMNS = 256;
const MAX_CELL_LENGTH = 32767;

export const validateXlsxWorkbookModel = (model: XlsxWorkbookModel): XlsxWorkbookModel => {
  if (model.sheets.length === 0 || model.sheets.length > MAX_SHEETS) throw new TypeError("XLSX workbook sheet count is invalid");
  const names = new Set<string>();
  for (const sheet of model.sheets) {
    const name = sheet.name.trim();
    if (!name || name.length > 31 || INVALID_SHEET_CHARS.test(name) || name.startsWith("'") || name.endsWith("'")) throw new TypeError("XLSX sheet name is invalid");
    const folded = name.toLocaleLowerCase("en-US");
    if (names.has(folded)) throw new TypeError("XLSX sheet names must be unique");
    names.add(folded);
    if (sheet.rows.length > MAX_ROWS) throw new TypeError("XLSX sheet has too many rows");
    for (const row of sheet.rows) {
      if (row.length > MAX_COLUMNS) throw new TypeError("XLSX row has too many columns");
      for (const cell of row) {
        if (typeof cell === "string") {
          if (cell.length > MAX_CELL_LENGTH || Array.from(cell).some((c) => { const n=c.codePointAt(0)??0; return n===0||n===0x7f; })) throw new TypeError("XLSX cell text is invalid");
        } else if (typeof cell === "number" && !Number.isFinite(cell)) throw new TypeError("XLSX numeric cell must be finite");
      }
    }
  }
  return model;
};

export const xlsxLiteralText = (value: string): string => FORMULA_PREFIX.test(value) ? `'${value}` : value;

export const resolveXlsxTemplate = <TData>(
  definition: ReportDefinition<TData>,
  resolver: (definition: ReportDefinition<TData>) => XlsxWorkbookTemplate<TData>,
): XlsxWorkbookTemplate<TData> => {
  const template=resolver(definition);
  if (template.key!==definition.templateKey || template.version!==definition.templateVersion) throw new TypeError("resolved template does not match the report definition");
  return template;
};
