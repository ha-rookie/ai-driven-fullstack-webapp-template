import type { WorkflowEventSink, WorkflowTransitionRecord } from "../../../worker/workflow";
import type {
  NotificationPolicy,
  NotificationRecipientResolver,
  NotificationSourceEvent,
} from "../../../worker/transactional-notification";

const REQUESTER_RECIPIENT = "workhub.travel.requester";
const ASSIGNEE_RECIPIENT = "workhub.travel.assignee";

export const WORKHUB_TRAVEL_NOTIFICATION_POLICY: NotificationPolicy = {
  resolve(event: NotificationSourceEvent) {
    switch (event.eventType) {
      case "workflow.submit":
      case "workflow.resubmit":
        return {
          notify: true,
          category: "workflow",
          notificationType: "workflow.approval_requested",
          recipientResolverKey: ASSIGNEE_RECIPIENT,
          titleKey: "notification.workflow.approval_requested.title",
          messageKey: "notification.workflow.approval_requested.body",
          actionTarget: event.resourceId
            ? `resource:${event.resourceType}:${event.resourceId}`
            : null,
          severity: "info",
        };
      case "workflow.return":
        return {
          notify: true,
          category: "workflow",
          notificationType: "workflow.returned",
          recipientResolverKey: REQUESTER_RECIPIENT,
          titleKey: "notification.workflow.returned.title",
          messageKey: "notification.workflow.returned.body",
          actionTarget: event.resourceId
            ? `resource:${event.resourceType}:${event.resourceId}`
            : null,
          severity: "warning",
        };
      case "workflow.approve":
        return {
          notify: true,
          category: "workflow",
          notificationType: "workflow.approved",
          recipientResolverKey: REQUESTER_RECIPIENT,
          titleKey: "notification.workflow.approved.title",
          messageKey: "notification.workflow.approved.body",
          actionTarget: event.resourceId
            ? `resource:${event.resourceType}:${event.resourceId}`
            : null,
          severity: "info",
        };
      case "workflow.reject":
        return {
          notify: true,
          category: "workflow",
          notificationType: "workflow.rejected",
          recipientResolverKey: REQUESTER_RECIPIENT,
          titleKey: "notification.workflow.rejected.title",
          messageKey: "notification.workflow.rejected.body",
          actionTarget: event.resourceId
            ? `resource:${event.resourceType}:${event.resourceId}`
            : null,
          severity: "warning",
        };
      default:
        return { notify: false };
    }
  },
};

export const WORKHUB_TRAVEL_NOTIFICATION_RECIPIENTS: NotificationRecipientResolver = {
  async resolve(resolverKey, context) {
    const value = resolverKey === REQUESTER_RECIPIENT
      ? context.event.attributes?.requesterId
      : resolverKey === ASSIGNEE_RECIPIENT
        ? context.event.attributes?.assigneePrincipal
        : undefined;
    return typeof value === "string" && value.length > 0 ? [value] : [];
  },
};

export interface WorkhubWorkflowProjectionFailure {
  readonly sinkIndex: number;
  readonly transition: WorkflowTransitionRecord;
  readonly error: unknown;
}

export class WorkhubWorkflowProjectionFanOut implements WorkflowEventSink {
  constructor(
    private readonly sinks: readonly WorkflowEventSink[],
    private readonly onFailure?: (failure: WorkhubWorkflowProjectionFailure) => void,
  ) {}

  async emit(event: WorkflowTransitionRecord): Promise<void> {
    for (const [sinkIndex, sink] of this.sinks.entries()) {
      try {
        await sink.emit(event);
      } catch (error) {
        this.onFailure?.({ sinkIndex, transition: event, error });
      }
    }
  }
}
