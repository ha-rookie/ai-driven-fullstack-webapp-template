import type {
  WorkflowInstanceRecord,
  WorkflowMutationBundle,
  WorkflowStartBundle,
  WorkflowStore,
  WorkflowWorkItemRecord,
} from "./types";

export class InMemoryWorkflowStore implements WorkflowStore {
  private readonly instances = new Map<string, WorkflowInstanceRecord>();
  private readonly workItems = new Map<string, WorkflowWorkItemRecord>();
  private readonly submissionKeys = new Set<string>();

  async create(bundle: WorkflowStartBundle): Promise<boolean> {
    const submissionKey = `${bundle.instance.environment}:${bundle.instance.submissionKey}`;
    if (this.instances.has(bundle.instance.id) || this.submissionKeys.has(submissionKey)) return false;
    this.instances.set(bundle.instance.id, bundle.instance);
    this.workItems.set(bundle.workItem.id, bundle.workItem);
    this.submissionKeys.add(submissionKey);
    return true;
  }

  async getInstance(instanceId: string, environment: string): Promise<WorkflowInstanceRecord | null> {
    const instance = this.instances.get(instanceId);
    return instance?.environment === environment ? instance : null;
  }

  async getOpenWorkItem(instanceId: string, environment: string): Promise<WorkflowWorkItemRecord | null> {
    return [...this.workItems.values()].find(
      (item) => item.workflowInstanceId === instanceId
        && item.environment === environment
        && item.status === "open",
    ) ?? null;
  }

  async apply(bundle: WorkflowMutationBundle): Promise<boolean> {
    const current = this.instances.get(bundle.instance.id);
    if (!current || current.environment !== bundle.instance.environment) return false;
    if (current.version !== bundle.expectedInstanceVersion) return false;

    if (bundle.completedWorkItem) {
      const currentItem = this.workItems.get(bundle.completedWorkItem.id);
      if (!currentItem || currentItem.status !== "open") return false;
      if (
        bundle.expectedWorkItemVersion === undefined
        || currentItem.version !== bundle.expectedWorkItemVersion
      ) return false;
    }

    if (bundle.nextWorkItem) {
      const alreadyOpen = await this.getOpenWorkItem(bundle.instance.id, bundle.instance.environment);
      if (alreadyOpen && alreadyOpen.id !== bundle.completedWorkItem?.id) return false;
      if (this.workItems.has(bundle.nextWorkItem.id)) return false;
    }

    if (bundle.completedWorkItem) this.workItems.set(bundle.completedWorkItem.id, bundle.completedWorkItem);
    if (bundle.nextWorkItem) this.workItems.set(bundle.nextWorkItem.id, bundle.nextWorkItem);
    this.instances.set(bundle.instance.id, bundle.instance);
    return true;
  }

  async listOpenWorkItems(
    assigneePrincipal: string,
    environment: string,
    limit = 50,
  ): Promise<readonly WorkflowWorkItemRecord[]> {
    return [...this.workItems.values()]
      .filter((item) => item.environment === environment
        && item.assigneePrincipal === assigneePrincipal
        && item.status === "open")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, limit);
  }
}
