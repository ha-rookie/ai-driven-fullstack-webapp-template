import {defaultTablePreference,travelTableDefinition as def,validateSavedView,validateTablePreference,type SavedView,type TablePreference} from "../shared/data-table";
type Env="local"|"test"|"preview"|"production";
interface PrefRow{version:number;value_json:string}
interface ViewRow{id:string;version:number;value_json:string}
const changed=(r:D1Result)=>r.meta?.changes===1;
export class D1WorkhubTableViewsStore{
 constructor(private readonly db:D1Database,private readonly env:Env,private readonly user:string){}
 async getPreference():Promise<TablePreference>{
  const row=await this.db.prepare("SELECT version,value_json FROM workhub_table_preferences WHERE environment=? AND user_id=? AND table_id=?").bind(this.env,this.user,def.id).first<PrefRow>();
  if(!row)return defaultTablePreference(def);
  const value=validateTablePreference(def,JSON.parse(row.value_json));
  if(value.version!==row.version)throw new Error("Stored preference version mismatch");
  return value;
 }
 async savePreference(input:unknown,expectedVersion:number):Promise<TablePreference>{
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw new TypeError("Invalid expectedVersion");
  const pref=validateTablePreference(def,{...(input as object),version:expectedVersion});
  const next={...pref,version:expectedVersion+1},json=JSON.stringify(next),now=new Date().toISOString();
  if(json.length>8192)throw new TypeError("Preference too large");
  const result=expectedVersion===0
   ?await this.db.prepare("INSERT INTO workhub_table_preferences(environment,user_id,table_id,version,schema_version,value_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").bind(this.env,this.user,def.id,1,def.schemaVersion,json,now).run()
   :await this.db.prepare("UPDATE workhub_table_preferences SET version=version+1,schema_version=?,value_json=?,updated_at=? WHERE environment=? AND user_id=? AND table_id=? AND version=?").bind(def.schemaVersion,json,now,this.env,this.user,def.id,expectedVersion).run();
  if(!changed(result))throw new Error("version_conflict");
  return next;
 }
 async listViews():Promise<readonly SavedView[]>{
  const rows=await this.db.prepare("SELECT id,version,value_json FROM workhub_saved_views WHERE environment=? AND user_id=? AND table_id=? ORDER BY updated_at DESC LIMIT 21").bind(this.env,this.user,def.id).all<ViewRow>();
  if((rows.results??[]).length>20)throw new Error("Saved view count invalid");
  return (rows.results??[]).map(row=>{
   const view=validateSavedView(def,JSON.parse(row.value_json));
   if(row.id!==view.id||row.version!==view.version)throw new Error("Stored view version mismatch");
   return view;
  });
 }
 async getView(id:string):Promise<SavedView|null>{
  const row=await this.db.prepare("SELECT id,version,value_json FROM workhub_saved_views WHERE environment=? AND user_id=? AND table_id=? AND id=?").bind(this.env,this.user,def.id,id).first<ViewRow>();
  if(!row)return null;
  const v=validateSavedView(def,JSON.parse(row.value_json));
  if(v.id!==id||v.version!==row.version)throw new Error("Stored view version mismatch");
  return v;
 }
 async createView(input:unknown):Promise<SavedView>{
  if((await this.listViews()).length>=20)throw new TypeError("Saved view limit reached");
  const id=crypto.randomUUID(),view=validateSavedView(def,{...(input as object),id,version:1});
  const json=JSON.stringify(view),now=new Date().toISOString();
  if(json.length>8192)throw new TypeError("Saved view too large");
  const result=await this.db.prepare("INSERT INTO workhub_saved_views(id,environment,user_id,table_id,name,version,schema_version,value_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,this.env,this.user,def.id,view.name,1,def.schemaVersion,json,now,now).run();
  if(!changed(result))throw new Error("Insert failed");
  return view;
 }
 async updateView(id:string,input:unknown,expectedVersion:number):Promise<SavedView>{
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new TypeError("Invalid expectedVersion");
  const existing=await this.getView(id);
  if(!existing)throw new Error("not_found");
  if(existing.version!==expectedVersion)throw new Error("version_conflict");
  const view=validateSavedView(def,{...(input as object),id,version:expectedVersion+1});
  const json=JSON.stringify(view);
  if(json.length>8192)throw new TypeError("Saved view too large");
  const r=await this.db.prepare("UPDATE workhub_saved_views SET name=?,version=version+1,schema_version=?,value_json=?,updated_at=? WHERE environment=? AND user_id=? AND table_id=? AND id=? AND version=?").bind(view.name,def.schemaVersion,json,new Date().toISOString(),this.env,this.user,def.id,id,expectedVersion).run();
  if(!changed(r))throw new Error("version_conflict");
  return view;
 }
 async deleteView(id:string,expectedVersion:number):Promise<void>{
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new TypeError("Invalid expectedVersion");
  const r=await this.db.prepare("DELETE FROM workhub_saved_views WHERE environment=? AND user_id=? AND table_id=? AND id=? AND version=?").bind(this.env,this.user,def.id,id,expectedVersion).run();
  if(!changed(r))throw new Error("version_conflict");
 }
}
