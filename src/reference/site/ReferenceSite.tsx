import "./reference-site.css";

/**
 * #433 static Reference Site first slice. No application AuthProvider, Worker API,
 * credentials, remote data, or additional documentation source of truth.
 * Existing GitHub documents, WORKHUB and Showcase remain the canonical targets.
 */
const REPO = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
const source = (path: string): string => REPO + "/blob/main/" + path;

interface ReferenceCapability {
  readonly id: string;
  readonly domain: string;
  readonly title: string;
  readonly purpose: string;
  readonly implementation: string;
  readonly verification: string;
  readonly limitation: string;
  readonly recipe: string;
  readonly code: string;
  readonly test: string;
  readonly demo?: string;
  readonly demoLabel?: string;
}

const CAPABILITIES: readonly ReferenceCapability[] = [
  {
    id: "workflow",
    domain: "BUSINESS / WORKFLOW",
    title: "申請と承認",
    purpose: "出張申請の作成・差戻し・再申請・承認。業務状態と承認状態を分離し、二重実行や競合を防ぐ実装例。",
    implementation: "IMPLEMENTED",
    verification: "CI VERIFIED（Repositoryの代表Browserテスト）",
    limitation: "デモの人物・出張先は架空。外部の業務システムへの本番導入を証明しません。",
    recipe: "docs/recipes/REFERENCE_TRAVEL_REQUEST.md",
    code: "src/reference/workhub/travel-request/service.ts",
    test: "e2e/tests/workhub-travel-request.spec.ts",
    demo: "/",
    demoLabel: "WORKHUBで操作する（ログインが必要）",
  },
  {
    id: "authorization",
    domain: "PLATFORM / SECURITY",
    title: "認証と認可",
    purpose: "表示ボタンではなくサーバー側のScope・Role・現在の権限を正本として業務操作を判定する。",
    implementation: "IMPLEMENTED（代表的な権限境界）",
    verification: "CI VERIFIED（代表的な認可付き業務E2E）",
    limitation: "利用者・Scopeはデモ用。実企業のSSO/組織ポリシー適用を保証しません。",
    recipe: "docs/recipes/AUTHORIZATION_BOUNDARY.md",
    code: "docs/AUTHORIZATION_DESIGN.md",
    test: "e2e/tests/workhub-travel-request.spec.ts",
    demo: "/",
    demoLabel: "WORKHUBのロール別操作を見る（ログインが必要）",
  },
  {
    id: "recovery",
    domain: "OPERATIONS / RECOVERY",
    title: "Backupと復旧判断",
    purpose: "Backup成功と復旧可能性を分け、検証失敗・監査証跡不足では安全な再開を許可しない判断を見せる。",
    implementation: "REFERENCE DEMO（架空復旧）",
    verification: "CI VERIFIED（模擬Golden Recoveryテスト）",
    limitation: "画面・承認・監査IDは模擬。Production Restore、Remote D1復元、実復旧保証はありません。",
    recipe: "docs/RECOVERY_OPERATIONS.md",
    code: "src/shared/recovery/readiness.ts",
    test: "tests/recovery-showcase.test.ts",
    demo: "/showcase/#showcase-recovery",
    demoLabel: "Recovery判断デモを見る（読取専用）",
  },
  {
    id: "search",
    domain: "BUSINESS / AUTHORIZED SEARCH",
    title: "権限付き検索",
    purpose: "出張申請を検索するとき、検索Indexを権限の正本にせず、取得時点のサーバー側権限で再確認する。",
    implementation: "IMPLEMENTED（出張申請の対象範囲）",
    verification: "CI VERIFIED（代表Browserテスト）",
    limitation: "確認済みなのは出張申請の代表的な検索経路。全業務の横断検索やAI/RAGの本番運用を証明しません。",
    recipe: "docs/search-foundation.md",
    code: "src/reference/workhub/travel-search.ts",
    test: "e2e/tests/workhub-travel-request.spec.ts",
    demo: "/",
    demoLabel: "WORKHUBで出張申請を検索する（ログインが必要）",
  },
  {
    id: "report",
    domain: "BUSINESS / REPORT",
    title: "PDF帳票の生成",
    purpose: "承認済み出張の情報と履歴を使い、権限を確認しながら帳票を生成・保存する実装例。",
    implementation: "IMPLEMENTED（出張承認PDFの例）",
    verification: "CI VERIFIED（PDFテスト。Browserでの帳票取得は未検証）",
    limitation: "ここには直接操作できる公開PDFデモはありません。Preview/Productionでの帳票ダウンロードも未検証です。",
    recipe: "docs/REPORT_GENERATION.md",
    code: "src/reference/workhub/travel-report.ts",
    test: "tests/workhub-travel-report-pdf.test.ts",
  },
  {
    id: "csv",
    domain: "PLATFORM / DATA IMPORT EXPORT",
    title: "CSV入出力",
    purpose: "CSVの検証・ドライラン・確定処理と出力を、業務で再利用するための実装例。",
    implementation: "IMPLEMENTED（共通基盤）",
    verification: "CI VERIFIED（CSVユニットテスト）",
    limitation: "公開WORKHUBから操作できるCSVデモはありません。業務画面への組込み・実データ運用は別途必要です。",
    recipe: "docs/recipes/DATA_IMPORT_EXPORT.md",
    code: "src/shared/tabular-data/csv-import.ts",
    test: "tests/tabular-data-csv.test.ts",
  },
];


/** #433 verified showcase-tour relationships; not the full WORKHUB scenario inventory. */
const SCENARIOS = [
  {
    id: "return",
    title: "申請の差戻しと再申請",
    summary: "社員の申請を上長が差し戻し、修正して再提出する。Workflow・認可・通知のつながりを確認する。",
    capability: "WORKFLOW / AUTHORIZATION",
    source: "src/reference/workhub/travel-request/service.ts",
    test: "e2e/tests/workhub-travel-request.spec.ts",
  },
  {
    id: "expense",
    title: "出張承認から経費精算へ",
    summary: "出張承認と経費精算は別の業務。経理担当による確認まで、WORKHUBの案内と実装をたどる。",
    capability: "TRAVEL / EXPENSE",
    source: "src/reference/workhub/expenses.ts",
    test: "e2e/tests/workhub-expenses.spec.ts",
  },
  {
    id: "search",
    title: "現在の権限で出張を検索",
    summary: "検索結果の表示と参照権限を分け、最新の権限に従って業務データを確認する。",
    capability: "AUTHORIZED SEARCH",
    source: "src/reference/workhub/travel-search.ts",
    test: "e2e/tests/workhub-travel-request.spec.ts",
  },
] as const;

function ExternalEvidence({ path, children }: { readonly path: string; readonly children: string }) {
  return <a href={source(path)} target="_blank" rel="noopener noreferrer">{children} ↗</a>;
}

export default function ReferenceSite() {
  return (
    <div className="reference-site">
      <a className="reference-skip" href="#reference-main">本文へスキップ</a>
      <header className="reference-header">
        <a href="/reference" className="reference-brand" aria-label="Reference Site ホーム">
          <span className="reference-brand-mark" aria-hidden="true">R</span>
          <span>WORKHUB <small>DEVELOPER REFERENCE</small></span>
        </a>
        <nav aria-label="Reference Site ナビゲーション">
          <a href="#reference-start">使い始める</a>
          <a href="#reference-capabilities">実装例を探す</a>
          <a href="#reference-scenarios">業務シナリオ</a>
          <a href="#reference-status">開発状況</a>
          <a href="/showcase">3分デモ</a>
        </nav>
      </header>

      <main id="reference-main">
        <section className="reference-hero" aria-labelledby="reference-title">
          <p className="reference-eyebrow">CODE → RUNNING EXAMPLE → REFERENCE</p>
          <h1 id="reference-title">業務Webアプリの設計を、<span>動く例とコードで確かめる。</span></h1>
          <p className="reference-lead">認証・権限・申請・監査・復旧。業務システムで繰り返す判断を、既存の実装・テスト・設計資料へ直接たどれるリファレンスです。</p>
          <div className="reference-actions">
            <a className="reference-primary" href="#reference-capabilities">実装と証拠を見る →</a>
            <a className="reference-secondary" href="/showcase">3分で動きを見る →</a>
          </div>
          <p className="reference-hero-note">完成した業務製品ではありません。WORKHUBは架空企業のReference Applicationです。</p>
        </section>

        <section id="reference-start" className="reference-section" aria-labelledby="reference-start-title">
          <p className="reference-eyebrow">START / まずはここから</p>
          <h2 id="reference-start-title">読みたい場所から始める</h2>
          <div className="reference-entry-grid">
            <article className="reference-entry">
              <span className="reference-entry-number">01</span>
              <h3>ローカルで動かす</h3>
              <p>既存のREADMEから環境構築と起動方法を確認する。</p>
              <a href={source("README.md")} target="_blank" rel="noopener noreferrer">Getting Started / README ↗</a>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">02</span>
              <h3>仕事の流れを見る</h3>
              <p>出張申請・承認と、異常時の復旧判断を架空デモで体験する。</p>
              <a href="/showcase">公開Showcaseへ →</a>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">03</span>
              <h3>なぜそう作るか読む</h3>
              <p>設計判断、責務の境界、採用しなかった方法をソースから確認する。</p>
              <ExternalEvidence path="docs/README.md">設計資料一覧</ExternalEvidence>
            </article>
          </div>
        </section>

        <section id="reference-capabilities" className="reference-section" aria-labelledby="reference-cap-title">
          <p className="reference-eyebrow">CAPABILITY / RECIPE / EVIDENCE</p>
          <h2 id="reference-cap-title">代表的な6つの実装・設計パターン</h2>
          <p className="reference-section-lead">既存の実装から代表例を選んで紹介しています。ここに掲載した6件は全Capabilityの棚卸し完了を意味しません。</p>
          <div className="reference-capability-grid">
            {CAPABILITIES.map((item) => (
              <article className="reference-capability" key={item.id} id={"reference-" + item.id}>
                <p className="reference-eyebrow">{item.domain}</p>
                <h3>{item.title}</h3>
                <p>{item.purpose}</p>
                <dl className="reference-evidence-status">
                  <div><dt>実装</dt><dd>{item.implementation}</dd></div>
                  <div><dt>確認</dt><dd>{item.verification}</dd></div>
                </dl>
                <div className="reference-links" aria-label={item.title + " の参照先"}>
                  {item.demo && item.demoLabel
                    ? <a href={item.demo}>{item.demoLabel} →</a>
                    : <span>操作デモなし（設計・ソース・テストを参照）</span>}
                  <ExternalEvidence path={item.recipe}>Recipe / 設計</ExternalEvidence>
                  <ExternalEvidence path={item.code}>Source / Contract</ExternalEvidence>
                  <ExternalEvidence path={item.test}>Test / Evidence</ExternalEvidence>
                </div>
                <p className="reference-limitation"><strong>適用範囲：</strong>{item.limitation}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="reference-scenarios" className="reference-section" aria-labelledby="reference-scenarios-title">
          <p className="reference-eyebrow">WORKHUB / GUIDED SCENARIOS</p>
          <h2 id="reference-scenarios-title">業務の場面から、実装までたどる</h2>
          <p className="reference-section-lead">既存ショーケースの該当ステップへ直接移動します。ツアーは操作手順の案内であり、ログインが必要な実操作やPreview検証の完了を保証しません。ここにある3件は全シナリオの対応付けではありません。</p>
          <div className="reference-entry-grid">
            {SCENARIOS.map((scenario) => (
              <article className="reference-entry" id={"reference-scenario-" + scenario.id} key={scenario.id}>
                <span className="reference-entry-number">{scenario.capability}</span>
                <h3>{scenario.title}</h3>
                <p>{scenario.summary}</p>
                <a href={"/showcase?scenario=" + scenario.id + "#showcase-tour"}>ショーケースの該当場面を見る →</a>
                <p><ExternalEvidence path={scenario.source}>Source</ExternalEvidence></p>
                <p><ExternalEvidence path={scenario.test}>Browser E2E</ExternalEvidence></p>
              </article>
            ))}
          </div>
        </section>

        <section id="reference-status" className="reference-section" aria-labelledby="reference-status-title">
          <p className="reference-eyebrow">ROADMAP / STATUS / EVIDENCE</p>
          <h2 id="reference-status-title">開発状況はGitHubの正本で確認する</h2>
          <p className="reference-section-lead">この画面で見られる範囲と、まだ確認が必要な条件を分けて案内します。進捗率や公開状態は固定表示せず、最新のGitHub記録を参照してください。</p>
          <div className="reference-entry-grid">
            <article className="reference-entry">
              <span className="reference-entry-number">01 / REFERENCE</span>
              <h3>この画面の実装範囲</h3>
              <p>既存の6つの代表Capabilityと3つの業務シナリオを紹介しています。Reference Site全体の完成を意味しません。</p>
              <a href={REPO + "/issues/433"} target="_blank" rel="noopener noreferrer">Reference Siteの受入条件 ↗</a>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">02 / ROADMAP</span>
              <h3>残作業と着手順</h3>
              <p>テンプレート全体の実装計画・優先順位はGitHubのWBSが正本です。ここでは独自の進捗数値を管理しません。</p>
              <a href={REPO + "/issues/132"} target="_blank" rel="noopener noreferrer">実装計画・優先順位 ↗</a>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">03 / VERIFICATION</span>
              <h3>試験・公開の確認</h3>
              <p>コードやCIの成功と、正式なシステムテスト・PreviewやProductionの配信確認は別です。</p>
              <a href={REPO + "/issues/694"} target="_blank" rel="noopener noreferrer">正式System Testの状況 ↗</a>
            </article>
          </div>
        </section>

        <section className="reference-section reference-boundary" id="reference-limits" aria-labelledby="reference-limits-title">
          <p className="reference-eyebrow">STATUS / RESPONSIBILITY</p>
          <h2 id="reference-limits-title">実装と、検証の証拠は別です。</h2>
          <p>Designed（設計済）・Implemented（コードあり）・CI Verified（自動テスト成功）・Preview Verified（実Preview確認）・Production Verified（実本番確認）は、それぞれ異なります。このページの参照情報はGitHubの既存成果に依拠し、現在の本番可用性は証明しません。</p>
          <p>実際のプロジェクトへの適用には、独自の要件定義・権限設計・試験・リリース承認が必要です。AI Agent、外部SaaS接続、Production Restoreがすべて実装済みであるとは扱いません。</p>
          <a href={REPO + "/issues/433"} target="_blank" rel="noopener noreferrer">Reference Siteの未完了条件を見る ↗</a>
        </section>
      </main>
      <footer className="reference-footer">
        <span>WORKHUB · Developer Reference / first slice</span>
        <div><a href="/showcase">Showcase</a><a href="/">WORKHUB</a><a href={REPO} target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
      </footer>
    </div>
  );
}
