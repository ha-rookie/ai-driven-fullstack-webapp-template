import type { ObjectStorage } from "../object-storage";
import type { GeneratedArtifact, ReportDefinition, ReportGenerationIntent, ReportOutputType, ReportRenderer, ReportViewModel } from "./report";

export interface GeneratedArtifactStore {
  get(id: string, environment: string): Promise<GeneratedArtifact | null>;
  findOriginal(input: { environment: string; reportKey: string; resourceType: string; resourceId: string; sourceSnapshotId: string; outputType: ReportOutputType }): Promise<GeneratedArtifact | null>;
  create(artifact: GeneratedArtifact): Promise<boolean>;
  transition(input: { id: string; environment: string; expectedVersion: number; from: GeneratedArtifact["status"]; to: GeneratedArtifact["status"]; patch?: Partial<Pick<GeneratedArtifact, "objectIdentifier" | "contentType" | "byteLength" | "failureCode">> }): Promise<GeneratedArtifact | null>;
}

export class InMemoryGeneratedArtifactStore implements GeneratedArtifactStore {
  private readonly records = new Map<string, GeneratedArtifact>();
  async get(id:string,environment:string){const value=this.records.get(`${environment}:${id}`);return value??null;}
  async findOriginal(input:{environment:string;reportKey:string;resourceType:string;resourceId:string;sourceSnapshotId:string;outputType:ReportOutputType}){
    return [...this.records.values()].find((value)=>value.environment===input.environment&&value.reportKey===input.reportKey&&value.resourceType===input.resourceType&&value.resourceId===input.resourceId&&value.sourceSnapshotId===input.sourceSnapshotId&&value.outputType===input.outputType&&value.generationIntent==="original")??null;
  }
  async create(artifact:GeneratedArtifact){const key=`${artifact.environment}:${artifact.id}`;if(this.records.has(key))return false;this.records.set(key,Object.freeze({...artifact}));return true;}
  async transition(input:{id:string;environment:string;expectedVersion:number;from:GeneratedArtifact["status"];to:GeneratedArtifact["status"];patch?:Partial<Pick<GeneratedArtifact,"objectIdentifier"|"contentType"|"byteLength"|"failureCode">>}){const key=`${input.environment}:${input.id}`;const current=this.records.get(key);if(!current||current.version!==input.expectedVersion||current.status!==input.from)return null;const next=Object.freeze({...current,...input.patch,status:input.to,version:current.version+1});this.records.set(key,next);return next;}
}

export interface ReportGenerationAuthorizer { assertCanGenerate(input:{principalId:string;resourceType:string;resourceId:string;reportKey:string}):Promise<void>|void; }

export class ReportArtifactService {
  constructor(private readonly options:{environment:string;storage:ObjectStorage;artifacts:GeneratedArtifactStore;authorizer:ReportGenerationAuthorizer;generateId:()=>string}){}
  async generate<TData>(input:{principalId:string;definition:ReportDefinition<TData>;viewModel:ReportViewModel<TData>;renderer:ReportRenderer;outputType:ReportOutputType;intent:ReportGenerationIntent}):Promise<GeneratedArtifact>{
    await this.options.authorizer.assertCanGenerate({principalId:input.principalId,resourceType:input.viewModel.resourceRef.type,resourceId:input.viewModel.resourceRef.id,reportKey:input.definition.key});
    if(input.intent==="original"){
      const existing=await this.options.artifacts.findOriginal({environment:this.options.environment,reportKey:input.definition.key,resourceType:input.viewModel.resourceRef.type,resourceId:input.viewModel.resourceRef.id,sourceSnapshotId:input.viewModel.sourceSnapshot.id,outputType:input.outputType});
      if(existing)return existing;
    }
    const rendered=await input.renderer.render({definition:input.definition,viewModel:input.viewModel,outputType:input.outputType});
    const artifactId=this.options.generateId();const objectIdentifier=this.options.generateId();
    const stored=await this.options.storage.put({identifier:objectIdentifier,body:rendered.body,metadata:{contentType:rendered.contentType},overwrite:"forbid"});
    const artifact:GeneratedArtifact=Object.freeze({id:artifactId,environment:this.options.environment,reportKey:input.definition.key,definitionVersion:input.definition.version,templateKey:input.definition.templateKey,templateVersion:input.definition.templateVersion,resourceType:input.viewModel.resourceRef.type,resourceId:input.viewModel.resourceRef.id,sourceSnapshotId:input.viewModel.sourceSnapshot.id,generationIntent:input.intent,outputType:input.outputType,objectIdentifier,contentType:rendered.contentType,byteLength:stored.byteLength,generatedAt:input.viewModel.generatedAt,generatedBy:input.viewModel.generatedBy,status:"ready",version:1});
    if(!await this.options.artifacts.create(artifact))throw new Error("artifact metadata creation conflicted");
    return artifact;
  }
}