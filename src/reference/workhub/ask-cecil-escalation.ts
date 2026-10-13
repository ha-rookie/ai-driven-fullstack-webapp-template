import type { CecilDocument, CecilEvidence, CecilGuide } from "./ask-cecil";

/**
 * A human-directed inquiry note, not an outgoing ticket/message.
 * Include a source only when it remains in the currently authorized documents
 * response AND its exact displayed revision/metadata can be re-confirmed.
 * Never serialize snippets, search-only candidates, session data, or chat history.
 */
export const createCecilEscalationNote = (
  question: string,
  guide: CecilGuide | null,
  currentlyAuthorizedDocuments: readonly CecilDocument[],
): string => {
  const cleanQuestion = question.trim().slice(0, 100);
  const currentById = new Map(currentlyAuthorizedDocuments.map(doc => [doc.id, doc]));
  const verified = (guide?.evidence ?? []).filter((item: CecilEvidence) => {
    const latest = currentById.get(item.id);
    return latest?.title === item.title && latest.version === item.version
      && latest.state === item.freshness && latest.ownerLabel === item.ownerLabel
      && latest.reviewedAt === item.reviewedAt;
  });
  const sourceLines = verified.slice(0, 5).map(item =>
    `・${item.title} (v${item.version} / ${item.freshness === "current" ? "現行" : item.freshness === "stale" ? "要再確認" : "旧版"} / 管理: ${item.ownerLabel} / 最終確認: ${item.reviewedAt})`
  );
  return [
    "【担当者に確認したいこと】",
    cleanQuestion || "（質問を入力してください）",
    "",
    "【Ask CECILでの確認状況】",
    guide?.status === "multiple" ? "関連資料が複数あり、統一した判断をしていません。"
      : guide?.status === "outdated" ? "旧版・要再確認の資料があり、正式な回答として扱っていません。"
      : guide?.status === "insufficient" || !guide ? "回答の根拠が不足しているか、検索を利用できません。"
      : "最終的な適用可否について、担当者の確認を希望します。",
    "",
    "【確認できた出典】",
    ...(sourceLines.length ? sourceLines : ["現時点で確認できた出典は添付していません。"]),
    "",
    "※これは問い合わせ用メモです。まだ誰にも送信されていません。",
  ].join("\n");
};
