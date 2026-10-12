/**
 * Read-only WORKHUB Stage 3 fictitious document metadata.
 * The static catalog is the source for this Reference only. Search may later
 * index an authorized projection; it must not become the source of truth.
 * Never return allowedRoles, internal storage paths or contact details.
 */
export type WorkhubDocumentCategory = "公式" | "手順" | "FAQ";
export type WorkhubDocumentState = "current" | "stale" | "superseded";
export interface WorkhubDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly category: WorkhubDocumentCategory;
  readonly version: number;
  readonly ownerLabel: string;
  readonly reviewedAt: string;
  readonly state: WorkhubDocumentState;
  readonly summary: string;
  readonly replacementTitle: string | null;
}

interface DocumentDefinition extends WorkhubDocumentSummary {
  readonly allowedRoles: readonly string[];
}
const ALL_ROLES = ["newcomer", "employee", "manager", "accounting", "corporate", "system_admin"] as const;
const OPERATIONS_ROLES = ["employee", "manager", "accounting", "corporate"] as const;
const DOCUMENTS: readonly DocumentDefinition[] = [
  {
    id: "welcome-reference", title: "入社時の手続き（デモ）", category: "公式",
    version: 2, ownerLabel: "人事・総務（デモ）", reviewedAt: "2026-10-01",
    state: "current", summary: "入社時に確認する手続きの入口。実際の就業規則ではありません。",
    replacementTitle: null, allowedRoles: ALL_ROLES,
  },
  {
    id: "travel-expense-current", title: "出張と経費精算の手順（デモ）", category: "手順",
    version: 3, ownerLabel: "経理（デモ）", reviewedAt: "2026-10-05",
    state: "current", summary: "出張の申請から経費申請までのReference業務フロー。",
    replacementTitle: null, allowedRoles: OPERATIONS_ROLES,
  },
  {
    id: "travel-expense-legacy", title: "旧：出張精算ガイド（デモ）", category: "手順",
    version: 1, ownerLabel: "経理（デモ）", reviewedAt: "2026-05-01",
    state: "superseded", summary: "以前の手順を示す比較用サンプル。現行の手順には利用しないでください。",
    replacementTitle: "出張と経費精算の手順（デモ）", allowedRoles: OPERATIONS_ROLES,
  },
  {
    id: "accounting-faq", title: "経費に関するよくある質問（デモ）", category: "FAQ",
    version: 2, ownerLabel: "経理（デモ）", reviewedAt: "2026-04-20",
    state: "stale", summary: "確認日が古く、担当者による再確認が必要な参考情報です。",
    replacementTitle: null, allowedRoles: OPERATIONS_ROLES,
  },
  {
    id: "incident-management", title: "管理者向けインシデント対応（デモ）", category: "公式",
    version: 1, ownerLabel: "情報システム（デモ）", reviewedAt: "2026-09-10",
    state: "current", summary: "管理者向けReferenceの確認項目。実際の運用手順ではありません。",
    replacementTitle: null, allowedRoles: ["manager", "corporate", "system_admin"],
  },
];

export const listWorkhubReferenceDocuments = (currentRole: string): readonly WorkhubDocumentSummary[] =>
  DOCUMENTS.filter(doc => doc.allowedRoles.includes(currentRole))
    .map(({ id, title, category, version, ownerLabel, reviewedAt, state, summary, replacementTitle }) => ({
      id, title, category, version, ownerLabel, reviewedAt, state, summary, replacementTitle,
    }));
