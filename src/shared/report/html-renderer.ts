import type { ReportDefinition, ReportRenderer, ReportViewModel, RenderedReport } from "./report";
export interface SafeHtmlTemplate<TData>{readonly key:string;readonly version:string;render(viewModel:ReportViewModel<TData>):string;}
const FORBIDDEN_HTML=/<(?:script|iframe|object|embed|link|base)\b|\bon\w+\s*=|(?:src|href)\s*=\s*["']?\s*(?:https?:|\/\/|javascript:|data:)/iu;
export const escapeReportHtml=(value:string):string=>value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]??character));
export class HtmlReportRenderer implements ReportRenderer{
 readonly key="safe-html";readonly supportedOutputTypes=["html"] as const;
 constructor(private readonly resolveTemplate:<TData>(definition:ReportDefinition<TData>)=>SafeHtmlTemplate<TData>){}
 async render<TData>(input:{readonly definition:ReportDefinition<TData>;readonly viewModel:ReportViewModel<TData>;readonly outputType:"html"|"pdf"|"xlsx"|"csv";}):Promise<RenderedReport>{
  if(input.outputType!=="html")throw new TypeError("HTML renderer only supports html output");
  const template=this.resolveTemplate(input.definition);
  if(template.key!==input.definition.templateKey||template.version!==input.definition.templateVersion)throw new TypeError("resolved template does not match the report definition");
  const html=template.render(input.viewModel);
  if(FORBIDDEN_HTML.test(html))throw new TypeError("HTML report contains forbidden active or external content");
  return{body:new TextEncoder().encode(html),contentType:"text/html; charset=utf-8",suggestedFilename:`${input.definition.key}.html`};
 }
}