import type { WorkflowEventSink, WorkflowStore, WorkflowTransitionRecord } from "../workflow";
import type { NotificationSourceEvent } from "./types";
import type { TransactionalNotificationService } from "./service";

export interface WorkflowNotificationProjectorOptions {
  readonly workflowStore: Pick<WorkflowStore, "getInstance" | "getOpenWorkItem">;
  readonly notifications: TransactionalNotificationService;
}

export class WorkflowNotificationProjector implements WorkflowEventSink {
  constructor(private readonly options: WorkflowNotificationProjectorOptions) {}

  async emit(event: WorkflowTransitionRecord): Promise<void> {
    const instance = await this.options.workflowStore.getInstance(event.workflowInstanceId, event.environment);
    if (!instance) throw new Error("workflow instance missing during notification projection");
    const currentWorkItem = await this.options.workflowStore.getOpenWorkItem(event.workflowInstanceId, event.environment);
    const attributes: Record<string, string> = { requesterId: instance.requesterId };
    if (currentWorkItem) attributes.assigneePrincipal = currentWorkItem.assigneePrincipal;

    const source: NotificationSourceEvent = {
      sourceType: "workflow_transition",
      sourceId: event.id,
      eventType: `workflow.${event.transition}`,
      actorPrincipal: event.actorId,
      resourceType: instance.resourceType,
      resourceId: instance.resourceId,
      occurredAt: event.occurredAt,
      attributes,
    };
    await this.options.notifications.project(source);
  }
}
