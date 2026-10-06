import type { GeneratedArtifactStore } from "../../shared/report";
import type { ObjectStorage } from "../../shared/object-storage";
import { createAuthorizedDownloadResponse, type FileDownloadResolution } from "./file-transfer";

export interface ReportArtifactDownloadAuthorizer {
  canDownload(input:{principalId:string;resourceType:string;resourceId:string;reportKey:string}):Promise<boolean>|boolean;
}
export const handleReportArtifactDownload=async(input:{request:Request;requestId:string;principalId:string;environment:string;artifactId:string;artifacts:GeneratedArtifactStore;storage:ObjectStorage;authorizer:ReportArtifactDownloadAuthorizer;filename:(artifactId:string,reportKey:string)=>string;now?:()=>Date;}):Promise<Response> =>
 createAuthorizedDownloadResponse({request:input.request,requestId:input.requestId,storage:input.storage,hideForbiddenAsNotFound:true,resolve:async():Promise<FileDownloadResolution>=>{
  const artifact=await input.artifacts.get(input.artifactId,input.environment);
  if(!artifact||artifact.status!=="ready")return{kind:"not_found"};\n  if(artifact.expiresAt && (input.now?.() ?? new Date()).getTime() >= new Date(artifact.expiresAt).getTime())return{kind:"not_found"};
  if(!await input.authorizer.canDownload({principalId:input.principalId,resourceType:artifact.resourceType,resourceId:artifact.resourceId,reportKey:artifact.reportKey}))return{kind:"forbidden"};
  return{kind:"authorized",identifier:artifact.objectIdentifier,displayFilename:input.filename(artifact.id,artifact.reportKey),contentType:artifact.contentType,disposition:"attachment"};
 }});
