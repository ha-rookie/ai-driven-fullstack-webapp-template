import { useEffect, useRef } from "react";
import type { CecilTravelDraft } from "./travel-draft";

interface CecilTravelReviewProps {
  readonly draft: CecilTravelDraft;
  readonly actor: string;
  readonly officeLabel: string;
  readonly submitting: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Explicit L3 human gate. It is a read-only summary, not a command executor.
 * The parent routes the distinct confirm gesture to the EXISTING application
 * create/submit workflow, with live authorization checks before mutation.
 */
export default function CecilTravelReview({
  draft, actor, officeLabel, submitting, onConfirm, onCancel,
}: CecilTravelReviewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className="workhub-cecil-review" role="region" aria-labelledby="workhub-cecil-review-title">
      <span className="workhub-card-label">L3 / HUMAN CONFIRMATION</span>
      <h3 id="workhub-cecil-review-title" tabIndex={-1} ref={titleRef}>出張申請を提出する前の最終確認</h3>
      <p><strong>Ask CECILは申請を提出しません。</strong>以下は本人が確認し、提出を選ぶための内容です。</p>
      <dl>
        <div><dt>実行者</dt><dd>{actor}</dd></div>
        <div><dt>実行する操作</dt><dd>出張申請を作成して提出し、上長へ承認を依頼する</dd></div>
        <div><dt>行先</dt><dd>{officeLabel}</dd></div>
        <div><dt>開始日</dt><dd>{draft.startDate}</dd></div>
        <div><dt>終了日</dt><dd>{draft.endDate}</dd></div>
        <div><dt>目的</dt><dd className="workhub-cecil-review-purpose">{draft.purpose}</dd></div>
        <div><dt>実行後</dt><dd>承認待ちの申請と通知が発生します。自動承認はしません。</dd></div>
      </dl>
      <p className="workhub-reference-note">内容を変更する場合は「編集に戻る」を選んでください。確認だけでは保存・提出されません。</p>
      <div className="workhub-cecil-review-actions">
        <button type="button" className="workhub-secondary-button" disabled={submitting} onClick={onCancel}>編集に戻る</button>
        <button type="button" className="workhub-primary-button" disabled={submitting} onClick={onConfirm}>
          {submitting ? "提出処理の結果を確認中…" : "確認して出張申請を提出"}
        </button>
      </div>
    </section>
  );
}
