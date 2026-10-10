/**
 * UI-only interpretation of an authenticated server Preview.
 * Project capability links are not permission grants. A Preview is provisional:
 * execution still independently checks authorization, policy, CSRF, version and audit.
 */
export interface MasterPreviewEvidence {
  readonly available: boolean;
  readonly reasonCode?: string | null;
  readonly preview: { readonly policyDecision: string };
}

export type MasterPreviewReadiness =
  | "reviewable" | "blocked" | "access-restricted" | "not-exposed" | "unknown";

export function classifyMasterPreviewReadiness(
  status: number | null,
  evidence: MasterPreviewEvidence | null = null,
): MasterPreviewReadiness {
  if (status === 401 || status === 403) return "access-restricted";
  if (status === 404) return "not-exposed";
  if (status === 400 || status === 409) return "blocked";
  if (status !== 200 || !evidence) return "unknown";
  if (evidence.available !== true) return evidence.available === false ? "blocked" : "unknown";
  return evidence.preview?.policyDecision === "REQUIRE_REASON" ? "reviewable" : "blocked";
}

export function masterPreviewReadinessMessage(
  status: MasterPreviewReadiness,
): string {
  switch (status) {
    case "reviewable":
      return "サーバー下見：操作条件を満たしています。実行時にも権限・状態を再確認します";
    case "blocked":
      return "サーバー下見：現在の条件では操作できません。対象・日時・Versionを確認してください";
    case "access-restricted":
      return "サーバーが操作を許可しませんでした（認証・権限・環境の制約）。実行できません";
    case "not-exposed":
      return "サーバーで対象操作を確認できません（未対応・対象外・非公開の可能性）。実行できません";
    case "unknown":
      return "サーバーの操作可否を確認できません。実行せず、状態を再確認してください";
  }
}
