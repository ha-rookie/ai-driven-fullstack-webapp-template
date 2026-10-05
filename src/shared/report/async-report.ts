import type { AsyncJobEnvelope, AsyncJobPublisher, ExecuteAsyncJobInput, AsyncJobExecutionResult } from "../async-job";
import { createAsyncJobEnvelope, executeAsyncJob } from "../async-job";
import type { ObjectStorage } from "../object-storage";
import type { GeneratedArtifact, ReportDefinition, ReportOutputType, ReportRenderer, ReportViewModel } from "./report";
import type { GeneratedArtifactStore, ReportGenerationAuthorizer } from "./artifact-service";

export const ASYNC_REPORT_JOB_TYPE = "report.generate";

export interface AsyncReportJobPayload {
  readonly artifactId: string;
  readonly environment: string;
}

export interface AsyncReportResolver {
  resolve(artifact: GeneratedArtifact): Promise<{
    definition: ReportDefinition<unknown>;
    viewModel: ReportViewModel<unknown>;
    renderer: ReportRenderer;
  }>;
}

const jobIdentity = (environment: string, artifactId: string): string =>
  `report:${environment}:${artifactId}`;

export class AsyncReportGenerationService {
  constructor(private readonly options: {
    environment: string;
    artifacts: GeneratedArtifactStore;
    authorizer: ReportGenerationAuthorizer;
    publisher: AsyncJobPublisher;
    generateId: () => string;
    now: () => Date;
  }) {}

  async request<TData>(input: {
    principalId: string;
    definition: ReportDefinition<TData>;
    viewModel: ReportViewModel<TData>;
    outputType: ReportOutputType;
  }): Promise<{ artifact: GeneratedArtifact; job: AsyncJobEnvelope<AsyncReportJobPayload> }> {
    await this.options.authorizer.assertCanGenerate({
      principalId: input.principalId,
      resourceType: input.viewModel.resourceRef.type,
      resourceId: input.viewModel.resourceRef.id,
      reportKey: input.definition.key,
    });

    let artifact = input.viewModel.generationIntent === "original"
      ? await this.options.artifacts.findOriginal({
          environment: this.options.environment,
          reportKey: input.definition.key,
          resourceType: input.viewModel.resourceRef.type,
          resourceId: input.viewModel.resourceRef.id,
          sourceSnapshotId: input.viewModel.sourceSnapshot.id,
          outputType: input.outputType,
        })
      : null;

    if (!artifact) {
      artifact = Object.freeze({
        id: this.options.generateId(),
        environment: this.options.environment,
        reportKey: input.definition.key,
        definitionVersion: input.definition.version,
        templateKey: input.definition.templateKey,
        templateVersion: input.definition.templateVersion,
        resourceType: input.viewModel.resourceRef.type,
        resourceId: input.viewModel.resourceRef.id,
        sourceSnapshotId: input.viewModel.sourceSnapshot.id,
        generationIntent: input.viewModel.generationIntent,
        outputType: input.outputType,
        objectIdentifier: this.options.generateId(),
        requestedAt: this.options.now().toISOString(),
        generatedBy: input.principalId,
        status: "pending",
        version: 1,
      });
      if (!await this.options.artifacts.create(artifact)) {
        if (input.viewModel.generationIntent !== "original") throw new Error("artifact metadata creation conflicted");
        const concurrent = await this.options.artifacts.findOriginal({
          environment: this.options.environment,
          reportKey: input.definition.key,
          resourceType: input.viewModel.resourceRef.type,
          resourceId: input.viewModel.resourceRef.id,
          sourceSnapshotId: input.viewModel.sourceSnapshot.id,
          outputType: input.outputType,
        });
        if (!concurrent) throw new Error("artifact metadata creation conflicted");
        artifact = concurrent;
      }
    }

    const identity = jobIdentity(this.options.environment, artifact.id);
    const job = await createAsyncJobEnvelope({
      type: ASYNC_REPORT_JOB_TYPE,
      payload: { artifactId: artifact.id, environment: this.options.environment },
      jobId: identity,
      idempotencyKey: identity,
      clock: { now: this.options.now },
      idGenerator: { generate: this.options.generateId },
    });
    await this.options.publisher.publish(job);
    return { artifact, job };
  }
}

export const createAsyncReportHandler = (options: {
  environment: string;
  artifacts: GeneratedArtifactStore;
  storage: ObjectStorage;
  resolver: AsyncReportResolver;
  now?: () => Date;
}) => async (payload: AsyncReportJobPayload): Promise<void> => {
  if (payload.environment !== options.environment) throw new Error("report job environment mismatch");
  let artifact = await options.artifacts.get(payload.artifactId, options.environment);
  if (!artifact) throw new Error("report artifact not found");
  if (artifact.status === "ready") return;
  if (artifact.status === "failed") throw new Error("report artifact is terminally failed");

  if (artifact.status === "pending") {
    const claimed = await options.artifacts.transition({
      id: artifact.id, environment: artifact.environment, expectedVersion: artifact.version,
      from: "pending", to: "generating",
    });
    if (claimed) artifact = claimed;
    else {
      const current = await options.artifacts.get(artifact.id, artifact.environment);
      if (!current) throw new Error("report artifact disappeared");
      artifact = current;
      if (artifact.status === "ready") return;
      if (artifact.status !== "generating") throw new Error("report artifact state conflict");
    }
  }

  const existingObject = await options.storage.head(artifact.objectIdentifier);
  if (existingObject) {
    const ready = await options.artifacts.transition({
      id: artifact.id, environment: artifact.environment, expectedVersion: artifact.version,
      from: "generating", to: "ready",
      patch: {
        contentType: existingObject.contentType ?? artifact.contentType ?? "application/octet-stream",
        byteLength: existingObject.byteLength,
        generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      },
    });
    if (!ready) {
      const current = await options.artifacts.get(artifact.id, artifact.environment);
      if (current?.status !== "ready") throw new Error("report artifact ready transition conflicted");
    }
    return;
  }

  const resolved = await options.resolver.resolve(artifact);
  if (resolved.definition.key !== artifact.reportKey || resolved.definition.version !== artifact.definitionVersion) {
    throw new Error("report definition identity mismatch");
  }
  if (resolved.viewModel.sourceSnapshot.id !== artifact.sourceSnapshotId) {
    throw new Error("report source snapshot identity mismatch");
  }
  const rendered = await resolved.renderer.render({
    definition: resolved.definition,
    viewModel: resolved.viewModel,
    outputType: artifact.outputType,
  });
  const stored = await options.storage.put({
    identifier: artifact.objectIdentifier,
    body: rendered.body,
    metadata: { contentType: rendered.contentType },
    overwrite: "forbid",
  });
  const ready = await options.artifacts.transition({
    id: artifact.id, environment: artifact.environment, expectedVersion: artifact.version,
    from: "generating", to: "ready",
    patch: { contentType: rendered.contentType, byteLength: stored.byteLength, generatedAt: (options.now ?? (() => new Date()))().toISOString() },
  });
  if (!ready) throw new Error("report artifact ready transition conflicted");
};

export const markAsyncReportFailed = async (input: {
  artifacts: GeneratedArtifactStore;
  artifactId: string;
  environment: string;
  failureCode: string;
}): Promise<boolean> => {
  const artifact = await input.artifacts.get(input.artifactId, input.environment);
  if (!artifact || artifact.status === "ready" || artifact.status === "failed") return false;
  const failed = await input.artifacts.transition({
    id: artifact.id, environment: artifact.environment, expectedVersion: artifact.version,
    from: artifact.status, to: "failed", patch: { failureCode: input.failureCode },
  });
  return failed !== null;
};


export const executeAsyncReportJob = async (input: Omit<ExecuteAsyncJobInput<AsyncReportJobPayload>, "handler"> & {
  artifacts: GeneratedArtifactStore;
  handler: ExecuteAsyncJobInput<AsyncReportJobPayload>["handler"];
}): Promise<AsyncJobExecutionResult> => {
  const result = await executeAsyncJob(input);
  if (result.kind === "failed" || result.kind === "dead_letter") {
    await markAsyncReportFailed({
      artifacts: input.artifacts,
      artifactId: input.envelope.payload.artifactId,
      environment: input.envelope.payload.environment,
      failureCode: result.failureCode,
    });
  }
  return result;
};
