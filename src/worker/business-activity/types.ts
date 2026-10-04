export type BusinessActivityMetadataValue = string | number | boolean | null;
export type BusinessActivityMetadata = Readonly<Record<string, BusinessActivityMetadataValue>>;

export interface BusinessActivityRecord {
  readonly id: string;
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly activityType: string;
  readonly actorRef: string | null;
  readonly actorDisplaySnapshot: string | null;
  readonly subjectRef: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sequence: number;
  readonly visibilityScope: string | null;
  readonly metadata: BusinessActivityMetadata;
  readonly occurredAt: string;
  readonly createdAt: string;
}

export interface BusinessActivityCursor {
  readonly occurredAt: string;
  readonly sequence: number;
  readonly id: string;
}

export interface BusinessActivityStoreListQuery {
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly limit: number;
  readonly cursor?: BusinessActivityCursor;
  readonly activityTypes?: readonly string[];
}

export interface BusinessActivityStorePage {
  readonly items: readonly BusinessActivityRecord[];
  readonly nextCursor: BusinessActivityCursor | null;
}

export interface BusinessActivityStore {
  append(record: BusinessActivityRecord): Promise<"created" | "duplicate">;
  list(query: BusinessActivityStoreListQuery): Promise<BusinessActivityStorePage>;
}

export interface ProjectBusinessActivityInput {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly activityType: string;
  readonly actorRef?: string | null;
  readonly actorDisplaySnapshot?: string | null;
  readonly subjectRef?: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sequence?: number;
  readonly visibilityScope?: string | null;
  readonly metadata?: BusinessActivityMetadata;
  readonly occurredAt: string;
}

export interface BusinessActivityProjectionResult {
  readonly record: BusinessActivityRecord;
  readonly created: boolean;
}

export interface BusinessActivityReadContext {
  readonly principalId: string;
  readonly environment: string;
  readonly resourceType: string;
  readonly resourceId: string;
}

export interface BusinessActivityResourceAuthorizer {
  assertCanRead(context: BusinessActivityReadContext): Promise<void> | void;
}

export interface BusinessActivityVisibilityPolicy {
  apply(
    entry: BusinessActivityRecord,
    context: BusinessActivityReadContext,
  ): Promise<BusinessActivityRecord | null> | BusinessActivityRecord | null;
}

export interface BusinessActivityTimelineQuery {
  readonly principalId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly activityTypes?: readonly string[];
}

export interface BusinessActivityTimelinePage {
  readonly items: readonly BusinessActivityRecord[];
  readonly nextCursor: string | null;
}

export interface BusinessActivityFormatContext {
  readonly locale: string;
  readonly timeZone: string;
  readonly actorDisplay?: string | null;
}

export interface BusinessActivityPresentation {
  readonly messageKey: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface BusinessActivityFormatter {
  format(
    entry: BusinessActivityRecord,
    context: BusinessActivityFormatContext,
  ): BusinessActivityPresentation;
}
