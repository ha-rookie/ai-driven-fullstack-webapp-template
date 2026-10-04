import type { WorkflowEventSink, WorkflowStore, WorkflowTransitionRecord } from "../../../worker/workflow";
import { IntegrationEventService } from "../../../worker/integration-event";

export const WORKHUB_TRAVEL_APPROVED_EVENT_TYPE = "travel.approved";
export const WORKHUB_TRAVEL_APPROVED_EVENT_VERSION = 1;

export class WorkhubTravelApprovedIntegrationSink implements WorkflowEventSink {
  constructor(
    private readonly workflowState: Pick<WorkflowStore, "getInstance">,
    private readonly integrationEvents: IntegrationEventService,
    private readonly destinationKey: string,
  ) {}

  async emit(transition: WorkflowTransitionRecord): Promise<void> {
    if (transition.transition !== "approve" || transition.toState !== "completed") return;

    const instance = await this.workflowState.getInstance(transition.workflowInstanceId, transition.environment);
    if (!instance || instance.resourceType !== "travel_request") return;

    await this.integrationEvents.enqueue({
      environment: transition.environment,
      eventType: WORKHUB_TRAVEL_APPROVED_EVENT_TYPE,
      schemaVersion: WORKHUB_TRAVEL_APPROVED_EVENT_VERSION,
      destinationKey: this.destinationKey,
      aggregateType: "travel_request",
      aggregateId: instance.resourceId,
      occurredAt: transition.occurredAt,
      correlationId: transition.correlationId ?? undefined,
      causationId: transition.id,
      payload: {
        travelRequestId: instance.resourceId,
        requesterId: instance.requesterId,
        approvedBy: transition.actorId,
      },
      eventId: transition.id,
      outboxId: transition.id,
    });
  }
}
