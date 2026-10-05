import { createObjectIdentifier, type ObjectIdentifier, type ObjectStorage } from "../object-storage";
import type { IdGenerator, RuntimeEnvironment } from "../runtime";

const KEY = /^[a-z][a-z0-9._-]{0,127}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ReportOutputType = "html" | "pdf" | "xlsx" | "csv";
export type ReportGenerationIntent = "original" | "regenerated_copy" | "reissue";

export interface ReportDefinition {
  readonly key: string;
  readonly version: string;
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly outputTypes: readonly ReportOutputType[];
}

export interface ReportResourceRef {
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface ReportSourceSnapshot {
  readonly id: string;
  readonly sourceVersion: string;
  readonly capturedAt: string;
  readonly references?: Readonly<Record<string, string>>;
}

export interface ReportViewModel<TData = unknown> {
  readonly reportKey: string;
  readonly definitionVersion: string;
  readonly resource: ReportResourceRef;
  readonly sourceSnapshot: ReportSourceSnapshot;
  readonly generatedBy: string;
  readonly generatedAt: string;
  readonly locale: string;
  readonly timezone: string;
  readonly data: TData;
}

export interface ReportViewModelValidator<TData = unknown> {
  validate(value: ReportViewModel<unknown>): ReportViewModel<TData>;
}

export interface ReportBuilder<TData = unknown> {
  build(input: {
    readonly principalId: string;
    readonly resource: ReportResourceRef;
    readonly locale: string;
    readonly timezone: string;
  }): Promise<ReportViewModel<TData>>;
}

export interface GeneratedReportBinary {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

export interface ReportRenderer<TData = unknown> {
  readonly outputType: ReportOutputType;
  render(input: {
    readonly definition: ReportDefinition;
    readonly viewModel: ReportViewModel<TData>;
  }): Promise<GeneratedReportBinary>;
}

export interface GeneratedArtifact {
  readonly id: string;
  readonly environment: RuntimeEnvironment;
  readonly reportKey: string;
  readonly definitionVersion: string;
  readonly templateKey: string;
  readonly templateVersion: string;
  readonly resource: ReportResourceRef;
  readonly sourceSnapshotId: string;
  readonly sourceVersion: string;
  readonly outputType: ReportOutputType;
  readonly intent: ReportGenerationIntent;
  readonly objectIdentifier: ObjectIdentifier;
  readonly contentType: string;
  readonly displayFilename: string;
  readonly byteLength: number;
  readonly checksumSha256: string;
  readonly generatedAt: string;
  readonly generatedBy: string;
}

export interface ReportArtifactStore {
  create(artifact: GeneratedArtifact): Promise<boolean>;
  get(id: string, environment: RuntimeEnvironment): Promise<GeneratedArtifact | null>;
  findByGenerationKey(generationKey: string, environment: RuntimeEnvironment): Promise<GeneratedArtifact | null>;
  bindGenerationKey(generationKey: string, artifactId: string, environment: RuntimeEnvironment): Promise<boolean>;
}

export interface ReportAuthorizationPolicy {
  assertCanGenerate(input: {
    readonly principalId: string;
    readonly definition: ReportDefinition;
    readonly resource: ReportResourceRef;
  }): Promise<void>;
  assertCanDownload(input: {
    readonly principalId: string;
    readonly artifact: GeneratedArtifact;
  }): Promise<void>;
}

export class ReportFoundationError extends Error {
  constructor(readonly code: "invalid_definition" | "unsupported_output" | "invalid_view_model" | "generation_conflict") {
    super(code);
    this.name = "ReportFoundationError";
  }
}

export const assertReportDefinition = (definition: ReportDefinition): void => {
  if (!KEY.test(definition.key) || !KEY.test(definition.templateKey) || !VERSION.test(definition.version) || !VERSION.test(definition.templateVersion)) {
    throw new ReportFoundationError("invalid_definition");
  }
  if (definition.outputTypes.length === 0 || new Set(definition.outputTypes).size !== definition.outputTypes.length) {
    throw new ReportFoundationError("invalid_definition");
  }
};

const generationKey = (input: {
  definition: ReportDefinition;
  viewModel: ReportViewModel;
  outputType: ReportOutputType;
  intent: ReportGenerationIntent;
}): string => [
  input.definition.key,
  input.definition.version,
  input.definition.templateVersion,
  input.viewModel.resource.resourceType,
  input.viewModel.resource.resourceId,
  input.viewModel.sourceSnapshot.id,
  input.outputType,
  input.intent,
].join(":");

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
};

export class ReportApplicationService {
  constructor(private readonly options: {
    readonly environment: RuntimeEnvironment;
    readonly artifacts: ReportArtifactStore;
    readonly objectStorage: ObjectStorage;
    readonly authorization: ReportAuthorizationPolicy;
    readonly idGenerator: IdGenerator;
  }) {}

  async generate<TData>(input: {
    readonly principalId: string;
    readonly definition: ReportDefinition;
    readonly builder: ReportBuilder<TData>;
    readonly validator: ReportViewModelValidator<TData>;
    readonly renderer: ReportRenderer<TData>;
    readonly resource: ReportResourceRef;
    readonly locale: string;
    readonly timezone: string;
    readonly intent?: ReportGenerationIntent;
  }): Promise<GeneratedArtifact> {
    assertReportDefinition(input.definition);
    if (!input.definition.outputTypes.includes(input.renderer.outputType)) {
      throw new ReportFoundationError("unsupported_output");
    }
    await this.options.authorization.assertCanGenerate({
      principalId: input.principalId,
      definition: input.definition,
      resource: input.resource,
    });

    const built = await input.builder.build({
      principalId: input.principalId,
      resource: input.resource,
      locale: input.locale,
      timezone: input.timezone,
    });
    let viewModel: ReportViewModel<TData>;
    try {
      viewModel = input.validator.validate(built);
    } catch {
      throw new ReportFoundationError("invalid_view_model");
    }
    if (viewModel.reportKey !== input.definition.key || viewModel.definitionVersion !== input.definition.version) {
      throw new ReportFoundationError("invalid_view_model");
    }

    const intent = input.intent ?? "original";
    const key = generationKey({ definition: input.definition, viewModel, outputType: input.renderer.outputType, intent });
    const existing = await this.options.artifacts.findByGenerationKey(key, this.options.environment);
    if (existing) return existing;

    const rendered = await input.renderer.render({ definition: input.definition, viewModel });
    const objectIdentifier = createObjectIdentifier(this.options.idGenerator);
    const stored = await this.options.objectStorage.put({
      identifier: objectIdentifier,
      body: rendered.body,
      metadata: { contentType: rendered.contentType },
      overwrite: "forbid",
    });
    const artifact: GeneratedArtifact = {
      id: this.options.idGenerator.generate(),
      environment: this.options.environment,
      reportKey: input.definition.key,
      definitionVersion: input.definition.version,
      templateKey: input.definition.templateKey,
      templateVersion: input.definition.templateVersion,
      resource: viewModel.resource,
      sourceSnapshotId: viewModel.sourceSnapshot.id,
      sourceVersion: viewModel.sourceSnapshot.sourceVersion,
      outputType: input.renderer.outputType,
      intent,
      objectIdentifier,
      contentType: rendered.contentType,
      displayFilename: rendered.filename,
      byteLength: stored.byteLength,
      checksumSha256: await sha256(rendered.body),
      generatedAt: viewModel.generatedAt,
      generatedBy: viewModel.generatedBy,
    };
    if (!await this.options.artifacts.create(artifact) || !await this.options.artifacts.bindGenerationKey(key, artifact.id, this.options.environment)) {
      await this.options.objectStorage.delete(objectIdentifier).catch(() => undefined);
      throw new ReportFoundationError("generation_conflict");
    }
    return artifact;
  }

  async assertCanDownload(principalId: string, artifactId: string): Promise<GeneratedArtifact | null> {
    const artifact = await this.options.artifacts.get(artifactId, this.options.environment);
    if (!artifact) return null;
    await this.options.authorization.assertCanDownload({ principalId, artifact });
    return artifact;
  }
}
