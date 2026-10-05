import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "../src/shared/object-storage";
import { InMemoryGeneratedArtifactStore, PdfLibReportRenderer, ReportArtifactService } from "../src/shared/report";
import { handleReportArtifactDownload } from "../src/worker/http/report-artifact-download";
import {
  WORKHUB_TRAVEL_APPROVAL_PDF_REPORT,
  WORKHUB_TRAVEL_APPROVAL_PDF_TEMPLATE,
  buildWorkhubTravelApprovalPdfReport,
} from "../src/reference/workhub/travel-report";

const travel={id:"tr-pdf-1",environment:"test",requesterId:"aoi",destinationOfficeItemId:"office-1",destinationOfficeRevisionId:"office-r1",startDate:"2026-10-10",endDate:"2026-10-11",purpose:"Customer visit",status:"submitted" as const,submissionKey:"s",workflowInstanceId:"wf-pdf-1",submittedAt:"2026-10-01T00:00:00.000Z",version:3,createdAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-02T00:00:00.000Z"};
const workflow={id:"wf-pdf-1",environment:"test",resourceType:"workhub.travel_request",resourceId:"tr-pdf-1",definitionKey:"w",definitionVersion:1,requesterId:"aoi",state:"completed" as const,currentStepKey:null,returnedStepKey:null,version:2,nextWorkItemSequence:2,nextTransitionSequence:3,submissionKey:"s",createdAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-02T00:00:00.000Z",completedAt:"2026-10-02T00:00:00.000Z"};
const office={item:{id:"office-1",environment:"test",masterKey:"workhub.office",code:"TOKYO",version:2,nextRevision:2,retiredAt:null,createdAt:"2026-01-01T00:00:00.000Z",createdBy:"admin",updatedAt:"2026-01-01T00:00:00.000Z",updatedBy:"admin"},revision:{id:"office-r1",environment:"test",masterItemId:"office-1",revision:1,label:"Tokyo Office",enabled:true,effectiveFrom:"2026-01-01T00:00:00.000Z",effectiveTo:null,displayOrder:1,parentItemId:null,attributes:{},createdAt:"2026-01-01T00:00:00.000Z",createdBy:"admin"}};
const approval={id:"act-pdf-1",environment:"test",resourceType:"workhub.travel_request",resourceId:"tr-pdf-1",activityType:"workflow.approved",actorRef:"ren",actorDisplaySnapshot:null,subjectRef:null,sourceType:"workflow_transition",sourceId:"transition-approve-pdf",sequence:2,visibilityScope:null,metadata:{},occurredAt:"2026-10-02T00:00:00.000Z",createdAt:"2026-10-02T00:00:00.000Z"};

test("WORKHUB approved travel generates one private PDF and download rechecks current authorization",async()=>{
  const storage=new InMemoryObjectStorage({environment:"test"});
  const artifacts=new InMemoryGeneratedArtifactStore();
  let sequence=0;
  const service=new ReportArtifactService({environment:"test",storage,artifacts,authorizer:{assertCanGenerate({principalId}){if(principalId!=="aoi")throw new Error("forbidden");}},generateId:()=>`workhub-pdf-${++sequence}`});
  const viewModel=buildWorkhubTravelApprovalPdfReport({travel,workflow,office,approval,generatedBy:"aoi",generatedAt:"2026-10-03T00:00:00.000Z"});
  const renderer=new PdfLibReportRenderer(()=>WORKHUB_TRAVEL_APPROVAL_PDF_TEMPLATE);
  const first=await service.generate({principalId:"aoi",definition:WORKHUB_TRAVEL_APPROVAL_PDF_REPORT,viewModel,renderer,outputType:"pdf",intent:"original"});
  const second=await service.generate({principalId:"aoi",definition:WORKHUB_TRAVEL_APPROVAL_PDF_REPORT,viewModel,renderer,outputType:"pdf",intent:"original"});
  assert.equal(first.id,second.id);
  assert.equal(first.contentType,"application/pdf");
  const stored=await storage.get(first.objectIdentifier);
  assert.ok(stored);
  assert.equal(new TextDecoder().decode(stored.body.slice(0,5)),"%PDF-");

  let allowed=true;
  const download=()=>handleReportArtifactDownload({request:new Request("https://example.test/api/workhub/reports/"+first.id),requestId:"req-pdf",principalId:"aoi",environment:"test",artifactId:first.id,artifacts,storage,authorizer:{canDownload:()=>allowed},filename:()=> "travel-approval.pdf"});
  const response=await download();
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),"application/pdf");
  assert.match(response.headers.get("content-disposition")??"",/attachment/);
  allowed=false;
  assert.equal((await download()).status,404);
});
