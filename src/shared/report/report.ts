const TOKEN = /^[a-z][a-z0-9._-]{0,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ReportOutputType = "html" | "pdf" | "xlsx" | "csv";
export type ReportGenerationIntent = "original" | "regenerated_copy" | "reissue";

export interface ReportDefinition<TData> {
  readonly key: string;
  readonly version: string;
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly outputTypes: readonly ReportOutputType[];
  readonly validateData: (value: unknown) => TData;
}
export interface ReportSourceSnapshot {
  readonly id: string;
  readonly sourceVersion: string;
  readonly capturedAt: string;
  readonly masterRevisionRefs?: readonly string[];
  readonly decisionRefs?: readonly string[];
}
export interface ReportViewModel<TData> {
  readonly reportKey: string;
  readonly definitionVersion: string;
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly resourceRef: { readonly type: string; readonly id: string };
  readonly sourceSnapshot: ReportSourceSnapshot;
  readonly generationIntent: ReportGenerationIntent;
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly locale: string;
  readonly timezone: string;
  readonly data: TData;
}
export interface RenderedReport { readonly body: Uint8Array; readonly contentType: string; readonly suggestedFilename: string; }
export interface ReportRenderer {
  readonly key: string;
  readonly supportedOutputTypes: readonly ReportOutputType[];
  render<TData>(input: { readonly definition: ReportDefinition<TData>; readonly viewModel: ReportViewModel<TData>; readonly outputType: ReportOutputType }): Promise<RenderedReport>;
}
export interface GeneratedArtifact {
  readonly id: string; readonly environment: string; readonly reportKey: string; readonly definitionVersion: string;
  readonly templateKey: string; readonly templateVersion: string; readonly resourceType: string; readonly resourceId: string;
  readonly sourceSnapshotId: string; readonly generationIntent: ReportGenerationIntent; readonly outputType: ReportOutputType;
  readonly objectIdentifier: string; readonly contentType: string; readonly byteLength: number; readonly generatedAt: string;
  readonly generatedBy: string; readonly status: "ready"; readonly version: number;
}
const bounded=(value:string,name:string):string=>{const normalized=value.trim();if(!normalized||normalized.length>256||/[\u0000-\u001f\u007f]/u.test(normalized))throw new TypeError(`${name} is invalid`);return normalized;};
const iso=(value:string,name:string):string=>{const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)throw new TypeError(`${name} must be an ISO-8601 UTC timestamp`);return value;};
export const buildReportViewModel=<TData>(input:{readonly definition:ReportDefinition<TData>;readonly resourceRef:{readonly type:string;readonly id:string};readonly sourceSnapshot:ReportSourceSnapshot;readonly generationIntent:ReportGenerationIntent;readonly generatedBy:string;readonly generatedAt:string;readonly locale:string;readonly timezone:string;readonly data:unknown;}):ReportViewModel<TData>=>{
 if(!TOKEN.test(input.definition.key))throw new TypeError("report definition key is invalid");
 if(!VERSION.test(input.definition.version))throw new TypeError("report definition version is invalid");
 if(!TOKEN.test(input.definition.templateKey))throw new TypeError("template key is invalid");
 if(!VERSION.test(input.definition.templateVersion))throw new TypeError("template version is invalid");
 if(input.definition.outputTypes.length===0)throw new TypeError("report outputTypes must not be empty");
 return Object.freeze({reportKey:input.definition.key,definitionVersion:input.definition.version,templateKey:input.definition.templateKey,templateVersion:input.definition.templateVersion,resourceRef:Object.freeze({type:bounded(input.resourceRef.type,"resourceRef.type"),id:bounded(input.resourceRef.id,"resourceRef.id")}),sourceSnapshot:Object.freeze({...input.sourceSnapshot,id:bounded(input.sourceSnapshot.id,"sourceSnapshot.id"),sourceVersion:bounded(input.sourceSnapshot.sourceVersion,"sourceSnapshot.sourceVersion"),capturedAt:iso(input.sourceSnapshot.capturedAt,"sourceSnapshot.capturedAt")}),generationIntent:input.generationIntent,generatedBy:bounded(input.generatedBy,"generatedBy"),generatedAt:iso(input.generatedAt,"generatedAt"),locale:bounded(input.locale,"locale"),timezone:bounded(input.timezone,"timezone"),data:input.definition.validateData(input.data)});
};