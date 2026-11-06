import {D1WorkhubTableViewsStore} from "./d1-workhub-table-views-store";
import {loadTravelTablePage} from "../reference/workhub/travel-request/table-query";
import {validationErrorResponse} from "./http/api-error";
import {readJsonBody} from "./http/request-body";
type Env="local"|"test"|"preview"|"production";
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
const failure=(status:number,code:string,message:string)=>respond({error:{code,message}},status);
/** Called only after parent session, operation-mode, and CSRF enforcement. */
export const handleWorkhubTableApi=async(
 request:Request,db:D1Database,environment:Env,principalId:string,requestId:string,
):Promise<Response|null>=>{
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith("/api/workhub/table/")&&!path.startsWith("/api/workhub/table-preferences")
  &&!path.startsWith("/api/workhub/saved-views"))return null;
 // Narrow WORKHUB reference: only Aoi has the owned travel view.
 if(principalId!=="workhub-demo-aoi")return failure(403,"table_forbidden","Table is unavailable");
 const store=new D1WorkhubTableViewsStore(db,environment,principalId);
 try{
  if(path==="/api/workhub/table/travel"){
   if(request.method!=="GET")return failure(405,"method_not_allowed","Only GET is supported");
   const result=await loadTravelTablePage(db,environment,principalId,url.searchParams);
   if(!result.ok)return validationErrorResponse(result.issues,requestId);
   return respond(result.value);
  }
  if(path==="/api/workhub/table-preferences"){
   if(request.method==="GET")return respond({preference:await store.getPreference()});
   if(request.method!=="PUT")return failure(405,"method_not_allowed","Only GET/PUT supported");
   const body=await readJsonBody(request,{maxBytes:8192});
   if(!body.ok)return failure(body.status,body.code,body.message);
   const obj=body.value as {expectedVersion?:unknown;preference?:unknown}|null;
   if(!obj||typeof obj!=="object"||Array.isArray(obj))throw new TypeError("Invalid preference payload");
   return respond({preference:await store.savePreference(obj.preference,obj.expectedVersion as number)});
  }
  if(path==="/api/workhub/saved-views"){
   if(request.method==="GET")return respond({views:await store.listViews()});
   if(request.method!=="POST")return failure(405,"method_not_allowed","Only GET/POST supported");
   const body=await readJsonBody(request,{maxBytes:8192});
   if(!body.ok)return failure(body.status,body.code,body.message);
   return respond({view:await store.createView(body.value)},201);
  }
  const match=path.match(/^\/api\/workhub\/saved-views\/([a-f0-9-]{36})$/u);
  if(match){
   const id=match[1];
   if(request.method==="GET"){
    const view=await store.getView(id);
    return view?respond({view}):failure(404,"not_found","Saved view not found");
   }
   if(request.method!=="PATCH"&&request.method!=="DELETE")return failure(405,"method_not_allowed","Method not supported");
   const body=await readJsonBody(request,{maxBytes:8192});
   if(!body.ok)return failure(body.status,body.code,body.message);
   const value=body.value as {expectedVersion?:unknown;view?:unknown}|null;
   if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("Invalid view payload");
   if(request.method==="DELETE"){
    await store.deleteView(id,value.expectedVersion as number);
    return respond({deleted:true});
   }
   return respond({view:await store.updateView(id,value.view,value.expectedVersion as number)});
  }
  return failure(404,"not_found","Table route not found");
 }catch(error){
  if(error instanceof TypeError)return validationErrorResponse([
   {code:"table.invalid_input",path:"table",message:"Table input or schema is invalid"},
  ],requestId);
  if(error instanceof Error&&error.message==="version_conflict")return failure(409,"stale_update","Version conflict");
  if(error instanceof Error&&error.message==="not_found")return failure(404,"not_found","Saved view not found");
  return failure(503,"table_unavailable","Table state is unavailable");
 }
};
