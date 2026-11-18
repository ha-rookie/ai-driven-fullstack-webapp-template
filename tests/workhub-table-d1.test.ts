import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {DatabaseSync} from "node:sqlite";
import {D1WorkhubTableViewsStore} from "../src/worker/d1-workhub-table-views-store";
import {defaultTablePreference,travelTableDefinition as def} from "../src/shared/data-table";
import {loadTravelTablePage} from "../src/reference/workhub/travel-request/table-query";
const setup=()=>{
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);");
 sqlite.exec(readFileSync("migrations/0039_workhub_table_views.sql","utf8"));
 sqlite.exec("CREATE TABLE reference_travel_requests(id TEXT PRIMARY KEY,environment TEXT,requester_id TEXT,purpose TEXT,status TEXT,start_date TEXT,updated_at TEXT)");
 sqlite.prepare("INSERT INTO users(id) VALUES(?),(?)").run("workhub-demo-aoi","workhub-demo-ren");
 const db={prepare(sql:string){const stmt=sqlite.prepare(sql);return{bind(...args:(string|number|null)[]){return{
  first:async()=>stmt.get(...args)??null,
  all:async()=>({results:stmt.all(...args)}),
  run:async()=>({meta:{changes:stmt.run(...args).changes}}),
 }}}}} as unknown as D1Database;
 return{sqlite,db,store:new D1WorkhubTableViewsStore(db,"local","workhub-demo-aoi")};
};
test("#291 local D1 preference save and version CAS preserve users and environments",async()=>{
 const {sqlite,db,store}=setup();
 try{
  const initial=await store.getPreference();assert.equal(initial.version,0);
  const saved=await store.savePreference(initial,0);assert.equal(saved.version,1);
  await assert.rejects(store.savePreference(initial,0),/version_conflict/);
  const again=new D1WorkhubTableViewsStore(db,"local","workhub-demo-aoi");
  assert.equal((await again.getPreference()).version,1);
  assert.equal((await new D1WorkhubTableViewsStore(db,"local","workhub-demo-ren").getPreference()).version,0);
  assert.equal((await new D1WorkhubTableViewsStore(db,"test","workhub-demo-aoi").getPreference()).version,0);
 }finally{sqlite.close()}
});
test("#291 saved views isolate owner, CAS update/delete and prevent stale overwrite",async()=>{
 const {sqlite,db,store}=setup();
 try{
  const pref=defaultTablePreference(def);
  const input={tableId:def.id,name:"未処理",schemaVersion:1,filters:{status:"draft"},
   sort:{key:"updatedAt",direction:"desc"},columnOrder:pref.columnOrder,
   visibleColumns:pref.visibleColumns,pageSize:10,density:"comfortable",isDefault:false};
  const v=await store.createView(input);assert.equal(v.version,1);
  assert.equal((await store.listViews()).length,1);
  assert.equal((await new D1WorkhubTableViewsStore(db,"local","workhub-demo-ren").listViews()).length,0);
  assert.equal((await new D1WorkhubTableViewsStore(db,"production","workhub-demo-aoi").listViews()).length,0);
  const updated=await store.updateView(v.id,{...input,name:"提出待ち"},1);
  assert.equal(updated.version,2);
  await assert.rejects(store.updateView(v.id,input,1),/version_conflict/);
  await assert.rejects(store.createView({...input,filters:{secret:"yes"}}),/Invalid saved filter/);
  await assert.rejects(store.deleteView(v.id,1),/version_conflict/);
  await store.deleteView(v.id,2);
  assert.equal((await store.listViews()).length,0);
 }finally{sqlite.close()}
});
test("#291 pagination: owner scoped SQL, bounded cursor, allowed sort/filter",async()=>{
 const {sqlite,db}=setup();
 try{
  const ins=sqlite.prepare("INSERT INTO reference_travel_requests(id,environment,requester_id,purpose,status,start_date,updated_at) VALUES(?,?,?,?,?,?,?)");
  for(const [id,user,status] of [["a","workhub-demo-aoi","draft"],["b","workhub-demo-aoi","submitted"],["z","workhub-demo-ren","draft"]] as const){
   ins.run(id,"local",user,"local-only",status,"2026-11-01","2026-11-04");
  }
  const p=await loadTravelTablePage(db,"local","workhub-demo-aoi",new URLSearchParams("limit=1"));
  assert.equal(p.ok,true);
  if(!p.ok)return;
  assert.equal(p.value.items.length,1);assert.ok(p.value.pagination.nextCursor);
  const next=await loadTravelTablePage(db,"local","workhub-demo-aoi",
   new URLSearchParams({limit:"1",cursor:p.value.pagination.nextCursor!}));
  assert.equal(next.ok,true);
  if(next.ok){assert.equal(next.value.items.length,1);assert.notEqual(next.value.items[0].id,p.value.items[0].id)}
  const filter=await loadTravelTablePage(db,"local","workhub-demo-aoi",new URLSearchParams("filter.status=draft"));
  assert.equal(filter.ok,true);if(filter.ok)assert.deepEqual(filter.value.items.map(r=>r.id),["a"]);
 }finally{sqlite.close()}
});
