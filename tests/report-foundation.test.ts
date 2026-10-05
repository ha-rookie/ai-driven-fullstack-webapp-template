import { describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../src/shared/object-storage";
import {
  InMemoryReportArtifactStore,
  ReportApplicationService,
  SafeHtmlReportRenderer,
  escapeHtml,
  type ReportDefinition,
  type ReportViewModel,
} from "../src/shared/report";

const definition: ReportDefinition = {
  key: "travel.approval",
  version: "1",
  templateKey: "travel.approval.standard",
  templateVersion: "1",
  outputTypes: ["html", "pdf"],
};

const ids = (...values: string[]) => {
  let index = 0;
  return { generate: () => values[index++] ?? `id-${index}` };
};

const viewModel = (): ReportViewModel<{ purpose: string }> => ({
  reportKey: definition.key,
  definitionVersion: definition.version,
  resource: { resourceType: "travel_request", resourceId: "tr-1" },
  sourceSnapshot: {
    id: "snapshot-1",
    sourceVersion: "7",
    capturedAt: "2026-10-05T00:00:00.000Z",
    references: { officeRevisionId: "office-rev-3" },
  },
  generatedBy: "user-aoi",
  generatedAt: "2026-10-05T00:01:00.000Z",
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  data: { purpose: "<script>alert(1)</script> 東京出張" },
});

describe("report foundation", () => {
  it("builds, validates, renders and stores an immutable artifact with snapshot/template identity", async () => {
    const storage = new InMemoryObjectStorage({ environment: "test" });
    const artifacts = new InMemoryReportArtifactStore();
    const service = new ReportApplicationService({
      environment: "test",
      artifacts,
      objectStorage: storage,
      authorization: {
        async assertCanGenerate() {},
        async assertCanDownload() {},
      },
      idGenerator: ids("object-1", "artifact-1"),
    });
    const renderer = new SafeHtmlReportRenderer<{ purpose: string }>({
      title: () => "出張申請書",
      filename: () => "travel-request.html",
      renderBody: data => `<h1>${escapeHtml(data.purpose)}</h1>`,
    });

    const artifact = await service.generate({
      principalId: "user-aoi",
      definition,
      builder: { async build() { return viewModel(); } },
      validator: { validate(value) { return value as ReportViewModel<{ purpose: string }>; } },
      renderer,
      resource: { resourceType: "travel_request", resourceId: "tr-1" },
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
    });

    expect(artifact.id).toBe("artifact-1");
    expect(artifact.sourceSnapshotId).toBe("snapshot-1");
    expect(artifact.templateVersion).toBe("1");
    expect(artifact.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    const stored = await storage.get("object-1");
    expect(stored).not.toBeNull();
    const html = await new Response(stored!.body).text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("reuses the same original generation identity but separates a reissue", async () => {
    const storage = new InMemoryObjectStorage({ environment: "test" });
    const artifacts = new InMemoryReportArtifactStore();
    const service = new ReportApplicationService({
      environment: "test",
      artifacts,
      objectStorage: storage,
      authorization: { async assertCanGenerate() {}, async assertCanDownload() {} },
      idGenerator: ids("object-1", "artifact-1", "object-2", "artifact-2"),
    });
    const renderer = new SafeHtmlReportRenderer<{ purpose: string }>({
      title: () => "Report",
      filename: () => "report.html",
      renderBody: data => `<p>${escapeHtml(data.purpose)}</p>`,
    });
    const input = {
      principalId: "user-aoi",
      definition,
      builder: { async build() { return viewModel(); } },
      validator: { validate(value: ReportViewModel<unknown>) { return value as ReportViewModel<{ purpose: string }>; } },
      renderer,
      resource: { resourceType: "travel_request", resourceId: "tr-1" },
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
    };

    const original = await service.generate(input);
    const duplicate = await service.generate(input);
    const reissue = await service.generate({ ...input, intent: "reissue" });

    expect(duplicate.id).toBe(original.id);
    expect(reissue.id).not.toBe(original.id);
    expect(reissue.intent).toBe("reissue");
  });

  it("re-evaluates authorization before download", async () => {
    let allowed = true;
    const artifacts = new InMemoryReportArtifactStore();
    const storage = new InMemoryObjectStorage({ environment: "test" });
    const service = new ReportApplicationService({
      environment: "test",
      artifacts,
      objectStorage: storage,
      authorization: {
        async assertCanGenerate() {},
        async assertCanDownload() { if (!allowed) throw new Error("forbidden"); },
      },
      idGenerator: ids("object-1", "artifact-1"),
    });
    const renderer = new SafeHtmlReportRenderer<{ purpose: string }>({
      title: () => "Report", filename: () => "report.html", renderBody: data => escapeHtml(data.purpose),
    });
    const artifact = await service.generate({
      principalId: "user-aoi", definition,
      builder: { async build() { return viewModel(); } },
      validator: { validate(value) { return value as ReportViewModel<{ purpose: string }>; } },
      renderer, resource: { resourceType: "travel_request", resourceId: "tr-1" },
      locale: "ja-JP", timezone: "Asia/Tokyo",
    });
    allowed = false;
    await expect(service.assertCanDownload("user-aoi", artifact.id)).rejects.toThrow("forbidden");
  });
});
