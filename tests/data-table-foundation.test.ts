import assert from "node:assert/strict";
import test from "node:test";
import {defaultTablePreference, normalizeTableUrl,resolveSavedView,travelTableDefinition as d,validateSavedView,validateTablePreference} from "../src/shared/data-table";
test("#291: provider-neutral column state validates allowed columns, order, widths and density",()=>{
 const pref=defaultTablePreference(d);
 assert.equal(pref.tableId,d.id);
 assert.equal(validateTablePreference(d,pref).pageSize,10);
 assert.throws(()=>validateTablePreference(d,{...pref,visibleColumns:["unauthorized"]}),/column/i);
 assert.throws(()=>validateTablePreference(d,{...pref,columnWidths:{purpose:10}}),/width/i);
 assert.throws(()=>validateTablePreference(d,{...pref,density:"tiny"}),/preference/i);
});
test("#291: saved personal view rejects unsupported filters and schema drift",()=>{
 const pref=defaultTablePreference(d);
 const view={id:"personal-1",tableId:d.id,name:"差戻し待ち",schemaVersion:1,
 filters:{status:"draft"},sort:{key:"updatedAt",direction:"desc" as const},
 columnOrder:pref.columnOrder,visibleColumns:pref.visibleColumns,
 pageSize:10,density:"compact" as const,isDefault:false,version:1};
 assert.deepEqual(validateSavedView(d,view).filters,{status:"draft"});
 assert.equal(resolveSavedView(d,{...view,schemaVersion:99}).needsMigration,true);
 assert.equal(resolveSavedView(d,{...view,visibleColumns:["secret"]}).needsMigration,true);
 assert.throws(()=>validateSavedView(d,{...view,filters:{admin:true}}),/filter/i);
});
test("#291: table URL permits only public sort/filter; no legacy state blobs",()=>{
 assert.equal(normalizeTableUrl(d,new URLSearchParams("filter.status=draft")).status,"draft");
 assert.throws(()=>normalizeTableUrl(d,new URLSearchParams("sort=password")),/URL/);
 assert.throws(()=>normalizeTableUrl(d,new URLSearchParams("filter.status=secret")),/URL/);
});
