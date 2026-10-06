import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportViewModel,
  WriteExcelFileReportRenderer,
  type ReportDefinition,
  type XlsxWorkbookTemplate,
} from "../src/shared/report";

type TestData = { title: string; formulaLike: string };

const definition: ReportDefinition<TestData> = {
  key: "xlsx.test",
  version: "1",
  templateKey: "xlsx.test.template",
  templateVersion: "1",
  outputTypes: ["xlsx"],
  validateData(value) {
    return value as TestData;
  },
};

const viewModel = buildReportViewModel({
  definition,
  resourceRef: { type: "test", id: "1" },
  sourceSnapshot: {
    id: "snapshot-1",
    sourceVersion: "1",
    capturedAt: "2026-10-06T00:00:00.000Z",
  },
  generationIntent: "original",
  generatedBy: "test-user",
  generatedAt: "2026-10-06T00:00:00.000Z",
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  data: { title: "出張申請承認書", formulaLike: "=1+1" },
});

test("write-excel-file adapter emits real XLSX bytes with Japanese data", async () => {
  const template: XlsxWorkbookTemplate<unknown> = {
    key: "xlsx.test.template",
    version: "1",
    build(vm) {
      const data = vm.data as TestData;
      return {
        sheets: [
          {
            name: "承認書",
            rows: [[data.title], ["申請者：青井"], [data.formulaLike]],
          },
        ],
      };
    },
  };

  const renderer = new WriteExcelFileReportRenderer(() => template);
  const rendered = await renderer.render({
    definition,
    viewModel,
    outputType: "xlsx",
  });

  assert.equal(
    rendered.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(rendered.suggestedFilename, "xlsx.test.xlsx");
  assert.ok(rendered.body.byteLength > 100);
  assert.deepEqual(Array.from(rendered.body.slice(0, 2)), [0x50, 0x4b]);
});
