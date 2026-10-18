import { useState } from "react";
import { projectRecoveryShowcase, RECOVERY_SHOWCASE_SCENARIOS,
  type RecoveryShowcaseScenarioId } from "../admin/recovery-showcase";

const REPO = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
const RPO_GOALS = [15, 30, 60, 120] as const;
const RTO_GOALS = [10, 20, 45, 90] as const;
const readStatus = (status: string): string =>
  status === "WITHIN_TARGET" ? "目標内" : status === "BREACHED" ? "目標超過"
    : status === "READY" ? "復旧準備OK" : status === "NOT_READY" ? "復旧準備NG"
      : status === "CURRENT" ? "有効" : status === "STALE" ? "期限切れ"
        : status === "MISSING" ? "記録なし" : status === "FAILED" ? "失敗"
          : status === "PASSED" ? "検証成功" : "判断不能";

/** Public, client-only #431 demonstration. No authentication or private API calls. */
export default function RecoveryDecisionLab() {
  const [mode, setMode] = useState<"scenario" | "targets">("scenario");
  const [scenario, setScenario] = useState<RecoveryShowcaseScenarioId>("ready");
  const [rpoGoal, setRpoGoal] = useState(60);
  const [rtoGoal, setRtoGoal] = useState(45);
  const [clock] = useState(() => new Date().toISOString());
  const currentScenario = mode === "targets" ? "ready" : scenario;
  const result = projectRecoveryShowcase(currentScenario, clock,
    mode === "targets" ? { rpoMinutes: rpoGoal, rtoMinutes: rtoGoal } : undefined);
  const { recovery, recoveryPlan } = result;
  const selected = RECOVERY_SHOWCASE_SCENARIOS.find(s => s.id === currentScenario);

  return <section id="showcase-recovery" className="showcase-recovery" aria-labelledby="showcase-recovery-title"
    data-testid="public-recovery-lab">
    <div className="showcase-recovery-inner">
      <div className="showcase-section-heading">
        <p className="showcase-label">INTERACTIVE / RECOVERY READINESS</p>
        <h2 id="showcase-recovery-title">バックアップできた。<span>でも、本当に戻せる？</span></h2>
        <p>「バックアップ成功」と「復旧できる」は別。状況や目標値を変え、
          復旧判断・RPO/RTO・手順11ステップがどう変わるかを体験できます。</p>
      </div>
      <div className="showcase-recovery-notice" role="note">
        <strong>架空の復旧データによる体験です。</strong>
        <span>実際のBackup・D1・Production・認証APIには一切接続せず、復元やサービス再開も実行しません。
          結果は実環境の復旧保証ではありません。</span>
      </div>
      <div className="showcase-recovery-shell">
        <div className="showcase-recovery-controls">
          <div role="group" className="showcase-recovery-modes" aria-label="体験方法">
            <button type="button" aria-pressed={mode === "scenario"}
              onClick={() => setMode("scenario")}>6つの状況を試す</button>
            <button type="button" aria-pressed={mode === "targets"}
              onClick={() => setMode("targets")}>目標値を変える</button>
          </div>
          {mode === "scenario" ? <>
            <p className="showcase-recovery-help">実際の復旧時に起こり得る状態を選んでください。</p>
            <div className="showcase-recovery-scenarios" role="group" aria-label="復旧シナリオ">
              {RECOVERY_SHOWCASE_SCENARIOS.map(item => <button key={item.id} type="button"
                aria-pressed={scenario === item.id} onClick={() => setScenario(item.id)}>
                {item.label}
              </button>)}
            </div>
            <p className="showcase-recovery-description">{selected?.description}</p>
          </> : <>
            <p className="showcase-recovery-help">復元検証OKの架空の状態から、許容目標を変えてみてください。
              復旧ポイントの経過は30分、復元所要は20分です。</p>
            <div className="showcase-recovery-selects">
              <label>RPO（許容データ損失時間）
                <select aria-label="RPO目標" value={rpoGoal}
                  onChange={event => setRpoGoal(Number(event.target.value))}>
                  {RPO_GOALS.map(n => <option key={n} value={n}>{n}分</option>)}
                </select>
              </label>
              <label>RTO（許容復旧時間）
                <select aria-label="RTO目標" value={rtoGoal}
                  onChange={event => setRtoGoal(Number(event.target.value))}>
                  {RTO_GOALS.map(n => <option key={n} value={n}>{n}分</option>)}
                </select>
              </label>
            </div>
            <button className="showcase-recovery-reset" type="button"
              onClick={() => { setRpoGoal(60); setRtoGoal(45); }}>目標値を初期状態に戻す</button>
          </>}
        </div>
        <div className="showcase-recovery-results" aria-live="polite">
          <div className="showcase-recovery-verdict">
            <span>RECOVERY READINESS ／ 架空データの判定</span>
            <strong data-testid="public-recovery-readiness" data-state={recovery.readiness}>
              {readStatus(recovery.readiness)} <small>({recovery.readiness})</small>
            </strong>
            <p>{recovery.readiness === "READY"
              ? "復元テストと業務検証がそろいました。ただし実環境の証拠や自動再開の許可ではありません。"
              : recovery.readiness === "NOT_READY"
                ? "違反・失敗・期限切れがあるため、そのままでは復旧準備完了と判断できません。"
                : "復旧を判断する証拠が不足しています。正常とみなせません。"}</p>
          </div>
          <div className="showcase-recovery-metrics">
            <div><span>Recovery Point / RPO</span><strong data-testid="public-recovery-rpo">{readStatus(recovery.rpo.status)}</strong>
              <small>経過 {recovery.rpo.exposureMinutes ?? "不明"}分 ／ 目標 {recovery.rpo.targetMinutes ?? "不明"}分</small></div>
            <div><span>Restore / RTO</span><strong data-testid="public-recovery-rto">{readStatus(recovery.rto.status)}</strong>
              <small>所要 {recovery.rto.measuredMinutes ?? "不明"}分 ／ 目標 {recovery.rto.targetMinutes ?? "不明"}分</small></div>
            <div><span>Restore freshness</span><strong data-testid="public-recovery-freshness">{readStatus(recovery.restoreFreshness)}</strong>
              <small>復元後の検証: {readStatus(recovery.postRestoreVerification)}</small></div>
          </div>
          {result.actionRequired && <p className="showcase-recovery-alert" role="status"
            data-testid="public-recovery-action">RPO超過：確認・対応が必要です（デモのみ）</p>}
        </div>
      </div>
      <div className="showcase-recovery-runbook">
        <div>
          <h3>復旧の11ステップ</h3>
          <p>記録のあるステップだけを検証済みとして扱います。復旧作業そのものは操作できません。</p>
        </div>
        <ol>{recoveryPlan.steps.map((item, index) => <li key={item.id}
          data-state={item.state}>
          <span className="showcase-recovery-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="showcase-recovery-stepname">{item.label}</span>
          <strong>{item.state === "VERIFIED" ? "検証済み" : item.state === "FAILED" ? "失敗"
            : item.state === "PENDING" ? "未実施" : "不明"}</strong>
          {item.requiresHumanGate && <small>人による確認が必須</small>}
        </li>)}</ol>
        <div className="showcase-recovery-resume">
          <span>Service Resume（再開判断）</span>
          <strong data-testid="public-recovery-resume">{recoveryPlan.resumeDecision}</strong>
          <p>{recoveryPlan.resumeDecision === "HUMAN_REVIEW_REQUIRED"
            ? "確認事項はそろっていますが、人の最終確認が必要です。自動再開はしません。"
            : "未検証や失敗などがあるため、サービス再開はできません。"}
            実際の復元・再開はどのシナリオでも実行できません。</p>
        </div>
      </div>
      <div className="showcase-recovery-sources">
        <a href={REPO + "/blob/main/src/shared/recovery/readiness.ts"} target="_blank" rel="noopener noreferrer">
          判定ロジックを見る ↗</a>
        <a href={REPO + "/blob/main/src/shared/recovery/recovery-plan.ts"} target="_blank" rel="noopener noreferrer">
          11ステップの実装を見る ↗</a>
        <a href={REPO + "/blob/main/tests/recovery-showcase.test.ts"} target="_blank" rel="noopener noreferrer">
          検証テストを見る ↗</a>
      </div>
    </div>
  </section>;
}
