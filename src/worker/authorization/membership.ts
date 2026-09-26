import type { ScopeMembership } from "./types";

interface ScopeMembershipRow {
  scopeId: string;
  userId: string;
  role: string;
}

export const findScopeMembership = async (
  db: D1Database,
  userId: string,
  scopeId: string,
): Promise<ScopeMembership | null> =>
  db
    .prepare(
      "SELECT scope_id AS scopeId,user_id AS userId,role FROM scope_memberships WHERE user_id=? AND scope_id=?",
    )
    .bind(userId, scopeId)
    .first<ScopeMembershipRow>();
