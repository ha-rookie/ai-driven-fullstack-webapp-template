import type { WorkhubTravelReportStatus } from "./report-status";

const statusMessages: Record<WorkhubTravelReportStatus["state"], string> = {
  not_generated: "承認は完了していますが、生成済みの帳票はありません。申請を再送信する必要はありません。",
  pending: "承認は完了しています。帳票生成の受付待ちです。申請・承認を再送信しないでください。",
  generating: "承認は完了しています。帳票を生成中です。申請・承認を再送信しないでください。",
  ready: "承認と帳票生成は完了しています。この画面からの原本ダウンロードは現在提供していません。",
  failed: "承認は完了していますが、帳票生成に失敗しました。申請・承認を繰り返さず管理者に連絡してください。",
  expired: "承認は完了していますが、以前の帳票は有効期限が切れています。申請を繰り返さず管理者に確認してください。",
  unavailable: "承認は完了していますが、帳票の状態を取得できません。0件とは限りません。時間をおいて状態を再確認してください。",
};

/** An existing authorized detail's read-only projection: no job/approval retry. */
export function TravelReportRecovery(props: {
  status: WorkhubTravelReportStatus;
  busy: boolean;
  onRefresh: () => void;
}) {
  return <section className="workhub-report-recovery" aria-label="帳票生成状況">
    <h3>帳票生成状況</h3>
    <p role={props.status.state === "failed" || props.status.state === "unavailable" ? "alert" : "status"}>
      {statusMessages[props.status.state]}
    </p>
    <button className="workhub-secondary-button" type="button" disabled={props.busy} onClick={props.onRefresh}>
      帳票状態を再確認（読み取りのみ）
    </button>
  </section>;
}
