import {expect,test} from "@playwright/test";
test("#291 personal travel Saved View survives separate browser context and rejects other roles",async({browser,page})=>{
 await page.goto("/");
 await page.getByRole("button",{name:"デモユーザを選ぶ"}).click();
 await page.getByRole("dialog",{name:"デモユーザを選ぶ"}).getByRole("button",{name:/Aoi Employee/u}).click();
 await page.getByRole("button",{name:"ログイン",exact:true}).click();
 const panel=page.locator("#workhub-data-table");
 await expect(panel).toBeVisible();
 await expect(panel.getByRole("combobox",{name:"出張テーブル状態"})).toBeEnabled();
 await panel.getByRole("combobox",{name:"出張テーブル状態"}).selectOption("draft");
 await panel.getByRole("combobox",{name:"出張テーブル表示密度"}).selectOption("compact");
 await panel.getByRole("textbox",{name:"保存ビュー名"}).fill("Aoi-#291-cross-device");
 await panel.getByRole("button",{name:"新規保存"}).click();
 await expect(panel.getByRole("status").last()).toContainText("保存ビューを登録しました");
 const second=await browser.newContext({viewport:{width:390,height:844}});
 try{
  const other=await second.newPage();
  await other.goto("/");
  await other.getByRole("button",{name:"デモユーザを選ぶ"}).click();
  await other.getByRole("dialog",{name:"デモユーザを選ぶ"}).getByRole("button",{name:/Aoi Employee/u}).click();
  await other.getByRole("button",{name:"ログイン",exact:true}).click();
  const saved=other.locator("#workhub-data-table");
  await expect(saved.getByRole("option",{name:"Aoi-#291-cross-device"})).toBeAttached();
  const views=saved.getByRole("combobox",{name:"保存ビューを選択"});
  const options=await views.locator("option").all();
  const match=await Promise.all(options.map(async o=>({text:await o.textContent(),value:await o.getAttribute("value")})));
  const selected=match.find(o=>o.text==="Aoi-#291-cross-device");
  expect(selected?.value).toBeTruthy();
  await views.selectOption(selected!.value!);
  await expect(saved.getByRole("combobox",{name:"出張テーブル状態"})).toHaveValue("draft");
  await expect(saved.getByRole("combobox",{name:"出張テーブル表示密度"})).toHaveValue("compact");
  await expect(saved).toBeVisible();
 }finally{await second.close()}
 await panel.getByRole("combobox",{name:"保存ビューを選択"}).selectOption({label:"Aoi-#291-cross-device"});
 await panel.getByRole("button",{name:"削除"}).click();
 await expect(panel.getByRole("status").last()).toContainText("保存ビューを削除しました");
});
test("#291 unsupported table query fails closed; Ren cannot read Aoi table",async({page})=>{
 await page.goto("/");
 await page.getByRole("button",{name:"デモユーザを選ぶ"}).click();
 await page.getByRole("dialog",{name:"デモユーザを選ぶ"}).getByRole("button",{name:/Ren Manager/u}).click();
 await page.getByRole("button",{name:"ログイン",exact:true}).click();
 const response=await page.evaluate(async()=>fetch("/api/workhub/table/travel",{credentials:"same-origin"}).then(r=>r.status));
 expect(response).toBe(403);
 await expect(page.locator("#workhub-data-table")).toHaveCount(0);
});
