import {
  developerScreens,
  type DeveloperScreenId,
} from "./developer-reference";

/** Safe design descriptions only. Never derived from current business records. */
export interface DeveloperGuideLayer {
  readonly id: string;
  readonly ja: string;
  readonly en: string;
  readonly detailJa: string;
  readonly detailEn: string;
}
export const developerArchitectureLayers: readonly DeveloperGuideLayer[] = [
  { id: "ui", ja: "WORKHUB画面", en: "WORKHUB UI", detailJa: "人が仕事を始め、結果を確認する表示層", detailEn: "Human entry and read-only presentation" },
  { id: "application", ja: "Application + 権限判定", en: "Application + Authorization", detailJa: "現行SessionとResource権限を評価して処理を仲介", detailEn: "Current session and resource authorization guard operations" },
  { id: "domain", ja: "Business Domain / Workflow", en: "Business Domain / Workflow", detailJa: "申請の正本と承認の状態・割当を保持する責務", detailEn: "Authoritative business records and approval assignment" },
  { id: "projections", ja: "Projection / Index", en: "Projection / Index", detailJa: "MY WORK・Search・Timeline等の参照用表示。正本ではない", detailEn: "Read models for MY WORK, search, and timeline; not the source of truth" },
  { id: "adapters", ja: "Integration Adapter", en: "Integration Adapter", detailJa: "マスターや外部・模擬サービスとの接続境界", detailEn: "Master-data and external/mock service boundaries" },
];

export interface DeveloperGuideCapability {
  readonly id: string;
  readonly screens: readonly DeveloperScreenId[];
}
export const developerCapabilityMap = (): readonly DeveloperGuideCapability[] => {
  const byName = new Map<string, DeveloperScreenId[]>();
  for (const screen of developerScreens) {
    for (const capability of screen.capabilities) {
      const linked = byName.get(capability) ?? [];
      if (!linked.includes(screen.id)) linked.push(screen.id);
      byName.set(capability, linked);
    }
  }
  return [...byName].map(([id, screens]) => ({ id, screens }));
};

export interface DeveloperGuideScenario {
  readonly id: string;
  readonly ja: string;
  readonly en: string;
  readonly kind: "implemented-reference" | "reference-mock" | "catalog-only";
  readonly personaJa: string;
  readonly personaEn: string;
  readonly screens: readonly DeveloperScreenId[];
  readonly noteJa: string;
  readonly noteEn: string;
}
/** Only journeys evidenced by the linked UI are marked implemented-reference. */
export const developerGuideScenarios: readonly DeveloperGuideScenario[] = [
  {
    id: "travel-request-settlement",
    ja: "出張申請から承認へ（精算は別業務）",
    en: "Travel request and approval (expense claim is separate)",
    kind: "implemented-reference",
    personaJa: "申請者・承認者", personaEn: "Requester and approver",
    screens: ["requests", "request-detail", "my-work", "notifications", "expenses", "ask-cecil"],
    noteJa: "本人による申請、承認担当者の確認、通知・履歴まで。旅費精算の完全自動化は行わない",
    noteEn: "Human submission, assigned approval, notifications and timeline; not automatic full travel settlement",
  },
  {
    id: "common-find",
    ja: "資料を探して根拠を確認",
    en: "Find information and verify evidence",
    kind: "implemented-reference",
    personaJa: "社員", personaEn: "Employee",
    screens: ["search", "documents", "ask-cecil"],
    noteJa: "許可された資料のみ検索・表示。資料矛盾は断定せず人へ確認",
    noteEn: "Only authorized documents; uncertainty goes to a human, not a fabricated answer",
  },
  {
    id: "moving-reference",
    ja: "引っ越し手続き（模擬Workflow）",
    en: "Moving workflow (mock)",
    kind: "reference-mock",
    personaJa: "社員", personaEn: "Employee",
    screens: ["apps", "secondary-journeys"],
    noteJa: "住所・通勤・緊急連絡先の確認は模擬Workflow。実人事情報は更新しない",
    noteEn: "Synthetic address/commute/contact steps, no real HR record updates",
  },
  {
    id: "pc-replacement-reference",
    ja: "PC交換手続き（模擬Workflow）",
    en: "PC replacement workflow (mock)",
    kind: "reference-mock",
    personaJa: "社員・総務担当", personaEn: "Employee and corporate staff",
    screens: ["apps", "secondary-journeys"],
    noteJa: "社員・総務のデモ手続きのみ。IT資産の交換・在庫連携は行わない",
    noteEn: "Demo handoff only; no actual asset replacement or inventory integration",
  },
  {
    id: "newcomer-onboarding",
    ja: "新入社員オンボーディング（ガイド例）",
    en: "Newcomer onboarding (guide concept)",
    kind: "catalog-only",
    personaJa: "新入社員・担当者", personaEn: "Newcomer and coordinator",
    screens: [],
    noteJa: "このガイドに連動する完成済みの一連画面としては登録していない",
    noteEn: "Not registered as a complete linked journey in this guide",
  },
  {
    id: "ai-access-request",
    ja: "AI利用申請（構想）",
    en: "AI access request (concept)",
    kind: "catalog-only",
    personaJa: "申請者・管理者", personaEn: "Requester and administrator",
    screens: [],
    noteJa: "構想のみ。Developer Modeから申請・権限追加はできない",
    noteEn: "Concept only. Developer Mode cannot apply or grant permissions",
  },
];

export const developerGuideLinkableScreen = (
  id: DeveloperScreenId,
): boolean => developerScreens.some(screen => screen.id === id);

/** Static Adapter catalog derived from the same screen metadata as screen-to-source. */
export const developerAdapterMap = (): readonly { screen: DeveloperScreenId; view: string; owner: string; mock: boolean }[] =>
  developerScreens.flatMap(screen => screen.sourceOfTruth
    .filter(ref => ref.kind === "adapter")
    .map(ref => ({
      screen: screen.id, view: ref.view, owner: ref.owner,
      mock: screen.readiness.some(x => x.state === "mock-adapter"),
    })));
