import assert from "node:assert/strict";
import test from "node:test";
import {handleWorkhubTableApi} from "../src/worker/workhub-table-api";
import {loadTravelTablePage} from "../src/reference/workhub/travel-request/table-query";

test("#291 API only exposes an authenticated owner's personal table",async()=>{
 const db={prepare:()=>{throw new Error("must not query DB for forbidden principal")}} as unknown as D1Database;
 const foreign=await handleWorkhubTableApi(new Request("https://example.test/api/workhub/table/travel"),
  db,"local","workhub-demo-ren","req-1");
 assert.equal(foreign?.status,403);
 assert.equal(await handleWorkhubTableApi(new Request("https://example.test/api/health"),
  db,"local","workhub-demo-aoi","req-1"),null);
});
test("#291 #122 query parser rejects unknown field and invalid signed-cursor contract before D1",async()=>{
 const db={prepare:()=>{throw new Error("invalid query must not run SQL")}} as unknown as D1Database;
 for(const url of [
  "https://example.test/api/workhub/table/travel?sort=raw_sql_column",
  "https://example.test/api/workhub/table/travel?limit=100000",
  "https://example.test/api/workhub/table/travel?filter.admin=on",
  "https://example.test/api/workhub/table/travel?cursor=client-made-cursor",
  "https://example.test/api/workhub/table/travel?filter.status=secret",
 ]){
  const response=await handleWorkhubTableApi(new Request(url),db,"local","workhub-demo-aoi","req-1");
  assert.equal(response?.status,422,url);
 }
});
test("#291 #122 cursor status/filter mismatch rejects state widening",async()=>{
 const db={
  prepare:()=>({bind:()=>({all:async()=>({results:[
   {id:"travel-2",purpose:"A",status:"draft",startDate:"2026-11-01",updatedAt:"2026-11-02"},
   {id:"travel-1",purpose:"B",status:"draft",startDate:"2026-11-01",updatedAt:"2026-11-01"},
  ]})})})
 } as unknown as D1Database;
 const first=await loadTravelTablePage(db,"local","workhub-demo-aoi",new URLSearchParams("limit=1&filter.status=draft"));
 assert.equal(first.ok,true);
 if(!first.ok)return;
 assert.equal(first.value.items.length,1);
 const cursor=first.value.pagination.nextCursor;
 assert.ok(cursor);
 const altered=await loadTravelTablePage(db,"local","workhub-demo-aoi",new URLSearchParams({cursor:cursor!,limit:"1","filter.status":"submitted"}));
 assert.equal(altered.ok,false);
});
