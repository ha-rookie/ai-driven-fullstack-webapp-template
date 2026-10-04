import type {
  WorkflowEventSink,
  WorkflowStore,
  WorkflowTransitionRecord,
} from "../workflow";
import type { BusinessActivityProjector } from "./service";

const activityTypeOf = (transition: WorkflowTransitionRecord["transition"]): string => {
  switch (transition) {
    case "submit": return "workflow.submitted";
    case "approve": return "workflow.approved";
    case "return": return "workflow.returned";
    case "resubmit": return "workflow.resubmitted";
    case "reject": return "workflow.rejected";
    case "withdraw": return "workflow.withdrawn";
  }
};

export interface WorkflowBusinessActivityProjectorOptions {
  readonly workflowStore: Pick<WorkflowStore, "getInstance">;
  readonly projector: BusinessActivityProjector;
  readonly resolveActorDisplaySnapshot?: (actorId: string) => Promise<string | null> | string | null;
  readonly visibilityScope?: string | null;
}

export class WorkflowBusinessActivityProjector implements WorkflowEventSink {
  constructor(private readonly options: WorkflowBusinessActivityProjectorOptions) {}

  async emit(event: WorkflowTransitionRecord): Promise<void> {
    const instance = await this.options.workflowStore.getInstance(
      event.workflowInstanceId,
      event.environment,
    );
    if (!instance) throw new Error("workflow instance missing during timeline projection");

    const actorDisplaySnapshot = this.options.resolveActorDisplaySnapshot
      ? await this.options.resolveActorDisplaySnapshot(event.actorId)
      : null;

    await this.options.projector.project({
      resourceType: instance.resourceType,
      resourceId: instance.resourceId,
      activityType: activityTypeOf(event.transition),
      actorRef: event.actorId,
      actorDisplaySnapshot,
      sourceType: "workflow_transition",
      sourceId: event.id,
      sequence: event.sequence,
      visibilityScope: this.options.visibilityScope ?? null,
      metadata: event.reasonCode ? { reasonCode: event.reasonCode } : {},
      occurredAt: event.occurredAt,
    });
  }
}
