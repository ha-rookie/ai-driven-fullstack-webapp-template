import assert from "node:assert/strict";
import test from "node:test";

import { validateXlsxWorkbookModel, xlsxLiteralText } from "../src/shared/report";

test("XLSX workbook contract accepts bounded Japanese literal data", () => {
  const model=validateXlsxWorkbookModel({sheets:[{name:"出張承認",rows:[["申請者","青井"],["行先","東京"],["承認済み",true],["金額",12000]]}]});
  assert.equal(model.sheets[0]?.rows[0]?.[1],"青井");
});

test("formula-like text is escaped as literal spreadsheet text", () => {
  assert.equal(xlsxLiteralText("=1+1"),"'=1+1");
  assert.equal(xlsxLiteralText("+SUM(A1:A2)"),"'+SUM(A1:A2)");
  assert.equal(xlsxLiteralText("-2+3"),"'-2+3");
  assert.equal(xlsxLiteralText("@cmd"),"'@cmd");
  assert.equal(xlsxLiteralText("東京"),"東京");
});

test("XLSX contract rejects unsafe sheet names and unbounded cells", () => {
  assert.throws(()=>validateXlsxWorkbookModel({sheets:[{name:"bad/name",rows:[]}]}),/sheet name/u);
  assert.throws(()=>validateXlsxWorkbookModel({sheets:[{name:"Sheet1",rows:[["x".repeat(32768)]]}]}),/cell text/u);
});
