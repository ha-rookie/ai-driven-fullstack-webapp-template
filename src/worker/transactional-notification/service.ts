import type {
  NotificationPolicy,
  NotificationPresentationArgs,
  NotificationRecipientResolver,
  NotificationSourceEvent,
  TransactionalNotificationRecord,
  TransactionalNotificationStore,
} from "./types";

const MAX_TEXT = 256;
const MAX_ARGS_JSON = 4096;

export class TransactionalNotificationError extends Error {
  constructor(public readonly code: "invalid_input" | "recipient_unresolved" | "conflict" | "not_found", message: string) {
    super(message);
    this.name = "TransactionalNotificationError";
  }
}

const text = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_TEXT) throw new TransactionalNotificationError("invalid_input", `${name} is invalid`);
  return normalized;
};

const args = (value: NotificationPresentationArgs | undefined): NotificationPresentationArgs => {
  const result = value ?? {};
  if (JSON.stringify(result).length > MAX_ARGS_JSON) throw new TransactionalNotificationError("invalid_input", "presentationArgs is too large");
  return result;
};

export interface TransactionalNotificationServiceOptions {
  readonly environment: string;
  readonly store: TransactionalNotificationStore;
  readonly policy: NotificationPolicy;
  readonly recipients: NotificationRecipientResolver;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

export class TransactionalNotificationService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: TransactionalNotificationServiceOptions) {
    text(options.environment, "environment");
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  async project(event: NotificationSourceEvent): Promise<readonly TransactionalNotificationRecord[]> {
    const decision = await this.options.policy.resolve(event);
    if (!decision.notify) return [];
    const required = [decision.category, decision.notificationType, decision.recipientResolverKey, decision.titleKey, decision.messageKey];
    if (required.some((value) => !value)) throw new TransactionalNotificationError("invalid_input", "notification policy is incomplete");
    const recipients = [...new Set(await this.options.recipients.resolve(decision.recipientResolverKey!, { event }))];
    if (recipients.length === 0) throw new TransactionalNotificationError("recipient_unresolved", "notification recipient could not be resolved");

    const createdAt = this.now().toISOString();
    const records: TransactionalNotificationRecord[] = [];
    for (const principal of recipients) {
      const recipientPrincipal = text(principal, "recipientPrincipal");
      const notificationType = text(decision.notificationType!, "notificationType");
      const dedupeKey = `${text(event.sourceType, "sourceType")}:${text(event.sourceId, "sourceId")}:${recipientPrincipal}:${notificationType}`;
      const record: TransactionalNotificationRecord = {
        id: text(this.generateId(), "id"), environment: this.options.environment, recipientPrincipal,
        category: text(decision.category!, "category"), notificationType,
        sourceType: event.sourceType, sourceId: event.sourceId,
        resourceType: event.resourceType ?? null, resourceId: event.resourceId ?? null,
        titleKey: text(decision.titleKey!, "titleKey"), messageKey: text(decision.messageKey!, "messageKey"),
        presentationArgs: args(decision.presentationArgs), actionTarget: decision.actionTarget ?? null,
        severity: decision.severity ?? "info", dedupeKey, version: 1, createdAt,
        readAt: null, archivedAt: null, expiresAt: null,
      };
      const outcome = await this.options.store.create(record);
      if (outcome === "created") records.push(record);
    }
    return records;
  }

  list(recipientPrincipal: string, options?: { unreadOnly?: boolean; category?: string; limit?: number; cursor?: string }) {
    return this.options.store.listForRecipient({ environment: this.options.environment, recipientPrincipal: text(recipientPrincipal, "recipientPrincipal"), unreadOnly: options?.unreadOnly, category: options?.category, limit: options?.limit ?? 50, cursor: options?.cursor });
  }

  countUnread(recipientPrincipal: string) { return this.options.store.countUnread(this.options.environment, text(recipientPrincipal, "recipientPrincipal")); }

  async markRead(recipientPrincipal: string, id: string, expectedVersion: number) {
    const ok = await this.options.store.markRead({ id: text(id, "id"), environment: this.options.environment, recipientPrincipal: text(recipientPrincipal, "recipientPrincipal"), expectedVersion, readAt: this.now().toISOString() });
    if (!ok) throw new TransactionalNotificationError("conflict", "notification read state changed");
  }

  async archive(recipientPrincipal: string, id: string, expectedVersion: number) {
    const ok = await this.options.store.archive({ id: text(id, "id"), environment: this.options.environment, recipientPrincipal: text(recipientPrincipal, "recipientPrincipal"), expectedVersion, archivedAt: this.now().toISOString() });
    if (!ok) throw new TransactionalNotificationError("conflict", "notification archive state changed");
  }
}
