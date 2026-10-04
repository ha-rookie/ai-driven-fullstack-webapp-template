import type {
  NotificationPresentationArgs,
  NotificationSeverity,
  TransactionalNotificationRecord,
  TransactionalNotificationStore,
} from "./types";

interface NotificationRow {
  id: string; environment: string; recipient_principal: string; category: string; notification_type: string;
  source_type: string; source_id: string; resource_type: string | null; resource_id: string | null;
  title_key: string; message_key: string; presentation_args_json: string; action_target: string | null;
  severity: NotificationSeverity; dedupe_key: string; version: number; created_at: string;
  read_at: string | null; archived_at: string | null; expires_at: string | null;
}

const mapRow = (row: NotificationRow): TransactionalNotificationRecord => ({
  id: row.id, environment: row.environment, recipientPrincipal: row.recipient_principal,
  category: row.category, notificationType: row.notification_type, sourceType: row.source_type,
  sourceId: row.source_id, resourceType: row.resource_type, resourceId: row.resource_id,
  titleKey: row.title_key, messageKey: row.message_key,
  presentationArgs: JSON.parse(row.presentation_args_json) as NotificationPresentationArgs,
  actionTarget: row.action_target, severity: row.severity, dedupeKey: row.dedupe_key,
  version: row.version, createdAt: row.created_at, readAt: row.read_at,
  archivedAt: row.archived_at, expiresAt: row.expires_at,
});

const duplicate = (error: unknown) => error instanceof Error && /UNIQUE constraint failed|constraint failed/iu.test(error.message);

export class D1TransactionalNotificationStore implements TransactionalNotificationStore {
  constructor(private readonly db: D1Database) {}

  async create(record: TransactionalNotificationRecord): Promise<"created" | "duplicate"> {
    try {
      await this.db.prepare(`INSERT INTO transactional_notifications (
        id, environment, recipient_principal, category, notification_type, source_type, source_id,
        resource_type, resource_id, title_key, message_key, presentation_args_json, action_target,
        severity, dedupe_key, version, created_at, read_at, archived_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(record.id, record.environment, record.recipientPrincipal, record.category, record.notificationType,
          record.sourceType, record.sourceId, record.resourceType, record.resourceId, record.titleKey,
          record.messageKey, JSON.stringify(record.presentationArgs), record.actionTarget, record.severity,
          record.dedupeKey, record.version, record.createdAt, record.readAt, record.archivedAt, record.expiresAt)
        .run();
      return "created";
    } catch (error) {
      if (duplicate(error)) return "duplicate";
      throw error;
    }
  }

  async get(id: string, environment: string) {
    const row = await this.db.prepare("SELECT * FROM transactional_notifications WHERE id = ? AND environment = ?")
      .bind(id, environment).first<NotificationRow>();
    return row ? mapRow(row) : null;
  }

  async listForRecipient(query: Parameters<TransactionalNotificationStore["listForRecipient"]>[0]) {
    const clauses = ["environment = ?", "recipient_principal = ?", "archived_at IS NULL"];
    const bindings: unknown[] = [query.environment, query.recipientPrincipal];
    if (query.unreadOnly) clauses.push("read_at IS NULL");
    if (query.category) { clauses.push("category = ?"); bindings.push(query.category); }
    if (query.cursor) {
      const [createdAt, id] = query.cursor.split("|");
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(createdAt, createdAt, id);
    }
    bindings.push(query.limit);
    const result = await this.db.prepare(`SELECT * FROM transactional_notifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(...bindings).all<NotificationRow>();
    return (result.results ?? []).map(mapRow);
  }

  async markRead(input: Parameters<TransactionalNotificationStore["markRead"]>[0]) {
    const result = await this.db.prepare(`UPDATE transactional_notifications SET read_at = COALESCE(read_at, ?), version = CASE WHEN read_at IS NULL THEN version + 1 ELSE version END WHERE id = ? AND environment = ? AND recipient_principal = ? AND version = ?`)
      .bind(input.readAt, input.id, input.environment, input.recipientPrincipal, input.expectedVersion).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async archive(input: Parameters<TransactionalNotificationStore["archive"]>[0]) {
    const result = await this.db.prepare(`UPDATE transactional_notifications SET archived_at = COALESCE(archived_at, ?), version = CASE WHEN archived_at IS NULL THEN version + 1 ELSE version END WHERE id = ? AND environment = ? AND recipient_principal = ? AND version = ?`)
      .bind(input.archivedAt, input.id, input.environment, input.recipientPrincipal, input.expectedVersion).run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async countUnread(environment: string, recipientPrincipal: string) {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM transactional_notifications WHERE environment = ? AND recipient_principal = ? AND read_at IS NULL AND archived_at IS NULL")
      .bind(environment, recipientPrincipal).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
}
