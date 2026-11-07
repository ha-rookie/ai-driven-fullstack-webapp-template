import {parseCollectionQuery,createCollectionPaginationMeta,type CollectionQueryContract} from "../../../shared/api";
import {travelTableDefinition as def} from "../../../shared/data-table";
import type {ValidationIssue} from "../../../shared/validation";
export interface WorkhubTableRow{id:string;purpose:string;status:"draft"|"submitting"|"submitted";startDate:string;updatedAt:string}
interface Cursor{v:1;sort:string;direction:"asc"|"desc";statuses:string;scope:string;env:string;value:string;id:string}
type Environment="local"|"test"|"preview"|"production";
const readCursor=(token:string,env:Environment,user:string):Cursor|null=>{
 try{
  if(token.length>1000||!/^[A-Za-z0-9_-]+$/.test(token))return null;
  const c=JSON.parse(atob(token.replace(/-/g,"+").replace(/_/g,"/"))) as Partial<Cursor>;
  if(c.v!==1||!def.supportedSorts.includes(c.sort??"")||!["asc","desc"].includes(c.direction??"")
   ||c.scope!==user||c.env!==env||typeof c.statuses!=="string"||c.statuses.length>80
   ||typeof c.value!=="string"||c.value.length>100||typeof c.id!=="string"||c.id.length>80)return null;
  return c as Cursor;
 }catch{return null}
};
const writeCursor=(c:Cursor)=>btoa(JSON.stringify(c)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
export type TableQueryResult=
 |{ok:false;issues:readonly ValidationIssue[]}
 |{ok:true;value:{items:readonly WorkhubTableRow[];pagination:{nextCursor:string|null;limit:number;hasMore:boolean}}};
/** An opaque cursor is never authority: user/environment are always D1 WHERE predicates. */
export const loadTravelTablePage=async(db:D1Database,env:Environment,user:string,params:URLSearchParams):Promise<TableQueryResult>=>{
 const known=new Set(["cursor","limit","sort","direction","filter.status"]);
 const unknown=[...params.keys()].filter(k=>!known.has(k));
 if(unknown.length)return{ok:false,issues:unknown.map(k=>({code:"collection_query.unknown_filter",path:k,message:"Unsupported table query parameter"}))};
 const contract:CollectionQueryContract<"updatedAt"|"id","status",Cursor>={
  defaultLimit:10,maxLimit:20,allowedSortKeys:["updatedAt","id"],
  defaultSort:{key:"updatedAt",direction:"desc"},stableTieBreaker:{key:"id",direction:"desc"},
  allowedFilterKeys:["status"],decodeCursor:token=>readCursor(token,env,user),
  validateFilter:(_key,values)=>values.some(v=>!def.supportedFilters.status.includes(v))
    ?[{code:"collection_query.invalid_filter",path:"filter.status",message:"Unsupported filter status"}]:[],
 };
 const parsed=parseCollectionQuery(params,contract);
 if(!parsed.ok)return parsed;
 const q=parsed.value,sort=q.sort[0]??contract.defaultSort,field=sort.key,direction=sort.direction;
 const statuses=q.filters.status??[],scope=statuses.join(",");
 const cursor=q.cursor;
 if(cursor&&(cursor.sort!==field||cursor.direction!==direction||cursor.statuses!==scope)){
  return{ok:false,issues:[{code:"collection_query.invalid_cursor",path:"cursor",message:"Cursor does not match current query"}]};
 }
 let where="environment=? AND requester_id=?";
 const bindings:(string|number)[]=[env,user];
 if(statuses.length){
  where+=" AND status IN ("+statuses.map(()=>"?").join(",")+")";
  bindings.push(...statuses);
 }
 const sqlField=field==="id"?"id":"updated_at";
 const dir=direction==="asc"?"ASC":"DESC";
 if(cursor){
  const comparator=direction==="asc"?">":"<";
  if(sqlField==="id"){where+=" AND id "+comparator+" ?";bindings.push(cursor.id)}
  else{where+=" AND (updated_at "+comparator+" ? OR (updated_at=? AND id < ?))";bindings.push(cursor.value,cursor.value,cursor.id)}
 }
 const order=sqlField==="id"?"id "+dir:"updated_at "+dir+",id DESC";
 bindings.push(q.limit+1);
 const sql="SELECT id,purpose,status,start_date AS startDate,updated_at AS updatedAt FROM reference_travel_requests WHERE "+where+" ORDER BY "+order+" LIMIT ?";
 const result=await db.prepare(sql).bind(...bindings).all<WorkhubTableRow>();
 const records=result.results??[],items=records.slice(0,q.limit),last=items.at(-1);
 const nextCursor=records.length>q.limit&&last?writeCursor({
  v:1,sort:field,direction,statuses:scope,scope:user,env,
  value:field==="id"?last.id:last.updatedAt,id:last.id,
 }):null;
 return {ok:true,value:{items,pagination:createCollectionPaginationMeta(q.limit,nextCursor)}};
};
