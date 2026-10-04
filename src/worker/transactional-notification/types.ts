export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationDeliveryChannel = "in_app" | "email";
export type NotificationDeliveryStatus = "pending" | "delivered" | "failed" | "suppressed";

export type NotificationPresentationValue = string | number | boolean | null;
export type NotificationPresentationArgs = Readonly<Record<string, NotificationPresentationValue>>;

export interface TransactionalNotificationRecord {
  readonly id: string;
  readonly environment: string;
  readonly recipientPrincipal: string;
  readonly category: string;
  readonly notificationType: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly titleKey: string;
  readonly messageKey: string;
  readonly presentationArgs: NotificationPresentationArgs;
  readonly actionTarget: string | null;
  readonly severity: NotificationSeverity;
  readonly dedupeKey: string;
  readonly version: number;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly archivedAt: string | null;
  readonly expiresAt: string | null;
}

export interface NotificationDeliveryRecord {
  readonly notificationId: string;
  readonly channel: NotificationDeliveryChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly failureCode: string | null;
}

export interface NotificationSourceEvent {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly eventType: string;
  readonly actorPrincipal?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly occurredAt: string;
  readonly attributes?: Readonly<Record<string, NotificationPresentationValue>>;
}

export interface NotificationRecipientContext {
  readonly event: NotificationSourceEvent;
}

export interface NotificationRecipientResolver {
  resolve(resolverKey: string, context: NotificationRecipientContext): Promise<readonly string[]>;
}

export interface NotificationPolicyDecision {
  readonly notify: boolean;
  readonly category?: string;
  readonly notificationType?: string;
  readonly recipientResolverKey?: string;
  readonly titleKey?: string;
  readonly messageKey?: string;
  readonly presentationArgs?: NotificationPresentationArgs;
  readonly actionTarget?: string | null;
  readonly severity?: NotificationSeverity;
}

export interface NotificationPolicy {
  resolve(event: NotificationSourceEvent): Promise<NotificationPolicyDecision> | NotificationPolicyDecision;
}

export interface TransactionalNotificationStore {
  create(record: TransactionalNotificationRecord): Promise<"created" | "duplicate">;
  get(id: string, environment: string): Promise<TransactionalNotificationRecord | null>;
  listForRecipient(query: {
    readonly environment: string;
    readonly recipientPrincipal: string;
    readonly unreadOnly?: boolean;
    readonly category?: string;
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<readonly TransactionalNotificationRecord[]>;
  markRead(input: {
    readonly id: string;
    readonly environment: string;
    readonly recipientPrincipal: string;
    readonly expectedVersion: number;
    readonly readAt: string;
  }): Promise<boolean>;
  archive(input: {
    readonly id: string;
    readonly environment: string;
    readonly recipientPrincipal: string;
    readonly expectedVersion: number;
    readonly archivedAt: string;
  }): Promise<boolean>;
  countUnread(environment: string, recipientPrincipal: string): Promise<number>;
}
