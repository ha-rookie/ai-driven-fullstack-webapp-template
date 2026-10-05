import type { GeneratedArtifact, ReportArtifactStore } from "./report";
import type { RuntimeEnvironment } from "../runtime";

export class InMemoryReportArtifactStore implements ReportArtifactStore {
  private readonly artifacts = new Map<string, GeneratedArtifact>();
  private readonly generationKeys = new Map<string, string>();

  async create(artifact: GeneratedArtifact): Promise<boolean> {
    const key = `${artifact.environment}:${artifact.id}`;
    if (this.artifacts.has(key)) return false;
    this.artifacts.set(key, artifact);
    return true;
  }

  async get(id: string, environment: RuntimeEnvironment): Promise<GeneratedArtifact | null> {
    return this.artifacts.get(`${environment}:${id}`) ?? null;
  }

  async findByGenerationKey(generationKey: string, environment: RuntimeEnvironment): Promise<GeneratedArtifact | null> {
    const id = this.generationKeys.get(`${environment}:${generationKey}`);
    return id ? this.get(id, environment) : null;
  }

  async bindGenerationKey(generationKey: string, artifactId: string, environment: RuntimeEnvironment): Promise<boolean> {
    const key = `${environment}:${generationKey}`;
    if (this.generationKeys.has(key)) return false;
    this.generationKeys.set(key, artifactId);
    return true;
  }
}
