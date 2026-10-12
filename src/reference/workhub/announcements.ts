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

export const ANNOUNCEMENT_IMPORTANCES = ["normal", "important", "critical"] as const;
export type AnnouncementImportance = typeof ANNOUNCEMENT_IMPORTANCES[number];

export const ANNOUNCEMENT_AUDIENCE_ROLES = [
  "newcomer", "employee", "manager", "accounting", "corporate", "system_admin",
] as const;
export type AnnouncementAudienceRole = typeof ANNOUNCEMENT_AUDIENCE_ROLES[number];

export const ANNOUNCEMENT_AUDIENCE_DEPARTMENTS = [
  { code: "engineering", label: "開発部" },
  { code: "finance", label: "経理部" },
  { code: "people", label: "人事・総務部" },
  { code: "it", label: "情報システム部" },
] as const;
export type AnnouncementAudienceDepartment = typeof ANNOUNCEMENT_AUDIENCE_DEPARTMENTS[number]["code"];

export interface AnnouncementDeliveryInput {
  readonly importance?: unknown;
  readonly audienceRole?: unknown;
  readonly audienceDepartment?: unknown;
  readonly visibleFrom?: unknown;
  readonly visibleUntil?: unknown;
}

export interface WorkhubAnnouncement {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly authorId: string;
  readonly publishedAt: string;
  readonly importance: AnnouncementImportance;
  readonly audienceRole: AnnouncementAudienceRole | null;
  readonly audienceDepartment: AnnouncementAudienceDepartment | null;
  readonly visibleFrom: string;
  readonly visibleUntil: string | null;
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

export const validateAnnouncementDelivery = (
  input: AnnouncementDeliveryInput,
  now = new Date(),
): Pick<WorkhubAnnouncement, "importance" | "audienceRole" | "audienceDepartment" | "visibleFrom" | "visibleUntil"> => {
  const importance = input.importance ?? "normal";
  if (!ANNOUNCEMENT_IMPORTANCES.some(value => value === importance)) {
    throw new WorkhubAnnouncementError("invalid_input", "Invalid announcement importance");
  }
  const requestedRole = input.audienceRole === "" ? null : input.audienceRole ?? null;
  if (requestedRole !== null && !ANNOUNCEMENT_AUDIENCE_ROLES.some(value => value === requestedRole)) {
    throw new WorkhubAnnouncementError("invalid_input", "Invalid announcement audience role");
  }
  const requestedDepartment = input.audienceDepartment === "" ? null : input.audienceDepartment ?? null;
  if (requestedDepartment !== null
    && !ANNOUNCEMENT_AUDIENCE_DEPARTMENTS.some(department => department.code === requestedDepartment)) {
    throw new WorkhubAnnouncementError("invalid_input", "Invalid announcement audience department");
  }
  const canonicalTimestamp = (value: unknown, label: string): string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      throw new WorkhubAnnouncementError("invalid_input", `${label} must be an ISO UTC timestamp`);
    }
    return value;
  };
  const visibleFrom = input.visibleFrom === undefined || input.visibleFrom === null || input.visibleFrom === ""
    ? now.toISOString() : canonicalTimestamp(input.visibleFrom, "visibleFrom");
  const visibleUntil = input.visibleUntil === undefined || input.visibleUntil === null || input.visibleUntil === ""
    ? null : canonicalTimestamp(input.visibleUntil, "visibleUntil");
  if (visibleUntil !== null && visibleUntil <= visibleFrom) {
    throw new WorkhubAnnouncementError("invalid_input", "visibleUntil must follow visibleFrom");
  }
  return {
    importance: importance as AnnouncementImportance,
    audienceRole: requestedRole as AnnouncementAudienceRole | null,
    audienceDepartment: requestedDepartment as AnnouncementAudienceDepartment | null,
    visibleFrom,
    visibleUntil,
  };
};

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  author_id: string;
  published_at: string;
  importance: AnnouncementImportance;
  audience_role: AnnouncementAudienceRole | null;
  audience_department: AnnouncementAudienceDepartment | null;
  visible_from: string;
  visible_until: string | null;
}

const fromRow = (row: AnnouncementRow): WorkhubAnnouncement => ({
  id: row.id,
  title: row.title,
  body: row.body,
  authorId: row.author_id,
  publishedAt: row.published_at,
  importance: row.importance,
  audienceRole: row.audience_role,
  audienceDepartment: row.audience_department,
  visibleFrom: row.visible_from,
  visibleUntil: row.visible_until,
});

export class D1WorkhubAnnouncementStore {
  constructor(private readonly db: D1Database, private readonly environment: string) {}

  async list(
    currentRole: string, currentScopeId: string, currentPrincipalId: string,
    limit = 10, now = new Date(),
  ): Promise<readonly WorkhubAnnouncement[]> {
    // Fail closed on missing/unknown roles. Authorization is checked again
    // by the Worker against the current D1 WORKHUB scope membership.
    if (!ANNOUNCEMENT_AUDIENCE_ROLES.some(role => role === currentRole)) {
      return [];
    }
    const time = now.toISOString();
    const rows = await this.db.prepare(`
      SELECT id, title, body, author_id, published_at,
             importance, audience_role, audience_department, visible_from, visible_until
      FROM workhub_announcements
      WHERE environment = ?
        AND (audience_role IS NULL OR audience_role = ?)
        AND (audience_department IS NULL OR EXISTS (
          SELECT 1 FROM workhub_department_memberships AS department
          WHERE department.scope_id = ?
            AND department.user_id = ?
            AND department.department_code = workhub_announcements.audience_department
        ))
        AND visible_from <= ?
        AND (visible_until IS NULL OR visible_until > ?)
      ORDER BY CASE importance WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
               published_at DESC, id DESC
      LIMIT ?
    `).bind(
      this.environment, currentRole, currentScopeId, currentPrincipalId,
      time, time, limit,
    ).all<AnnouncementRow>();
    return (rows.results ?? []).map(fromRow);
  }

  async publish(
    principalId: string,
    titleValue: unknown,
    bodyValue: unknown,
    delivery: AnnouncementDeliveryInput = {},
  ): Promise<WorkhubAnnouncement> {
    if (principalId !== WORKHUB_ANNOUNCEMENT_PUBLISHER_ID) {
      throw new WorkhubAnnouncementError("forbidden", "Only General Affairs can publish announcements");
    }
    const { title, body } = validateAnnouncement(titleValue, bodyValue);
    const now = new Date();
    const item: WorkhubAnnouncement = {
      id: crypto.randomUUID(),
      title,
      body,
      authorId: principalId,
      publishedAt: now.toISOString(),
      ...validateAnnouncementDelivery(delivery, now),
    };
    const result = await this.db.prepare(`
      INSERT INTO workhub_announcements (
        id, environment, title, body, author_id, published_at,
        importance, audience_role, audience_department, visible_from, visible_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      item.id, this.environment, item.title, item.body,
      item.authorId, item.publishedAt, item.importance, item.audienceRole,
      item.audienceDepartment, item.visibleFrom, item.visibleUntil,
    ).run();
    if (result.meta?.changes !== 1) {
      throw new WorkhubAnnouncementError("storage_failure", "Announcement could not be published");
    }
    return item;
  }
}
