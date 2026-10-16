/**
 * #420: action-oriented *CI execution* labels, never verified security findings.
 * The caller validates the server DTO; this projection does not assert SCS/Evidence freshness.
 */
export interface CiExecution {
  readonly runId: number;
  readonly targetSha: string;
  readonly checkStatus: "queued" | "in-progress" | "completed";
  readonly checkConclusion?: "success" | "failure" | "cancelled" | "skipped"
    | "timed-out" | "neutral" | "action-required";
}
export interface CiObservation {
  readonly state: "not-connected" | "available" | "unavailable";
  readonly latest: CiExecution | null;
  readonly latestSuccessfulRun: CiExecution | null;
}
export interface CiTriage {
  readonly label: string;
  readonly history: string;
  readonly needsAttention: boolean;
}

export const classifySecurityCi = (ci: CiObservation): CiTriage => {
  if (ci.state === "not-connected") return {
    label: "CI未接続（未評価）", history: "CI記録未取得", needsAttention: true,
  };
  if (ci.state !== "available") return {
    label: "CI取得不能（unavailable） / 要確認", history: "CI記録未取得", needsAttention: true,
  };
  const latest = ci.latest;
  const success = ci.latestSuccessfulRun;
  const history = success
    ? latest?.runId === success.runId ? "最新Runの成功記録"
      : latest?.targetSha === success.targetSha
        ? "過去の成功Run（同一SHA・最新Runの結果ではない）"
        : "過去の成功Run（別SHA・最新コードの証拠ではない）"
    : "取得した直近5件内に成功Runなし（全履歴は未確認）";
  if (!latest) return { label: "CI実行記録なし（未評価）", history, needsAttention: true };
  if (latest.checkStatus === "queued" || latest.checkStatus === "in-progress") return {
    label: "CI実行待ち／実行中（判定保留）", history, needsAttention: true,
  };
  if (latest.checkStatus === "completed" && latest.checkConclusion === "success") {
    // A claimed latest success must also be the bounded-window successful run.
    if (!success || success.runId !== latest.runId || success.targetSha !== latest.targetSha) return {
      label: "CI記録に矛盾（要確認）", history: "CI成功を確認できません", needsAttention: true,
    };
    return { label: "CI最新Run成功（Finding未評価）", history, needsAttention: false };
  }
  if (latest.checkStatus === "completed"
    && (latest.checkConclusion === "skipped" || latest.checkConclusion === "neutral")) return {
    label: "CI最新Runは判定なし（要確認）", history, needsAttention: true,
  };
  return { label: "CI最新Run失敗／中断（要確認）", history, needsAttention: true };
};
