export type IdempotencyState = "in_progress" | "completed" | "failed";

export interface IdempotencyContext {
  key: string;
  actorId: string;
  scopeId: string;
  action: string;
}

export interface IdempotencyReplayRecord {
  status: number;
  contentType: string;
  body: string;
}

export interface IdempotencyRecord extends IdempotencyContext {
  fingerprint: string;
  state: IdempotencyState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  replay?: IdempotencyReplayRecord | null;
}

export type CreateIdempotencyRecordResult =
  | { kind: "created"; record: IdempotencyRecord }
  | { kind: "existing"; record: IdempotencyRecord };

export type TransitionIdempotencyRecordResult =
  | { kind: "updated"; record: IdempotencyRecord }
  | { kind: "not_found" }
  | { kind: "fingerprint_mismatch"; record: IdempotencyRecord }
  | { kind: "not_in_progress"; record: IdempotencyRecord };

interface IdempotencyRow {
  idempotencyKey: string;
  actorId: string;
  scopeId: string;
  action: string;
  fingerprint: string;
  state: IdempotencyState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  replayStatus: number | null;
  replayContentType: string | null;
  replayBody: string | null;
}

const MAX_REPLAY_BODY_BYTES = 64 * 1024;

const changedRows = (result: D1Result<unknown>): number => Number(result.meta?.changes ?? 0);

const normalizeBounded = (value: string, name: string, maxLength: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TypeError(`${name} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
};

const normalizeContext = (context: IdempotencyContext): IdempotencyContext => ({
  key: normalizeBounded(context.key, "key", 128),
  actorId: normalizeBounded(context.actorId, "actorId", 128),
  scopeId: normalizeBounded(context.scopeId, "scopeId", 128),
  action: normalizeBounded(context.action, "action", 128),
});

const mapReplay = (row: IdempotencyRow): IdempotencyReplayRecord | null => {
  const values = [row.replayStatus, row.replayContentType, row.replayBody];
  const presentCount = values.filter((value) => value !== null).length;
  if (presentCount === 0) return null;
  if (presentCount !== 3) {
    throw new Error("idempotency_replay_metadata_incomplete");
  }
  return {
    status: row.replayStatus as number,
    contentType: row.replayContentType as string,
    body: row.replayBody as string,
  };
};

const mapRow = (row: IdempotencyRow): IdempotencyRecord => ({
  key: row.idempotencyKey,
  actorId: row.actorId,
  scopeId: row.scopeId,
  action: row.action,
  fingerprint: row.fingerprint,
  state: row.state,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  expiresAt: row.expiresAt,
  replay: mapReplay(row),
});

export const lookupIdempotencyRecord = async (
  db: D1Database,
  context: IdempotencyContext,
): Promise<IdempotencyRecord | null> => {
  const normalized = normalizeContext(context);
  const row = await db
    .prepare(
      `SELECT idempotency_key AS idempotencyKey,
              actor_id AS actorId,
              scope_id AS scopeId,
              action,
              fingerprint,
              state,
              created_at AS createdAt,
              updated_at AS updatedAt,
              expires_at AS expiresAt,
              replay_status AS replayStatus,
              replay_content_type AS replayContentType,
              replay_body AS replayBody
         FROM idempotency_records
        WHERE idempotency_key = ?
          AND actor_id = ?
          AND scope_id = ?
          AND action = ?`,
    )
    .bind(normalized.key, normalized.actorId, normalized.scopeId, normalized.action)
    .first<IdempotencyRow>();

  return row ? mapRow(row) : null;
};

export const createIdempotencyRecord = async (
  db: D1Database,
  input: IdempotencyContext & {
    fingerprint: string;
    createdAt: string;
    expiresAt: string;
  },
): Promise<CreateIdempotencyRecordResult> => {
  const context = normalizeContext(input);
  const fingerprint = normalizeBounded(input.fingerprint, "fingerprint", 256);

  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_records(
         idempotency_key, actor_id, scope_id, action, fingerprint,
         state, created_at, updated_at, expires_at
       ) VALUES(?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
    )
    .bind(
      context.key,
      context.actorId,
      context.scopeId,
      context.action,
      fingerprint,
      input.createdAt,
      input.createdAt,
      input.expiresAt,
    )
    .run();

  const record = await lookupIdempotencyRecord(db, context);
  if (!record) {
    throw new Error("idempotency_record_missing_after_create");
  }

  return changedRows(result) === 1
    ? { kind: "created", record }
    : { kind: "existing", record };
};

const transitionIdempotencyRecord = async (
  db: D1Database,
  input: IdempotencyContext & {
    fingerprint: string;
    changedAt: string;
  },
  nextState: Exclude<IdempotencyState, "in_progress">,
  replay: IdempotencyReplayRecord | null,
): Promise<TransitionIdempotencyRecordResult> => {
  const context = normalizeContext(input);
  const fingerprint = normalizeBounded(input.fingerprint, "fingerprint", 256);

  const result = await db
    .prepare(
      `UPDATE idempotency_records
          SET state = ?,
              updated_at = ?,
              replay_status = ?,
              replay_content_type = ?,
              replay_body = ?
        WHERE idempotency_key = ?
          AND actor_id = ?
          AND scope_id = ?
          AND action = ?
          AND fingerprint = ?
          AND state = 'in_progress'`,
    )
    .bind(
      nextState,
      input.changedAt,
      replay?.status ?? null,
      replay?.contentType ?? null,
      replay?.body ?? null,
      context.key,
      context.actorId,
      context.scopeId,
      context.action,
      fingerprint,
    )
    .run();

  const record = await lookupIdempotencyRecord(db, context);
  if (changedRows(result) === 1) {
    if (!record) {
      throw new Error("idempotency_record_missing_after_transition");
    }
    return { kind: "updated", record };
  }

  if (!record) {
    return { kind: "not_found" };
  }
  if (record.fingerprint !== fingerprint) {
    return { kind: "fingerprint_mismatch", record };
  }
  return { kind: "not_in_progress", record };
};

const normalizeReplay = (replay: IdempotencyReplayRecord): IdempotencyReplayRecord => {
  if (!Number.isInteger(replay.status) || replay.status < 200 || replay.status > 299) {
    throw new TypeError("replay status must be a 2xx integer");
  }
  const contentType = normalizeBounded(replay.contentType, "replay contentType", 128);
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new TypeError("replay contentType must be application/json");
  }
  const bodyBytes = new TextEncoder().encode(replay.body).byteLength;
  if (bodyBytes > MAX_REPLAY_BODY_BYTES) {
    throw new TypeError(`replay body must be at most ${MAX_REPLAY_BODY_BYTES} bytes`);
  }
  return { status: replay.status, contentType, body: replay.body };
};

export const completeIdempotencyRecord = (
  db: D1Database,
  input: IdempotencyContext & { fingerprint: string; changedAt: string },
): Promise<TransitionIdempotencyRecordResult> =>
  transitionIdempotencyRecord(db, input, "completed", null);

export const completeIdempotencyRecordWithReplay = (
  db: D1Database,
  input: IdempotencyContext & {
    fingerprint: string;
    changedAt: string;
    replay: IdempotencyReplayRecord;
  },
): Promise<TransitionIdempotencyRecordResult> =>
  transitionIdempotencyRecord(db, input, "completed", normalizeReplay(input.replay));

export const failIdempotencyRecord = (
  db: D1Database,
  input: IdempotencyContext & { fingerprint: string; changedAt: string },
): Promise<TransitionIdempotencyRecordResult> =>
  transitionIdempotencyRecord(db, input, "failed", null);
