/**
 * Ask CECIL Stage5 L0/L1. Reference-only, evidence-first response projection.
 * Never invent policies, reuse only currently authorized /search and /documents.
 * A browser projection is not a new authorization service or a business record.
 */
export interface CecilSearchResult {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly category: string;
  readonly title: string;
  readonly snippet?: string;
  readonly actionTarget?: string;
}
export interface CecilDocument {
  readonly id: string;
  readonly title: string;
  readonly category: "公式" | "手順" | "FAQ";
  readonly version: number;
  readonly ownerLabel: string;
  readonly reviewedAt: string;
  readonly state: "current" | "stale" | "superseded";
  readonly summary: string;
  readonly replacementTitle: string | null;
}
export type CecilAnswerStatus = "answer" | "find" | "multiple" | "outdated" | "insufficient";
export interface CecilEvidence {
  readonly id: string;
  readonly title: string;
  readonly category: CecilDocument["category"];
  readonly version: number;
  readonly ownerLabel: string;
  readonly reviewedAt: string;
  readonly freshness: CecilDocument["state"];
  readonly url: string | null;
}
export interface CecilDestination {
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly url: string | null;
}
export interface CecilGuide {
  readonly status: CecilAnswerStatus;
  readonly summary: string;
  readonly evidence: readonly CecilEvidence[];
  readonly destinations: readonly CecilDestination[];
}

/** Treat every API-provided URL as untrusted. Only WORKHUB-local anchors are navigable. */
export const safeCecilTarget = (raw: unknown): string | null =>
  typeof raw === "string" && /^(?:\/)?#workhub-[a-z0-9-]+$/u.test(raw) ? raw : null;

export const createCecilGuide = (
  results: readonly CecilSearchResult[],
  authorizedDocuments: readonly CecilDocument[],
): CecilGuide => {
  // The docs endpoint and search endpoint both enforce current session + D1 membership.
  // Enrich only the intersection. Never let search snippets masquerade as official evidence.
  const docById = new Map(authorizedDocuments.map(doc => [doc.id, doc]));
  const matches = results.filter(item => item.resourceType === "workhub_document")
    .flatMap(item => {
      const doc = docById.get(item.resourceId);
      return doc ? [{ doc, url: safeCecilTarget(item.actionTarget) }] : [];
    });
  const current = matches.filter(item => item.doc.state === "current");
  const evidence: CecilEvidence[] = matches.slice(0, 5).map(({ doc, url }) => ({
    id: doc.id, title: doc.title, category: doc.category, version: doc.version,
    ownerLabel: doc.ownerLabel, reviewedAt: doc.reviewedAt,
    freshness: doc.state, url,
  }));
  const destinations: CecilDestination[] = results.slice(0, 8).map(item => ({
    key: item.resourceType + ":" + item.resourceId,
    title: item.title,
    category: item.category,
    url: safeCecilTarget(item.actionTarget),
  }));
  if (current.length > 1) {
    return {
      status: "multiple",
      summary: "参照できる現行資料が複数あります。内容の一致を確認できないため、ひとつの答えにまとめず根拠を表示します。",
      evidence, destinations,
    };
  }
  if (current.length === 1) {
    return {
      status: "answer",
      // Source-authored summary, never an uncited model inference or invented regulation.
      summary: current[0].doc.summary,
      evidence, destinations,
    };
  }
  if (matches.length > 0) {
    return {
      status: "outdated",
      summary: "関連資料は見つかりましたが旧版または再確認が必要です。現行の正式な回答としては使用できません。",
      evidence, destinations,
    };
  }
  if (destinations.length > 0) {
    return {
      status: "find",
      summary: "関連する社内の入口が見つかりました。内容を確認してから次の手続きへ進んでください。",
      evidence: [], destinations,
    };
  }
  return {
    status: "insufficient",
    summary: "確認できる根拠が見つかりませんでした。推測では回答しません。通常検索または担当窓口で確認してください。",
    evidence: [], destinations: [],
  };
};

