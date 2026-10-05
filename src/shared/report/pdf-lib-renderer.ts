import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { ReportDefinition, ReportRenderer, ReportViewModel, RenderedReport } from "./report";

export interface PdfTextTemplate<TData> {
  readonly key: string;
  readonly version: string;
  build(viewModel: ReportViewModel<TData>): { readonly title?: string; readonly lines: readonly string[] };
}
export interface PdfFontProvider {
  loadFontBytes(): Promise<Uint8Array>;
}
const MAX_LINES=500;
const MAX_LINE_LENGTH=2000;
const boundedText=(value:string):string=>{
  if(value.length>MAX_LINE_LENGTH||Array.from(value).some((c)=>{const n=c.codePointAt(0)??0;return n===0||n===0x7f;}))throw new TypeError("PDF report text is invalid");
  return value;
};
export class PdfLibReportRenderer implements ReportRenderer {
  readonly key="pdf-lib";
  readonly supportedOutputTypes=["pdf"] as const;
  constructor(
    private readonly resolveTemplate:<TData>(definition:ReportDefinition<TData>)=>PdfTextTemplate<TData>,
    private readonly fontProvider?:PdfFontProvider,
  ){}
  async render<TData>(input:{readonly definition:ReportDefinition<TData>;readonly viewModel:ReportViewModel<TData>;readonly outputType:"html"|"pdf"|"xlsx"|"csv";}):Promise<RenderedReport>{
    if(input.outputType!=="pdf")throw new TypeError("PDF renderer only supports pdf output");
    const template=this.resolveTemplate(input.definition);
    if(template.key!==input.definition.templateKey||template.version!==input.definition.templateVersion)throw new TypeError("resolved template does not match the report definition");
    const document=await PDFDocument.create();
    document.setProducer("Report Foundation pdf-lib adapter");
    document.setCreator("Report Foundation");
    document.setCreationDate(new Date(input.viewModel.generatedAt));
    document.setModificationDate(new Date(input.viewModel.generatedAt));
    const model=template.build(input.viewModel);
    if(model.title)document.setTitle(boundedText(model.title));
    let font:PDFFont;
    if(this.fontProvider){
      document.registerFontkit(fontkit);
      font=await document.embedFont(await this.fontProvider.loadFontBytes(),{subset:true});
    }else{
      font=await document.embedFont(StandardFonts.Helvetica);
    }
    if(model.lines.length>MAX_LINES)throw new TypeError("PDF report has too many lines");
    const page=document.addPage([595.28,841.89]);
    let y=800;
    for(const raw of model.lines){
      const line=boundedText(raw);
      if(y<40)throw new TypeError("PDF report exceeds the reference single-page layout");
      page.drawText(line,{x:40,y,size:10,font,maxWidth:515});
      y-=16;
    }
    const body=await document.save({useObjectStreams:false});
    return{body,contentType:"application/pdf",suggestedFilename:`${input.definition.key}.pdf`};
  }
}
