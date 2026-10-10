/**
 * Distinguish a verified mutation, an explicit conflict/rejection, and
 * an indeterminate result. An HTTP 2xx alone is NOT verified success.
 * On timeout/5xx/invalid receipts never recommend blindly retrying POST.
 */
export interface MasterOperationReceipt {
  readonly execution?: { readonly result: string };
  readonly verification?: { readonly status: string };
}

export type MasterOperationOutcome = "verified" | "conflict" | "rejected" | "unknown";

export const classifyMasterOperationOutcome = (
  httpStatus: number,
  receipt: MasterOperationReceipt | null,
): MasterOperationOutcome => {
  if (httpStatus === 409) return "conflict";
  if (httpStatus >= 200 && httpStatus < 300
      && receipt?.execution?.result === "SUCCESS"
      && receipt.verification?.status === "PASSED") return "verified";
  if (httpStatus >= 400 && httpStatus < 500) return "rejected";
  return "unknown";
};

export const masterOperationRecoveryMessage = (outcome: MasterOperationOutcome): string => {
  if (outcome === "conflict") {
    return "対象のVersionまたは状態が変更されました。最新履歴を再取得し、新しい下見からやり直してください";
  }
  if (outcome === "rejected") {
    return "操作は拒否されました。認証・権限・入力内容を確認し、最新状態で再度下見してください";
  }
  if (outcome === "unknown") {
    return "操作が完了したか確認できません。自動再実行せず、最新の履歴と監査を確認してください";
  }
  return "操作と状態の検証が完了しました";
};
