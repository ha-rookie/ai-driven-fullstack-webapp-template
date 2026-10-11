import type { WorkhubAppEntry } from "./app-catalog";

/** WORKHUB Stage 2 Reference catalog: navigational projection, not workflow state. */
export interface WorkhubRequestIntent {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly availability: "connected" | "guide_only";
  readonly target: string | null;
}

const CONNECTED_INTENTS = [
  {
    key: "travel", appKey: "travel-request", title: "出張したい",
    description: "出張申請から承認、出張後の経費精算へ進みます。",
    steps: ["出張申請を作成", "上長が確認・承認", "出張後に経費精算"],
  },
  {
    key: "expenses", appKey: "expense-settlement", title: "経費を精算・確認したい",
    description: "経費明細の申請、経理確認や差戻し対応を行います。",
    steps: ["明細を登録", "経理による確認", "必要なら修正・再申請"],
  },
  {
    key: "approvals", appKey: "approval-tasks", title: "申請を承認したい",
    description: "自分に割り当てられた申請を確認します。",
    steps: ["申請内容を確認", "承認または理由付き差戻し"],
  },
] as const;

const GUIDE_ONLY_INTENTS: readonly WorkhubRequestIntent[] = [
  {
    key: "moving", title: "引っ越した",
    description: "住所変更に伴う手続きの例です。実際の申請画面には接続されていません。",
    availability: "guide_only", target: null,
    steps: ["住所変更", "通勤経路の変更", "緊急連絡先の確認"],
  },
  {
    key: "pc-replacement", title: "PCを交換したい",
    description: "社内ITに依頼する手順の例です。申請・承認はまだ実装されていません。",
    availability: "guide_only", target: null,
    steps: ["交換理由を整理", "端末情報を確認", "サービスデスクへ申請"],
  },
];

/**
 * Input MUST be the already-authorized GET /api/workhub/apps result.
 * Do not use this discovery list as resource authorization.
 */
export const listWorkhubRequestIntents = (
  authorizedApps: readonly WorkhubAppEntry[],
): readonly WorkhubRequestIntent[] => {
  const connected = CONNECTED_INTENTS.flatMap(intent => {
    const app = authorizedApps.find(entry => entry.key === intent.appKey);
    if (app?.availability !== "available" || !app.launchTarget
      || !/^\/(?:#workhub-[a-z-]+|admin)$/u.test(app.launchTarget)) return [];
    return [{
      key: intent.key,
      title: intent.title,
      description: intent.description,
      steps: [...intent.steps],
      availability: "connected" as const,
      target: app.launchTarget,
    }];
  });
  return [...connected, ...GUIDE_ONLY_INTENTS];
};
