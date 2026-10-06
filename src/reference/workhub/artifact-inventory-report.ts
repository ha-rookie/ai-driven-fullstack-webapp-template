import {
  buildReportViewModel,
  type GeneratedArtifact,
  type ReportDefinition,
  type ReportGenerationIntent,
  type ReportViewModel,
  type XlsxWorkbookTemplate,
} from "../../shared/report";

export interface ArtifactInventoryRow {
  readonly artifactId: string;
  readonly reportKey: string;
  readonly definitionVersion: string;
  readonly templateVersion: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outputType: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly generatedAt: string | null;
  readonly byteLength: number | null;
  readonly generationIntent: ReportGenerationIntent;
  readonly environment: string;
}

export interface ArtifactInventoryReportData {
  readonly rows: readonly ArtifactInventoryRow[];
}

const validateData = (value: unknown): ArtifactInventoryReportData => {
  if (!value || typeof value !== "object" || !Array.isArray((value as ArtifactInventoryReportData).rows)) {
    throw new TypeError("artifact inventory report data is invalid");
  }
  return value as ArtifactInventoryReportData;
};

export const WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT: ReportDefinition<ArtifactInventoryReportData> = {
  key: "workhub.artifact-inventory",
  version: "1",
  templateKey: "workhub.artifact-inventory.xlsx",
  templateVersion: "1",
  outputTypes: ["xlsx"],
  validateData,
};

export const WORKHUB_ARTIFACT_INVENTORY_XLSX_TEMPLATE: XlsxWorkbookTemplate<ArtifactInventoryReportData> = {
  key: WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT.templateKey,
  version: WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT.templateVersion,
  build(viewModel) {
    return {
      sheets: [{
        name: "生成帳票一覧",
        rows: [
          ["Artifact ID", "Report", "Definition", "Template", "Resource Type", "Resource ID", "Output", "Status", "Requested At", "Generated At", "Bytes", "Intent", "Environment"],
          ...viewModel.data.rows.map((row) => [
            row.artifactId,
            row.reportKey,
            row.definitionVersion,
            row.templateVersion,
            row.resourceType,
            row.resourceId,
            row.outputType,
            row.status,
            row.requestedAt,
            row.generatedAt,
            row.byteLength,
            row.generationIntent,
            row.environment,
          ]),
        ],
      }],
    };
  },
};

export const buildWorkhubArtifactInventoryReport = (input: {
  readonly artifacts: readonly GeneratedArtifact[];
  readonly inventoryId: string;
  readonly sourceVersion: string;
  readonly capturedAt: string;
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly intent?: ReportGenerationIntent;
}): ReportViewModel<ArtifactInventoryReportData> => {
  const rows = input.artifacts.map((artifact): ArtifactInventoryRow => ({
    artifactId: artifact.id,
    reportKey: artifact.reportKey,
    definitionVersion: artifact.definitionVersion,
    templateVersion: artifact.templateVersion,
    resourceType: artifact.resourceType,
    resourceId: artifact.resourceId,
    outputType: artifact.outputType,
    status: artifact.status,
    requestedAt: artifact.requestedAt,
    generatedAt: artifact.generatedAt ?? null,
    byteLength: artifact.byteLength ?? null,
    generationIntent: artifact.generationIntent,
    environment: artifact.environment,
  }));

  return buildReportViewModel({
    definition: WORKHUB_ARTIFACT_INVENTORY_XLSX_REPORT,
    resourceRef: { type: "generated_artifact_inventory", id: input.inventoryId },
    sourceSnapshot: {
      id: `artifact-inventory:${input.inventoryId}:${input.sourceVersion}`,
      sourceVersion: input.sourceVersion,
      capturedAt: input.capturedAt,
    },
    generationIntent: input.intent ?? "original",
    generatedBy: input.generatedBy,
    generatedAt: input.generatedAt,
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    data: { rows },
  });
};
