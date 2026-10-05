import assert from "node:assert/strict";
import test from "node:test";
import { PdfLibReportRenderer, buildReportViewModel, type ReportDefinition } from "../src/shared/report";

type Data={title:string};
const definition:ReportDefinition<Data>={key:"approval-report",version:"1",templateKey:"approval-pdf",templateVersion:"1",outputTypes:["pdf"],validateData(value){if(!value||typeof value!=="object"||typeof (value as {title?:unknown}).title!=="string")throw new TypeError("invalid report data");return{title:(value as Data).title};}};
const vm=buildReportViewModel({definition,resourceRef:{type:"request",id:"req-1"},sourceSnapshot:{id:"snap-1",sourceVersion:"7",capturedAt:"2026-10-05T00:00:00.000Z"},generationIntent:"original",generatedBy:"user-1",generatedAt:"2026-10-05T00:01:00.000Z",locale:"en-US",timezone:"UTC",data:{title:"Tokyo Trip"}});
test("pdf-lib renderer emits a PDF behind the ReportRenderer contract",async()=>{
 const renderer=new PdfLibReportRenderer(()=>({key:"approval-pdf",version:"1",build:(view)=>({title:"Approval",lines:[(view.data as Data).title,"Approved"]})}));
 const rendered=await renderer.render({definition,viewModel:vm,outputType:"pdf"});
 assert.equal(rendered.contentType,"application/pdf");
 assert.equal(rendered.suggestedFilename,"approval-report.pdf");
 assert.ok(rendered.body.byteLength>100);
 assert.equal(new TextDecoder().decode(rendered.body.slice(0,5)),"%PDF-");
});
test("pdf-lib renderer rejects mismatched template versions and unsupported output",async()=>{
 const mismatch=new PdfLibReportRenderer(()=>({key:"approval-pdf",version:"2",build:()=>({lines:["x"]})}));
 await assert.rejects(mismatch.render({definition,viewModel:vm,outputType:"pdf"}),/does not match/);
 const renderer=new PdfLibReportRenderer(()=>({key:"approval-pdf",version:"1",build:()=>({lines:["x"]})}));
 await assert.rejects(renderer.render({definition,viewModel:vm,outputType:"html"}),/only supports pdf/);
});
