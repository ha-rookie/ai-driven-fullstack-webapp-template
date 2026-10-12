/**
 * WORKHUB Reference: official company announcements.
 * This is deliberately separate from transactional notifications and social posts.
 * Initial audience is current WORKHUB-scope members with the announcement
 * application, not any arbitrary signed-in session. The Worker enforces scope
 * and role on every request. The Reference publisher allowlist is NOT product
 * RBAC and must be replaced before business deployment.
 */
export const WORKHUB_ANNOUNCEMENT_PUBLISHER_ID = "workhub-demo-sora";

/** Extra publishing condition on top of current scope/app authorization. */
export const canPublishWorkhubReferenceAnnouncement = (principalId: string, currentRole: string): boolean =>
  principalId === WORKHUB_ANNOUNCEMENT_PUBLISHER_ID && currentRole === "corporate";

export interface WorkhubAnnouncement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly authorId: string;
  readonly publishedAt: string;
}

export class WorkhubAnnouncementError extends Error {
  constructor(
    readonly code: "invalid_input" | "forbidden" | "storage_failure",
    message: string,
  ) {
    super(message);
    this.name = "WorkhubAnnouncementError";
  }
}

const normalize = (value: unknown, label: string, max: number, multiline: boolean): string => {
  if (typeof value !== "string") throw new WorkhubAnnouncementError("invalid_input", `${label} must be text`);
  const text = value.trim();
  if (!text || text.length > max) {
    throw new WorkhubAnnouncementError("invalid_input", `${label} must be 1-${max} characters`);
  }
  // Permit tabs and line breaks only in the message body.
  if ([...text].some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && !(multiline && [9, 10, 13].includes(code))) || code === 127;
  })) {
    throw new WorkhubAnnouncementError("invalid_input", `${label} has invalid characters`);
  }
  return text;
};

export const validateAnnouncement = (title: unknown, body: unknown) => ({
  title: normalize(title, "title", 120, false),
  body: normalize(body, "body", 2000, true),
});

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  author_id: string;
  published_at: string;
}

const fromRow = (row: AnnouncementRow): WorkhubAnnouncement => ({
  id: row.id,
  title: row.title,
  body: row.body,
  authorId: row.author_id,
  publishedAt: row.published_at,
});

export class D1WorkhubAnnouncementStore {
  constructor(private readonly db: D1Database, private readonly environment: string) {}

  async list(limit = 10): Promise<readonly WorkhubAnnouncement[]> {
    const rows = await this.db.prepare(`
      SELECT id, title, body, author_id, published_at
      FROM workhub_announcements
      WHERE environment = ?
      ORDER BY published_at DESC, id DESC
      LIMIT ?
    `).bind(this.environment, limit).all<AnnouncementRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async publish(
    principalId: string,
    titleValue: unknown,
    bodyValue: unknown,
  ): Promise<WorkhubAnnouncement> {
    if (principalId !== WORKHUB_ANNOUNCEMENT_PUBLISHER_ID) {
      throw new WorkhubAnnouncementError("forbidden", "Only General Affairs can publish announcements");
    }
    const { title, body } = validateAnnouncement(titleValue, bodyValue);
    const item: WorkhubAnnouncement = {
      id: crypto.randomUUID(),
      title,
      body,
      authorId: principalId,
      publishedAt: new Date().toISOString(),
    };
    const result = await this.db.prepare(`
      INSERT INTO workhub_announcements (
        id, environment, title, body, author_id, published_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, this.environment, item.title, item.body,
      item.authorId, item.publishedAt,
    ).run();
    if (result.meta?.changes !== 1) {
      throw new WorkhubAnnouncementError("storage_failure", "Announcement could not be published");
    }
    return item;
  }
}
