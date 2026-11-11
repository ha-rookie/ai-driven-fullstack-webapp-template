import {useEffect,useMemo,useState} from "react";
import {tableFeatures,useTable} from "@tanstack/react-table";
import {defaultTablePreference,normalizeTableUrl,resolveSavedView,travelTableDefinition as def,
 type SavedView,type TablePreference,type SortDirection} from "../../shared/data-table";
import {useUserPreferences} from "../../frontend/preferences/context";
import type {WorkhubTableRow} from "./travel-request/table-query";
import "./data-table.css";
const features=tableFeatures({});
const labels:Record<string,string>={purpose:"申請内容",status:"状態",startDate:"開始日",updatedAt:"更新日",id:"識別番号"};
// Keep column-editor labels distinct from the existing travel-form accessible names.
const editorLabels:Record<string,string>={...labels,startDate:"出張の初日"};
const readInitial=()=>{
 if(typeof window==="undefined")return{sort:"updatedAt",direction:"desc" as SortDirection,status:""};
 try{return normalizeTableUrl(def,new URLSearchParams(window.location.search))}
 catch{return{sort:"updatedAt",direction:"desc" as SortDirection,status:""}}
};
const csrf=async()=>{
 const r=await fetch("/api/auth/csrf",{credentials:"same-origin",cache:"no-store"});
 if(!r.ok)throw new Error("CSRF token unavailable");
 const j=await r.json() as {csrfToken?:string};
 if(!j.csrfToken)throw new Error("CSRF token unavailable");
 return j.csrfToken;
};
const api=async<T,>(url:string,method="GET",body?:unknown):Promise<T>=>{
 const headers:Record<string,string>={};
 if(method!=="GET"){headers["content-type"]="application/json";headers["x-csrf-token"]=await csrf()}
 const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:"same-origin",cache:"no-store"});
 if(!r.ok)throw new Error(r.status===409?"別の操作で設定が更新されました。再読み込みしてください。":r.status===403?"この設定を操作する権限がありません。":"一覧・保存ビューを取得または保存できませんでした（HTTP "+r.status+"）");
 return r.json() as Promise<T>;
};
export default function DataTableReferencePanel(){
 const prefs=useUserPreferences();
 const locale=prefs.resolved.locale==="en"?"en-US":"ja-JP";
 const [pref,setPref]=useState<TablePreference>(()=>defaultTablePreference(def));
 const [views,setViews]=useState<readonly SavedView[]>([]);
 const [initial]=useState(readInitial);
 const [sort,setSort]=useState(initial.sort);
 const [direction,setDirection]=useState<SortDirection>(initial.direction);
 const [status,setStatus]=useState(initial.status);
 const [cursor,setCursor]=useState<string|null>(null);
 const [nextCursor,setNextCursor]=useState<string|null>(null);
 const [items,setItems]=useState<readonly WorkhubTableRow[]>([]);
 const [load,setLoad]=useState<"loading"|"ready"|"error">("loading");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [name,setName]=useState("未処理の申請");
 const [selected,setSelected]=useState("");
 const [savedLoad,setSavedLoad]=useState<"loading"|"ready"|"error">("loading");
 // StrictMode can start overlapping bootstrap reads. An obsolete response must
 // never overwrite the user's edits after the current read has made them editable.
 useEffect(()=>{
  let active=true;
  void Promise.all([
   api<{preference:TablePreference}>("/api/workhub/table-preferences"),
   api<{views:SavedView[]}>("/api/workhub/saved-views"),
  ]).then(([p,v])=>{
   if(!active)return;
   setPref(p.preference);setViews(v.views);setSavedLoad("ready");
  }).catch(()=>{
   if(active){setSavedLoad("error");setMessage("保存済み設定を取得できません。0件とは限りません。")}
  });
  return()=>{active=false};
 },[]);
 useEffect(()=>{
  const search=new URLSearchParams({sort,direction,limit:String(pref.pageSize)});
  if(status)search.set("filter.status",status);
  if(cursor)search.set("cursor",cursor);
  const controller=new AbortController();
  setLoad("loading");
  void api<{items:WorkhubTableRow[];pagination:{nextCursor:string|null;limit:number;hasMore:boolean}}>(
   "/api/workhub/table/travel?"+search.toString(),
  ).then(v=>{if(controller.signal.aborted)return;setItems(v.items);setNextCursor(v.pagination.nextCursor);setLoad("ready")})
  .catch(()=>{if(controller.signal.aborted)return;setItems([]);setLoad("error")});
  return()=>controller.abort();
 },[sort,direction,status,cursor,pref.pageSize]);
 useEffect(()=>{
  if(typeof window==="undefined")return;
  const u=new URL(window.location.href);
  for(const key of ["sort","direction","filter.status","cursor"])u.searchParams.delete(key);
  // Preserve the plain WORKHUB URL for default settings so /#workhub-* links
  // remain in-page navigation instead of reloading a query-mutated document.
  if(sort!==def.defaultSort.key)u.searchParams.set("sort",sort);
  if(direction!==def.defaultSort.direction)u.searchParams.set("direction",direction);
  if(status)u.searchParams.set("filter.status",status);
  if(cursor)u.searchParams.set("cursor",cursor);
  // #152: intra-page filter/sort is replaceState, not an extra Back entry.
  const target=u.pathname+u.search+u.hash;
  if(target!==window.location.pathname+window.location.search+window.location.hash)
   window.history.replaceState(window.history.state,"",target);
 },[sort,direction,status,cursor]);
 const refresh=()=>{setCursor(null);setMessage("");setLoad("loading");
  // force a GET even when state has not changed by refreshing the page's source.
  const q=new URLSearchParams({sort,direction,limit:String(pref.pageSize)});
  if(status)q.set("filter.status",status);
  void api<{items:WorkhubTableRow[];pagination:{nextCursor:string|null}}>("/api/workhub/table/travel?"+q.toString())
   .then(v=>{setItems(v.items);setNextCursor(v.pagination.nextCursor);setLoad("ready")})
   .catch(()=>setLoad("error"));
 };
 const columns=useMemo(()=>{
  const keys=pref.columnOrder.filter(k=>pref.visibleColumns.includes(k));
  return keys.map(k=>({id:k,accessorKey:k,header:labels[k]??k,cell:(ctx:{getValue:()=>unknown})=>{
   const value=ctx.getValue();
   return k==="updatedAt"&&typeof value==="string"?new Date(value).toLocaleString(locale):String(value??"");
  }}));
 },[pref.columnOrder,pref.visibleColumns,locale]);
 const table=useTable({features,columns,data:items});
 const setVisible=(key:string,visible:boolean)=>{
  const next=visible?[...pref.visibleColumns,key]:pref.visibleColumns.filter(k=>k!==key);
  if(next.length)setPref(p=>({...p,visibleColumns:next}));
 };
 const move=(key:string,step:number)=>{
  const a=[...pref.columnOrder],index=a.indexOf(key),to=index+step;
  if(index<0||to<0||to>=a.length)return;
  [a[index],a[to]]=[a[to],a[index]];
  setPref(p=>({...p,columnOrder:a}));
 };
 const savePref=async()=>{
  setBusy(true);setMessage("");
  try{
   const r=await api<{preference:TablePreference}>("/api/workhub/table-preferences","PUT",
    {expectedVersion:pref.version,preference:pref});
   setPref(r.preference);setMessage("一覧の表示設定を保存しました");
  }catch(e){setMessage(e instanceof Error?e.message:"設定保存に失敗しました")}
  finally{setBusy(false)}
 };
 const viewPayload=()=>({
  tableId:def.id,name,schemaVersion:def.schemaVersion,filters:status?{status}:{},
  sort:{key:sort,direction},columnOrder:pref.columnOrder,
  visibleColumns:pref.visibleColumns,pageSize:pref.pageSize,density:pref.density,isDefault:false,
 });
 const saveView=async(edit=false)=>{
  setBusy(true);setMessage("");
  try{
   if(edit){
    const old=views.find(v=>v.id===selected);
    if(!old)throw new Error("変更する保存ビューを選択してください");
    await api("/api/workhub/saved-views/"+encodeURIComponent(old.id),"PATCH",
     {expectedVersion:old.version,view:viewPayload()});
   }else{
    await api("/api/workhub/saved-views","POST",viewPayload());
   }
   const r=await api<{views:SavedView[]}>("/api/workhub/saved-views");
   setViews(r.views);setMessage(edit?"保存ビューを更新しました":"保存ビューを登録しました");
  }catch(e){setMessage(e instanceof Error?e.message:"保存ビューを変更できませんでした")}
  finally{setBusy(false)}
 };
 const removeView=async()=>{
  const old=views.find(v=>v.id===selected);
  if(!old)return;
  setBusy(true);setMessage("");
  try{
   await api("/api/workhub/saved-views/"+encodeURIComponent(old.id),"DELETE",{expectedVersion:old.version});
   const r=await api<{views:SavedView[]}>("/api/workhub/saved-views");
   setViews(r.views);setSelected("");setMessage("保存ビューを削除しました");
  }catch(e){setMessage(e instanceof Error?e.message:"削除できませんでした")}
  finally{setBusy(false)}
 };
 const apply=(id:string)=>{
  setSelected(id);const candidate=views.find(v=>v.id===id);if(!candidate)return;
  const result=resolveSavedView(def,candidate);
  if(!result.view){setMessage("この保存ビューは列や条件が変更されたため更新が必要です");return}
  const v=result.view;setName(v.name);setSort(v.sort.key);setDirection(v.sort.direction);
  setStatus(v.filters.status??"");setCursor(null);
  setPref(p=>({...p,columnOrder:v.columnOrder,visibleColumns:v.visibleColumns,pageSize:v.pageSize,density:v.density}));
  setMessage("保存ビューを適用しました。画面で変更した設定は保存操作まで未確定です。");
 };
 return <section className="workhub-table-foundation" id="workhub-data-table" aria-labelledby="workhub-data-table-heading" data-testid="workhub-data-table">
  <div className="workhub-section-heading"><div><span className="workhub-card-label">DATA TABLE / SAVED VIEWS</span>
   <h2 id="workhub-data-table-heading">出張申請テーブル（本人専用）</h2></div>
   <button type="button" onClick={refresh}>一覧を再取得</button></div>
  <p className="workhub-reference-note">現在の本人が提出した出張申請だけをサーバーで絞り込みます。総件数は未取得です。</p>
  <div className="workhub-table-controls">
   <label>状態<select aria-label="出張テーブル状態" value={status} onChange={e=>{setStatus(e.target.value);setCursor(null)}}>
    <option value="">すべて</option><option value="draft">下書き</option>
    <option value="submitting">提出中</option><option value="submitted">提出済み</option></select></label>
   <label>並び替え<select aria-label="出張テーブルソート" value={sort} onChange={e=>{setSort(e.target.value);setCursor(null)}}>
    <option value="updatedAt">更新日時</option><option value="id">識別番号</option></select></label>
   <label>方向<select aria-label="出張テーブルソート方向" value={direction} onChange={e=>{setDirection(e.target.value as SortDirection);setCursor(null)}}>
    <option value="desc">降順</option><option value="asc">昇順</option></select></label>
   <label>ページ件数<select aria-label="出張テーブルページ件数" value={pref.pageSize} disabled={savedLoad!=="ready"} onChange={e=>{setPref(p=>({...p,pageSize:Number(e.target.value)}));setCursor(null)}}>
    {def.allowedPageSizes.map(n=><option key={n} value={n}>{n}件</option>)}</select></label>
   <label>表示密度<select aria-label="出張テーブル表示密度" value={pref.density} disabled={savedLoad!=="ready"} onChange={e=>setPref(p=>({...p,density:e.target.value as TablePreference["density"]}))}>
    <option value="comfortable">ゆったり</option><option value="compact">コンパクト</option></select></label>
  </div>
  <details><summary>列の表示・順序・幅</summary>
   <div className="workhub-table-columns">{def.columns.map(col=><div key={col.key}>
    <label><input type="checkbox" disabled={savedLoad!=="ready"} checked={pref.visibleColumns.includes(col.key)} onChange={e=>setVisible(col.key,e.target.checked)}/>{editorLabels[col.key]}</label>
    <button type="button" disabled={savedLoad!=="ready"} onClick={()=>move(col.key,-1)} aria-label={editorLabels[col.key]+"を左へ"}>←</button>
    <button type="button" disabled={savedLoad!=="ready"} onClick={()=>move(col.key,1)} aria-label={editorLabels[col.key]+"を右へ"}>→</button>
    <label>幅<input type="number" disabled={savedLoad!=="ready"} min={col.minWidth??64} max={col.maxWidth??960} value={pref.columnWidths[col.key]??col.width??140}
     aria-label={editorLabels[col.key]+"の幅"} onChange={e=>setPref(p=>({...p,columnWidths:{...p.columnWidths,[col.key]:Number(e.target.value)}}))}/></label>
   </div>)}</div>
  </details>
  <button type="button" disabled={busy||savedLoad!=="ready"} onClick={()=>void savePref()}>表示設定を保存</button>
  {load==="loading"?<p role="status">一覧を読み込んでいます…</p>:
   load==="error"?<p role="alert">申請一覧を取得できません。0件とは限りません。</p>:
   items.length===0?<p className="workhub-empty-state" role="status">この検索条件に一致する申請はありません。</p>:
   <div className="workhub-table-scroll"><table className={pref.density==="compact"?"is-compact":""}>
    <thead>{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th key={h.id} scope="col" style={{width:pref.columnWidths[h.column.id]??def.columns.find(c=>c.key===h.column.id)?.width}}>
     {labels[h.column.id]??h.column.id}</th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row=><tr key={row.id}>{row.getAllCells().map(cell=><td key={cell.id}>{String(cell.getValue()??"")}</td>)}</tr>)}</tbody>
   </table></div>}
  <div className="workhub-table-pagination">
   <button type="button" disabled={!cursor||load!=="ready"} onClick={()=>setCursor(null)}>先頭へ戻る</button>
   <button type="button" disabled={!nextCursor||load!=="ready"} onClick={()=>setCursor(nextCursor)}>次のページ</button>
   <small>このページは{items.length}件・総件数は表示しません。</small>
  </div>
  <div className="workhub-table-saved" aria-label="保存ビュー">
   <h3>個人用保存ビュー</h3>
   {savedLoad==="error"&&<p role="alert">保存ビューを取得できません。設定の確認が必要です。</p>}
   <label>保存ビュー<select aria-label="保存ビューを選択" value={selected} onChange={e=>apply(e.target.value)}>
    <option value="">未選択</option>{views.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
   <label>ビュー名<input aria-label="保存ビュー名" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>
   <div className="workhub-table-actions">
    <button type="button" disabled={busy||savedLoad!=="ready"} onClick={()=>void saveView()}>新規保存</button>
    <button type="button" disabled={busy||!selected} onClick={()=>void saveView(true)}>更新</button>
    <button type="button" disabled={busy||!selected} onClick={()=>void removeView()}>削除</button>
   </div>
   {message&&<p role="status">{message}</p>}
  </div>
 </section>;
}
