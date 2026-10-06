import writeExcelFile from "write-excel-file/browser";
import type { ReportDefinition, ReportRenderer, ReportViewModel, RenderedReport } from "./report";
import { resolveXlsxTemplate, validateXlsxWorkbookModel, xlsxLiteralText, type XlsxWorkbookTemplate } from "./xlsx-template";

const XLSX_CONTENT_TYPE="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class WriteExcelFileReportRenderer implements ReportRenderer {
  readonly key="write-excel-file";
  readonly supportedOutputTypes=["xlsx"] as const;

  constructor(private readonly resolveTemplate:<TData>(definition:ReportDefinition<TData>)=>XlsxWorkbookTemplate<TData>){}

  async render<TData>(input:{readonly definition:ReportDefinition<TData>;readonly viewModel:ReportViewModel<TData>;readonly outputType:"html"|"pdf"|"xlsx"|"csv";}):Promise<RenderedReport>{
    if(input.outputType!=="xlsx")throw new TypeError("XLSX renderer only supports xlsx output");
    const template=resolveXlsxTemplate(input.definition,this.resolveTemplate);
    const model=validateXlsxWorkbookModel(template.build(input.viewModel));
    const data=model.sheets.map((sheet)=>sheet.rows.map((row)=>row.map((value)=>typeof value==="string"?xlsxLiteralText(value):value)));
    const blob=await writeExcelFile(data,{sheets:model.sheets.map((sheet)=>sheet.name)}).toBlob();
    const body=new Uint8Array(await blob.arrayBuffer());
    return{body,contentType:XLSX_CONTENT_TYPE,suggestedFilename:`${input.definition.key}.xlsx`};
  }
}
