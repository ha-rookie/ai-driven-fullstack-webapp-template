/**
 * WORKHUB Stage4 read-only Social Feed Reference.
 * Fictional posts only. They are never an authoritative company policy,
 * workflow history, actual employee activity or generated engagement metrics.
 * The Worker resolves current D1 scope membership before projection.
 */
export type WorkhubSocialCategory = "community" | "thanks" | "knowledge_share";
export interface WorkhubSocialPost {
  readonly id: string;
  readonly category: WorkhubSocialCategory;
  readonly title: string;
  readonly body: string;
  readonly authorLabel: string;
  readonly createdAt: string;
  readonly reactionCount: number;
  readonly commentCount: number;
}
interface PostDefinition extends WorkhubSocialPost {
  readonly allowedRoles: readonly string[];
}
const ALL_ROLES = ["newcomer", "employee", "manager", "accounting", "corporate", "system_admin"] as const;
const OPERATIONS_ROLES = ["employee", "manager", "accounting", "corporate"] as const;
const POSTS: readonly PostDefinition[] = [
  {
    id: "reference-community-welcome", category: "community", title: "新しい仲間を迎える会（デモ）",
    body: "今月の交流会では、部署を越えて気軽に話しましょう。参加案内のサンプル投稿です。",
    authorLabel: "コミュニティ運営（デモ）", createdAt: "2026-10-12T04:00:00.000Z",
    reactionCount: 8, commentCount: 2, allowedRoles: ALL_ROLES,
  },
  {
    id: "reference-learning-share", category: "knowledge_share", title: "業務改善のアイデア共有（デモ）",
    body: "小さな作業の手戻りを減らす工夫を持ち寄りませんか。正式な業務ルールは公式文書を確認してください。",
    authorLabel: "勉強会コミュニティ（デモ）", createdAt: "2026-10-11T04:00:00.000Z",
    reactionCount: 5, commentCount: 1, allowedRoles: OPERATIONS_ROLES,
  },
  {
    id: "reference-thanks", category: "thanks", title: "チームへのありがとう（デモ）",
    body: "作業引継ぎを手伝ってくれた皆さん、ありがとうございました。",
    authorLabel: "社員コミュニティ（デモ）", createdAt: "2026-10-10T04:00:00.000Z",
    reactionCount: 6, commentCount: 0, allowedRoles: ALL_ROLES,
  },
  {
    id: "reference-manager-community", category: "community", title: "マネージャー向け交流会（デモ）",
    body: "管理職向けの意見交換会の見本です。実際の社内情報を含みません。",
    authorLabel: "管理職コミュニティ（デモ）", createdAt: "2026-10-09T04:00:00.000Z",
    reactionCount: 3, commentCount: 1, allowedRoles: ["manager"],
  },
];
export const listWorkhubSocialReference = (currentRole: string): readonly WorkhubSocialPost[] =>
  POSTS.filter(post => post.allowedRoles.includes(currentRole))
    .map(({ id, category, title, body, authorLabel, createdAt, reactionCount, commentCount }) => ({
      id, category, title, body, authorLabel, createdAt, reactionCount, commentCount,
    }));
