import { useState } from "react";
import "./showcase.css";

/**
 * Public, static evaluation entry for WORKHUB. No auth bypass, demo login,
 * provider calls, fabricated screenshots, or user/business data.
 * #267 implementation; #402/#474 remain the design sources.
 */
const REPO = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
const travelTest = REPO + "/blob/main/e2e/tests/workhub-travel-request.spec.ts";
const travelSource = REPO + "/blob/main/src/reference/workhub/travel-request/service.ts";
const searchSource = REPO + "/blob/main/src/reference/workhub/travel-search.ts";
const workhubUiSource = REPO + "/blob/main/src/App.tsx";

const tour = [
  {
    eyebrow: "01 / REQUEST",
    title: "社員が「出張したい」から始める",
    actor: "Aoi · 一般社員",
    action: "出張申請を作成し、承認依頼を提出する",
    visible: "REQUESTS の申請フォームと MY WORK / Notification",
    mechanism: "入力検証・業務更新・権限・Workflow",
    why: "見た目のフォームではなく、誰が何を申請できるかまで決める。",
    source: travelSource,
    sourceLabel: "出張申請の実装",
  },
  {
    eyebrow: "02 / APPROVAL",
    title: "上長が差し戻し、社員が再申請する",
    actor: "Ren · Manager → Aoi · 一般社員",
    action: "承認タスクから差戻し。社員が修正し、再申請する",
    visible: "MY WORK の承認タスクと申請の現在状態",
    mechanism: "役割と対象資源の認可・状態遷移・競合対策",
    why: "ボタンを隠すだけではなく、サーバーが判断する。",
    source: travelSource,
    sourceLabel: "Workflow / 更新処理",
  },
  {
    eyebrow: "03 / TRACE",
    title: "承認後も、何が起きたか追える",
    actor: "Ren · Manager → Aoi · 一般社員",
    action: "再申請を承認し、通知と申請履歴を確認する",
    visible: "Notification / Timeline に分かれて表示される履歴",
    mechanism: "業務の正本・通知・時系列履歴を分離",
    why: "現在の承認状態と「いつ何が起きたか」を混同しない。",
    source: workhubUiSource,
    sourceLabel: "通知・履歴の表示実装",
  },
  {
    eyebrow: "04 / BOUNDARY",
    title: "検索・帳票も、現在の権限で確認する",
    actor: "Aoi · 一般社員 / Ren · Manager",
    action: "自分に許可された出張申請を検索・参照する",
    visible: "検索結果とアクセス可能な詳細の違い",
    mechanism: "検索Indexを権限の正本にせず、参照時に再判定",
    why: "以前見えたデータが、現在も見えてよいとは限らない。",
    source: searchSource,
    sourceLabel: "認可付き検索",
  },
] as const;

const capabilityCards = [
  {
    number: "01",
    title: "普通の業務が動く",
    capability: "Workflow / Validation / Notification",
    description: "出張申請を提出、差し戻し、再申請、承認。画面操作と業務状態がつながる。",
    evidence: travelTest,
    evidenceLabel: "Browser E2Eを見る",
  },
  {
    number: "02",
    title: "権限が変わっても安全に扱う",
    capability: "Authorization / Search",
    description: "画面の表示制御ではなく、サーバー側の現在の権限を確認する。",
    evidence: searchSource,
    evidenceLabel: "実装を見る",
  },
  {
    number: "03",
    title: "失敗したときも判断できる",
    capability: "Operations / Audit / Outbox",
    description: "管理ポータルには失敗・再試行待ちなどの参照画面がある。外部受領の実照合はまだない。",
    evidence: REPO + "/blob/main/src/worker/administration/integration-operations-api.ts",
    evidenceLabel: "参照APIを見る",
  },
] as const;

export default function WorkhubShowcase() {
  const [step, setStep] = useState(0);
  const current = tour[step];
  return <div className="showcase-page">
    <a className="showcase-skip" href="#showcase-main">本文へスキップ</a>
    <header className="showcase-header">
      <a className="showcase-brand" href="/showcase" aria-label="WORKHUB Showcase トップ">
        <span className="showcase-mark" aria-hidden="true">W</span>
        <span><strong>WORKHUB</strong><small>REFERENCE SHOWCASE</small></span>
      </a>
      <nav aria-label="ショーケースのナビゲーション" className="showcase-nav">
        <a href="#showcase-tour">3分で見る</a>
        <a href="#showcase-proof">実装と根拠</a>
        <a href={REPO + "/blob/main/docs/README.md"} target="_blank" rel="noopener noreferrer">設計資料 ↗</a>
      </nav>
      <a className="showcase-header-demo" href="/">WORKHUBを試す ↗</a>
    </header>

    <main id="showcase-main">
      <section className="showcase-hero" aria-labelledby="showcase-title">
        <div className="showcase-hero-inner">
          <div className="showcase-hero-copy">
            <p className="showcase-kicker"><span className="showcase-kicker-dot" /> BUSINESS WEB APP TEMPLATE · REFERENCE</p>
            <h1 id="showcase-title">業務システムを、<br /><em>毎回ゼロから作らない。</em></h1>
            <p className="showcase-lead">AIがコードを書ける時代だからこそ、認証・権限・承認・監査・失敗時の振る舞いまで。<strong>実際に動く業務シナリオ</strong>から、再利用できる設計を確かめる。</p>
            <div className="showcase-actions">
              <a className="showcase-primary" href="#showcase-tour">3分で見る <span aria-hidden="true">↗</span></a>
              <a className="showcase-secondary" href="/">WORKHUBデモへ →</a>
            </div>
            <p className="showcase-hero-fine">架空企業のReference Applicationです。商用業務パッケージでも、本番運用の保証でもありません。</p>
          </div>
          <div className="showcase-preview" aria-label="WORKHUBの画面構成を示す概念図。実際のスクリーンショットではありません">
            <div className="showcase-preview-top"><span className="showcase-preview-dots" aria-hidden="true">● ● ●</span> WORKHUB <span>UI CONCEPT</span></div>
            <div className="showcase-preview-body">
              <aside aria-hidden="true"><span className="is-selected">⌂ HOME</span><span>✓ MY WORK</span><span>▤ REQUESTS</span><span>◌ SEARCH</span></aside>
              <div className="showcase-preview-content">
                <span className="showcase-mini-label">DIGITAL WORKPLACE</span>
                <h2>仕事の入口を、ひとつに。</h2>
                <div className="showcase-mini-row">
                  <div className="showcase-mini-card"><small>MY WORK</small><strong>承認を確認</strong><span>役割に応じたタスク</span></div>
                  <div className="showcase-mini-card"><small>QUICK ACTION</small><strong>出張したい</strong><span>申請から始める</span></div>
                </div>
                <div className="showcase-mini-panel"><span>REQUEST → APPROVAL → NOTIFICATION</span><div className="showcase-mini-progress"><b/><b/><b/></div><small>業務フローと判断の境界を体験</small></div>
              </div>
            </div>
            <div className="showcase-preview-caption">画面構成イメージ · 実際の操作は「WORKHUBデモへ」</div>
          </div>
        </div>
        <div className="showcase-hero-bottom">
          <span>01 / SEE THE FLOW</span><span>02 / INSPECT THE BOUNDARY</span><span>03 / OPEN THE SOURCE</span>
        </div>
      </section>

      <section className="showcase-intro" id="showcase-proof" aria-labelledby="showcase-proof-title">
        <div className="showcase-section-heading"><p className="showcase-label">WHY THIS REFERENCE?</p><h2 id="showcase-proof-title">「動く」を、<span>設計の根拠まで。</span></h2><p>機能数の多さではなく、業務の正常系と失敗時の境界を確認できます。</p></div>
        <div className="showcase-proof-grid">{capabilityCards.map((item) => <article key={item.number} className="showcase-proof-card">
          <div className="showcase-proof-num">{item.number} <span>／ 03</span></div>
          <h3>{item.title}</h3><p>{item.description}</p><small>{item.capability}</small>
          <a href={item.evidence} target="_blank" rel="noopener noreferrer">{item.evidenceLabel} ↗</a>
        </article>)}</div>
      </section>

      <section className="showcase-tour-section" id="showcase-tour" aria-labelledby="showcase-tour-title">
        <div className="showcase-section-heading"><p className="showcase-label">GUIDED TOUR / 3 MINUTES</p><h2 id="showcase-tour-title">出張申請から、<span>業務システムの中身を見る。</span></h2><p>このツアーは実装内容の案内です。シナリオを実際に操作する場合は、WORKHUBへ移動してください。</p></div>
        <div className="showcase-tour-shell">
          <div className="showcase-tour-rail" role="group" aria-label="ツアーのステップ">
            {tour.map((item, index) => <button type="button" key={item.eyebrow} className={index === step ? "is-current" : ""}
              aria-current={index === step ? "step" : undefined} onClick={() => setStep(index)}>
              <span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong>
            </button>)}
          </div>
          <article className="showcase-tour-detail" aria-live="polite">
            <p className="showcase-label">{current.eyebrow} <span>· {step + 1} / {tour.length}</span></p>
            <h3>{current.title}</h3>
            <div className="showcase-tour-actor">{current.actor}</div>
            <dl className="showcase-tour-facts">
              <div><dt>USER ACTION</dt><dd>{current.action}</dd></div>
              <div><dt>VISIBLE UI</dt><dd>{current.visible}</dd></div>
              <div><dt>UNDER THE HOOD</dt><dd>{current.mechanism}</dd></div>
            </dl>
            <p className="showcase-tour-why"><strong>ここがポイント</strong>{current.why}</p>
            <div className="showcase-tour-evidence">
              <a href={current.source} target="_blank" rel="noopener noreferrer">{current.sourceLabel} ↗</a>
              <a href={travelTest} target="_blank" rel="noopener noreferrer">E2Eテスト ↗</a>
            </div>
            <div className="showcase-tour-controls">
              <button type="button" onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0}>← 前へ</button>
              {step < tour.length - 1
                ? <button type="button" className="showcase-next" onClick={() => setStep((n) => Math.min(tour.length - 1, n + 1))}>次へ →</button>
                : <a className="showcase-next" href="/">実際のデモを試す →</a>}
            </div>
          </article>
        </div>
      </section>

      <section className="showcase-start" aria-labelledby="showcase-start-title">
        <div className="showcase-section-heading"><p className="showcase-label">TRY WORKHUB / DEMO WALKTHROUGH</p>
          <h2 id="showcase-start-title">実際の画面では、<span>ここから始める。</span></h2>
          <p>ガイドで流れをつかんだら、WORKHUBのデモで確かめてください。
            下記のPersona選択はReference Demoが有効な環境だけに表示されます。</p>
        </div>
        <ol className="showcase-start-steps">
          <li><span>01</span><div><strong>Aoi Employeeでログイン</strong><p>ログイン画面の「デモユーザを選ぶ」から一般社員を選択。出張申請を提出する</p></div></li>
          <li><span>02</span><div><strong>Ren Managerでログイン</strong><p>いったんログアウトし、上長としてMY WORKから差戻し・承認を確認する</p></div></li>
          <li><span>03</span><div><strong>Aoi Employeeに戻る</strong><p>通知・再申請・申請履歴を確認する。デモの一部は環境やデータ状態によって異なります</p></div></li>
        </ol>
        <a className="showcase-primary showcase-start-cta" href="/">WORKHUBログインを開く →</a>
        <p className="showcase-start-note">ログインは既存の認証処理を利用します。このShowcaseから自動ログインや業務データ更新は行いません。</p>
      </section>
      <section className="showcase-boundary" aria-labelledby="showcase-boundary-title">
        <div className="showcase-boundary-copy"><p className="showcase-label">HONEST EVIDENCE</p><h2 id="showcase-boundary-title">できることと、<br />まだできないこと。</h2><p>コードがあること、CIで検証したこと、実環境で検証したことは同じではありません。現時点の状態を区別します。</p></div>
        <div className="showcase-status-grid">
          <div><strong>IMPLEMENTED / CI VERIFIED</strong><p>出張申請・差戻し・再申請・承認、通知・履歴、認可付き検索、管理用Outbox参照</p></div>
          <div><strong>REFERENCE / DEMO</strong><p>架空ユーザー・デモデータを使うWORKHUB。実業務サービスの代替ではありません。</p></div>
          <div><strong>NOT IMPLEMENTED</strong><p>外部SaaSの受領結果を実照合するAdapter、自由に再送する運用機能、完成したAI Agent操作</p></div>
        </div>
      </section>

      <section className="showcase-end" aria-labelledby="showcase-end-title">
        <p className="showcase-label">NEXT / SEE IT YOURSELF</p><h2 id="showcase-end-title">見て終わらず、触って、確かめる。</h2>
        <p>デモの操作・実装の読み込み・テストの確認を、そのまま次のステップに。</p>
        <div className="showcase-actions">
          <a href="/" className="showcase-primary">WORKHUBデモへ →</a>
          <a href={REPO + "/blob/main/docs/README.md"} className="showcase-secondary" target="_blank" rel="noopener noreferrer">開発・設計資料 ↗</a>
          <a href={REPO} className="showcase-secondary" target="_blank" rel="noopener noreferrer">GitHub Source ↗</a>
        </div>
      </section>
    </main>
    <footer className="showcase-footer"><span>WORKHUB · REFERENCE SHOWCASE</span><span>React / TypeScript / Cloudflare Workers / D1</span><a href="/">デモのログイン画面へ →</a></footer>
  </div>;
}
