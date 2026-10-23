import { useState } from "react";
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
  /** Canonical #433 v1 semantic ID; distinct from the local card anchor. */
  readonly stableId: string;
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
    stableId: "cap.business.workflow-approval",
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
    stableId: "cap.identity.authorization",
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
    stableId: "cap.operations.recovery-readiness",
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
    stableId: "cap.business.search",
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
    stableId: "cap.business.report-generation",
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
    stableId: "cap.business.data-import-export",
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


/** Existing publication domains; links point to real source documents, not new site pages. */
const REFERENCE_DOMAINS = [
  { category: "Start", title: "はじめに", summary: "目的・セットアップ・画面例を確認する", source: "README.md" },
  { category: "Architecture", title: "構造と責務", summary: "React / Worker / D1の境界を読む", source: "docs/FULLSTACK_ARCHITECTURE.md" },
  { category: "Business", title: "申請・承認", summary: "状態遷移と業務データの分離を読む", source: "docs/HUMAN_WORKFLOW_APPROVAL.md" },
  { category: "Platform", title: "共通基盤", summary: "Feature Flagと安全な判定を読む", source: "docs/FEATURE_FLAGS.md" },
  { category: "Security", title: "認証・認可", summary: "現在の権限で何を許可するか確認する", source: "docs/AUTHORIZATION_DESIGN.md" },
  { category: "Operations", title: "復旧と運用", summary: "BackupとRecoverabilityを区別する", source: "docs/RECOVERY_OPERATIONS.md" },
  { category: "Reference App", title: "WORKHUBの場面", summary: "既存18シナリオの案内と制限を確認する", source: "docs/reference/WORKHUB_SCENARIO_MAP.md" },
  { category: "Recipes", title: "実装の手順", summary: "既存の再利用Recipe索引から探す", source: "docs/recipes/README.md" },
  { category: "Decisions", title: "採用理由", summary: "Reference Siteの技術・Hosting判断を読む", source: "docs/reference/REFERENCE_SITE_TECHNOLOGY_DECISION.md" },
  { category: "Status", title: "実装と検証", summary: "CI・Preview・Productionの根拠を区別する", source: "docs/RUNTIME_EVIDENCE_STATUS.md" },
] as const;

/** #433 v1 task shortcuts are navigation only; canonical Recipes stay in GitHub. */
const QUICK_RECIPES = [
  {"id":"approval","stableId":"recipe.build.single-step-approval","task":"申請・承認を追加したい","summary":"業務データとWorkflowを分離した出張申請のReference例",source: "docs/recipes/REFERENCE_TRAVEL_REQUEST.md","demo":"#reference-workflow","status":"実装例とBrowserテストあり（要ログイン）"},
  {"id":"file","stableId":"recipe.build.private-file-upload","task":"添付ファイルを安全に扱いたい","summary":"Upload / Downloadの権限・サイズ制限・保存先との境界",source: "docs/recipes/FILE_TRANSFER_HTTP.md","status":"設計Recipe。公開操作デモはありません"},
  {"id":"csv","stableId":"recipe.build.csv-dry-run-import","task":"CSVを検証して取り込みたい","summary":"検証・ドライランと本登録、権限付きエクスポート",source: "docs/recipes/DATA_IMPORT_EXPORT.md","status":"共通基盤のテストあり。公開操作デモはありません"},
  {"id":"batch","stableId":"recipe.build.async-job","task":"時間のかかる処理を非同期化したい","summary":"冪等性・失敗・再試行を持つAsync Jobの導入手順",source: "docs/recipes/ASYNC_JOB.md","status":"基盤Recipe。実運用Queueの動作を保証しません"},
  {"id":"retry","stableId":"recipe.operate.retry-failed-job","task":"失敗した処理を安全に再試行したい","summary":"期限付きleaseや状態遷移で二重処理を防ぐ設計",source: "docs/ASYNC_JOB.md","status":"基盤設計。Productionでの再試行は別のHuman Gate"},
  {"id":"auth","stableId":"recipe.secure.resource-authorization","task":"業務データを権限で守りたい","summary":"Server側のResource Scope / Role Policy / deny-by-default",source: "docs/recipes/AUTHORIZATION_BOUNDARY.md","status":"設計Recipeと代表的な権限付き業務例"},
] as const;

/** #433 Frozen 18-recipe candidate inventory minus the six Quick Recipes above.
 * An existing design pointer is not automatically an executable Recipe. */
const ADDITIONAL_RECIPES = [
  { stableId: "recipe.build.master-data", task: "マスタデータを追加したい", status: "関連設計のみ／専用Recipe未レビュー", source: "docs/MASTER_DATA.md" },
  { stableId: "recipe.build.activity-timeline", task: "業務履歴をTimelineへ残したい", status: "関連設計のみ／専用Recipe未整備", source: "docs/INTEGRATION_EVENT_OUTBOX.md" },
  { stableId: "recipe.build.transactional-notification", task: "業務通知を組み込みたい", status: "関連設計のみ／専用Recipe未整備", source: "docs/INTEGRATION_EVENT_OUTBOX.md" },
  { stableId: "recipe.build.pdf-report", task: "正式なPDF帳票を作成したい", status: "関連設計のみ／専用Recipe未レビュー", source: "docs/REPORT_GENERATION.md" },
  { stableId: "recipe.build.searchable-resource", task: "権限付き検索対象を追加したい", status: "関連設計のみ／専用Recipe未レビュー", source: "docs/search-foundation.md" },
  { stableId: "recipe.build.outbox-event", task: "Outboxから外部連携したい", status: "既存Recipeあり／本番配信は別検証", source: "docs/recipes/INTEGRATION_EVENT_OUTBOX_RECIPE.md" },
  { stableId: "recipe.secure.durable-audit", task: "監査証跡を永続化したい", status: "既存Recipeあり／実運用は別検証", source: "docs/recipes/DURABLE_AUDIT_STORAGE.md" },
  { stableId: "recipe.secure.authorized-search-rag", task: "AI/RAGでも同じ認可を守りたい", status: "関連設計のみ／AI連携の実装例ではない", source: "docs/search-foundation.md" },
  { stableId: "recipe.operate.reconcile-unknown-delivery", task: "外部連携の配信結果不明を照合したい", status: "関連設計のみ／運用Recipe未整備", source: "docs/INTEGRATION_EVENT_OUTBOX.md" },
  { stableId: "recipe.recover.verify-recovery-readiness", task: "復旧準備を安全に検証したい", status: "既存Preview手順あり／Remote操作は別承認", source: "docs/recipes/PREVIEW_RECOVERY_REHEARSAL.md" },
  { stableId: "recipe.agent.expose-read-capability", task: "Agentへ読取能力を提供したい", status: "Future／実装と公開Recipe未提供", source: null },
  { stableId: "recipe.agent.human-confirmed-action", task: "Agent操作を人が確認したい", status: "Future／実装と公開Recipe未提供", source: null },
] as const;

/** Existing design references, not newly published formal ADR pages. */
const DESIGN_DECISIONS = [
  {"stableId":"adr.domain-workflow-separation","title":"業務データと承認の状態は別",source: "docs/HUMAN_WORKFLOW_APPROVAL.md","reason":"業務の正本と承認作業の正本を混ぜない"},
  {"stableId":"adr.search-rag-shared-authorization","title":"検索結果は権限の正本ではない",source: "docs/search-foundation.md","reason":"現在の本人権限をサーバー側で判定し直す"},
  {"stableId":"adr.outbox-at-least-once","title":"外部連携はOutboxでつなぐ",source: "docs/recipes/INTEGRATION_EVENT_OUTBOX_RECIPE.md","reason":"業務更新と配信成功を同じことにしない"},
  {"stableId":"adr.provider-neutral-core","title":"Coreと外部Adapterの境界",source: "docs/FULLSTACK_ARCHITECTURE.md","reason":"Provider固有実装を業務Coreの契約に埋め込まない"},
  {"stableId":"adr.backup-is-not-recoverability","title":"Backup成功は復旧可能性の証拠ではない",source: "docs/RECOVERY_OPERATIONS.md","reason":"Restore後の検証と安全な再開判断を分ける"},
  {"stableId":"adr.production-human-gate","title":"本番への変更は人が承認する",source: "docs/recipes/PRODUCTION_PREFLIGHT.md","reason":"CI成功とProduction操作許可を同一視しない"},
  {"stableId":"adr.reuse-before-custom","title":"標準・既存部品を自作より優先する",source: "docs/UPSTREAM_TEMPLATE.md","reason":"実装の重複と責任の二重化を避ける"},
  {"stableId":"adr.work-notification-timeline-audit-separation","title":"Work・通知・Timeline・Auditを分ける",source: "docs/INTEGRATION_EVENT_OUTBOX.md","reason":"誰の作業か／知らせるか／履歴か／証跡かは役割が違う"},
  {"stableId":"adr.derived-state-not-authority","title":"Projectionを業務の正本にしない",source: "docs/search-foundation.md","reason":"検索候補・投影の内容より最新Resourceと認可を優先する"},
  {"stableId":"adr.report-artifact-vs-screen-print","title":"正式帳票は画面印刷と分ける",source: "docs/REPORT_GENERATION.md","reason":"永続的な出力物はVersion・Source Snapshotを持つ"},
  {"stableId":"adr.controlled-operations-plane","title":"運用操作を制御された手順に限定する",source: "docs/operations-core.md","reason":"無制限なDB編集ではなくRisk・承認・Verify・Auditを通す"},
  {"stableId":"adr.human-service-agent-shared-boundary","title":"人・Service・Agentの操作境界を共通化する",source: "docs/operations-core.md","reason":"AI Agentの制御操作もHuman Gateを回避させない"},
] as const;

/** #433 verified showcase-tour relationships; not the full WORKHUB scenario inventory. */
const SCENARIOS = [
  {
    id: "return",
    stableId: "scenario.workhub.travel-approval",
    title: "申請の差戻しと再申請",
    summary: "社員の申請を上長が差し戻し、修正して再提出する。Workflow・認可・通知のつながりを確認する。",
    capability: "WORKFLOW / AUTHORIZATION",
    source: "src/reference/workhub/travel-request/service.ts",
    test: "e2e/tests/workhub-travel-request.spec.ts",
  },
  {
    id: "expense",
    stableId: "scenario.workhub.travel-expense",
    title: "出張承認から経費精算へ",
    summary: "出張承認と経費精算は別の業務。経理担当による確認まで、WORKHUBの案内と実装をたどる。",
    capability: "TRAVEL / EXPENSE",
    source: "src/reference/workhub/expenses.ts",
    test: "e2e/tests/workhub-expenses.spec.ts",
  },
  {
    id: "search",
    stableId: "scenario.workhub.enterprise-search",
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
  const [searchInput, setSearchInput] = useState("");
  const query = searchInput.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
  const matches = (...values: string[]) => query.length === 0 ||
    values.join(" ").normalize("NFKC").toLocaleLowerCase("ja-JP").includes(query);
  const domains = REFERENCE_DOMAINS.filter(item => matches(item.category, item.title, item.summary, item.source));
  const capabilities = CAPABILITIES.filter(item => matches(item.title, item.domain, item.purpose, item.recipe, item.code, item.limitation));
  const recipes = QUICK_RECIPES.filter(item => matches(item.task, item.summary, item.status, item.source));
  const additionalRecipes = ADDITIONAL_RECIPES.filter(item => matches(item.task, item.status, item.stableId, item.source ?? ""));
  const decisions = DESIGN_DECISIONS.filter(item => matches(item.title, item.reason, item.source));
  const scenarios = SCENARIOS.filter(item => matches(item.title, item.capability, item.summary, item.source));
  const total = domains.length + capabilities.length + recipes.length + additionalRecipes.length + decisions.length + scenarios.length;
  // A read-only projection from the six existing curated card descriptors,
  // NOT evidence that the current main SHA is Preview/Production verified.
  const implementedCount = CAPABILITIES.filter((item) => item.implementation.startsWith("IMPLEMENTED")).length;
  const simulatedCount = CAPABILITIES.filter((item) => item.implementation.startsWith("REFERENCE DEMO")).length;
  const recordedCiCount = CAPABILITIES.filter((item) => item.verification.startsWith("CI VERIFIED")).length;

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
          <a href="#reference-hero-s01">S01 出張申請</a>
          <a href="#reference-domains">分野別に探す</a>
          <a href="#reference-capabilities">実装例を探す</a>
          <a href="#reference-recipes">作り方・設計判断</a>
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
            <a className="reference-secondary" href="/">WORKHUBを開く（ログインが必要） →</a>
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

        <section id="reference-hero-s01" className="reference-section" aria-labelledby="reference-hero-s01-title">
          <p className="reference-eyebrow">HERO SCENARIO S01 / 出張申請</p>
          <h2 id="reference-hero-s01-title">差戻し・再申請・承認を、動く例から設計までたどる</h2>
          <p className="reference-section-lead">既存S01 <code>scenario.workhub.travel-approval</code> の案内です。公開Showcaseは読取専用の操作ガイドで、認証後WORKHUBの申請成功やPreview/Production検証の証拠ではありません。アプリ固有の出張申請と再利用可能なWorkflowを混同しません。</p>
          <div className="reference-entry-grid">
            <article className="reference-entry">
              <span className="reference-entry-number">01 / 公開ガイド</span>
              <h3>申請から差戻し・再申請へ</h3>
              <p>利用者と承認者のやり取りを、既存ショーケースのS01に対応する案内で確認します。ガイド表示は実際の操作実行ではありません。</p>
              <a href="/showcase?scenario=return#showcase-tour">S01のツアーを見る →</a>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">02 / 再利用Recipe</span>
              <h3>何を業務固有に残すか</h3>
              <p>TravelRequestとWorkflow Instanceの正本を分け、差戻し後の再申請に必要な状態・権限の扱いを追います。</p>
              <ExternalEvidence path="docs/recipes/REFERENCE_TRAVEL_REQUEST.md">出張申請Recipe</ExternalEvidence>
              <p><ExternalEvidence path="docs/HUMAN_WORKFLOW_APPROVAL.md">承認の設計判断</ExternalEvidence></p>
            </article>
            <article className="reference-entry">
              <span className="reference-entry-number">03 / Source + Evidence</span>
              <h3>コードとテストで確かめる</h3>
              <p>具体的な実装とBrowser E2Eを確認します。CIの成功と現在の公開環境での動作は別の検証です。</p>
              <ExternalEvidence path="src/reference/workhub/travel-request/service.ts">実装Source</ExternalEvidence>
              <p><ExternalEvidence path="e2e/tests/workhub-travel-request.spec.ts">Browser E2E根拠</ExternalEvidence></p>
            </article>
          </div>
          <p className="reference-section-lead"><ExternalEvidence path="docs/reference/WORKHUB_SCENARIO_MAP.md">S01を含む既存18シナリオの掲載範囲・制約を見る</ExternalEvidence></p>
        </section>

        <section id="reference-principles" className="reference-section" aria-labelledby="reference-principles-title">
          <p className="reference-eyebrow">WHY THIS TEMPLATE / 6 CORE PRINCIPLES</p>
          <h2 id="reference-principles-title">このTemplateで繰り返し守る6つの考え方</h2>
          <p className="reference-section-lead">新機能の完成宣言ではなく、既存の初版設計方針です。採用するときの責任境界として読む項目を示します。</p>
          <div className="reference-entry-grid">
            <article className="reference-entry"><span className="reference-entry-number">01 / SOURCE OF TRUTH</span><h3>正本はサーバー側</h3><p>画面表示や検索結果を業務データ・権限の正本にしない。</p></article>
            <article className="reference-entry"><span className="reference-entry-number">02 / SAFE BY DEFAULT</span><h3>迷った操作は安全側に止める</h3><p>失敗・競合・権限不明を成功とみなさない。</p></article>
            <article className="reference-entry"><span className="reference-entry-number">03 / PROVIDER NEUTRAL</span><h3>Coreに接続先固有の事情を持ち込まない</h3><p>業務の責務と外部Adapterの責務を分ける。</p></article>
            <article className="reference-entry"><span className="reference-entry-number">04 / OPERATIONS</span><h3>運用・復旧も設計のうち</h3><p>作ることと、安全に運用・復旧できることを分けて検証する。</p></article>
            <article className="reference-entry"><span className="reference-entry-number">05 / AGENT BOUNDARY</span><h3>Agentも同じアプリ境界を通す</h3><p>AI/Agent Readyは設計方針。未実装のAgent操作を公開デモとして扱わない。</p></article>
            <article className="reference-entry"><span className="reference-entry-number">06 / REUSE FIRST</span><h3>標準と再利用を自作より先に考える</h3><p>同じ仕組みを増やす前に既存部品・規格・Recipeを確認する。</p></article>
          </div>
          <p className="reference-section-lead"><ExternalEvidence path="docs/FULLSTACK_ARCHITECTURE.md">現在のArchitecture境界を読む</ExternalEvidence></p>
        </section>

        <section className="reference-section" aria-label="Reference横断検索">
          <div className="reference-search" role="search">
            <label htmlFor="reference-search-input">掲載済みの機能・業務シナリオ・Recipe・設計判断を探す</label>
            <input id="reference-search-input" type="search" value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="例：承認、CSV、Outbox、復旧" />
            <p className="reference-search-count" role="status" aria-live="polite">
              {total}件一致（分野{domains.length}・Capability{capabilities.length}・Recipe{recipes.length + additionalRecipes.length}・設計判断{decisions.length}・シナリオ{scenarios.length}）
            </p>
            {total === 0 && <p className="reference-empty">掲載範囲に一致する資料はありません。検索語を変えるか、GitHubの資料一覧をご確認ください。</p>}
          </div>
        </section>

        <section id="reference-domains" className="reference-section" aria-labelledby="reference-domains-title">
          <p className="reference-eyebrow">FIND THE RIGHT REFERENCE / 既存設計資料</p>
          <h2 id="reference-domains-title">目的の分野から、設計の根拠へ進む</h2>
          <p className="reference-section-lead">初版の10分野を、既存の公開GitHub資料へ案内します。各リンクはReference Site内の新規ページや、その分野の全機能が実装済みという意味ではありません。</p>
          <div className="reference-entry-grid">
            {domains.map((item) => (
              <article className="reference-entry" key={item.category}>
                <span className="reference-entry-number">{item.category}</span>
                <h3>{item.title}</h3>
                <p>{item.summary}</p>
                <ExternalEvidence path={item.source}>設計・根拠を読む</ExternalEvidence>
              </article>
            ))}
          </div>
          <p className="reference-section-lead"><ExternalEvidence path="docs/reference/CAPABILITY_SECTION_MAP.md">既存86候補のReference section対応表（公開6カードと台帳のみを区別）</ExternalEvidence></p>
        </section>

        <section id="reference-capabilities" className="reference-section" aria-labelledby="reference-cap-title">
          <p className="reference-eyebrow">CAPABILITY / RECIPE / EVIDENCE</p>
          <h2 id="reference-cap-title">代表的な6つの実装・設計パターン</h2>
          <p className="reference-section-lead">既存の実装から代表例を選んで紹介しています。ここに掲載した6件は全Capabilityの棚卸し完了を意味しません。</p>
          <div className="reference-capability-grid">
            {capabilities.map((item) => (
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

        <section id="reference-recipes" className="reference-section" aria-labelledby="reference-recipes-title">
          <p className="reference-eyebrow">QUICK RECIPES / DESIGN RATIONALE</p>
          <h2 id="reference-recipes-title">業務で使いたい6つのパターンから探す</h2>
          <p className="reference-section-lead">手順の新しいコピーは作らず、既存Recipeや設計の正本へ案内します。実装例・基盤設計・公開デモの有無を区別しています。</p>
          <div className="reference-entry-grid">
            {recipes.map((item) => (
              <article className="reference-entry" key={item.id}>
                <span className="reference-entry-number">{item.status}</span>
                <h3>{item.task}</h3>
                <p>{item.summary}</p>
                <ExternalEvidence path={item.source}>作り方・注意点を読む</ExternalEvidence>
                {item.id === "approval" && <p><a href={item.demo}>実装例・Source・Testを見る →</a></p>}
              </article>
            ))}
          </div>
          <div className="reference-catalog" aria-label="追加の初版Recipe候補12件">
            <h3>初版目標18件のうち、代表6件以外の12件</h3>
            <p className="reference-section-lead">「既存Recipeあり」「関連設計のみ」「Future」を区別しています。既存の設計文書は実装用の完結したRecipeとは限りません。Agentの2件は将来候補であり、操作デモ・コピー可能な手順を提供しません。</p>
            <ul className="reference-catalog-list">
              {additionalRecipes.map((item) => (
                <li key={item.stableId}>
                  <strong>{item.task}</strong> — {item.status}
                  {item.source
                    ? <>：<ExternalEvidence path={item.source}>既存資料を確認</ExternalEvidence></>
                    : <>：<a href={REPO + "/issues/433"} target="_blank" rel="noopener noreferrer">未公開範囲を確認 ↗</a></>}
                </li>
              ))}
              {additionalRecipes.length === 0 && <li className="reference-empty">追加Recipe候補に一致する項目はありません。</li>}
            </ul>
          </div>
          <div className="reference-entry">
            <p className="reference-eyebrow">WHY THESE BOUNDARIES</p>
            <h3>「なぜその設計か」を主要12件の判断からたどる</h3>
            <p>初版の主要12決定を、関連する既存設計・Recipeへ案内します。これは個別に採択・公開された正式ADR 12本を意味しません。根拠資料の個別レビューは引き続き必要です。</p>
            <ul>
              {decisions.map((item) => (
                <li key={item.title}>
                  <ExternalEvidence path={item.source}>{item.title}</ExternalEvidence>
                  <span> — {item.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="reference-scenarios" className="reference-section" aria-labelledby="reference-scenarios-title">
          <p className="reference-eyebrow">WORKHUB / GUIDED SCENARIOS</p>
          <h2 id="reference-scenarios-title">業務の場面から、実装までたどる</h2>
          <p className="reference-section-lead">既存ショーケースの該当ステップへ直接移動します。ツアーは操作手順の案内であり、ログインが必要な実操作やPreview検証の完了を保証しません。ここにある3件は全シナリオの対応付けではありません。</p>
          <div className="reference-entry-grid">
            {scenarios.map((scenario) => (
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
          <p className="reference-section-lead"><ExternalEvidence path="docs/reference/WORKHUB_SCENARIO_MAP.md">既存18シナリオの対応表（公開案内・模擬・構想を区別）</ExternalEvidence></p>
        </section>

        <section id="reference-status" className="reference-section" aria-labelledby="reference-status-title">
          <p className="reference-eyebrow">ROADMAP / STATUS / EVIDENCE</p>
          <h2 id="reference-status-title">開発状況はGitHubの正本で確認する</h2>
          <p className="reference-section-lead">この画面で見られる範囲と、まだ確認が必要な条件を分けて案内します。下のリンクはGitHubの元受入・全体WBS・正式System Testの正本です。CIの成功は公開環境での動作確認とは別です。進捗率や公開状態は固定表示せず、最新のGitHub記録を参照してください。</p>
          <article className="reference-entry" aria-label="公開代表Capabilityの状態スナップショット">
            <p className="reference-eyebrow">CURATED CAPABILITY STATUS / PUBLIC SCOPE ONLY</p>
            <h3>掲載中の代表{CAPABILITIES.length}件だけを分類して確認する</h3>
            <dl className="reference-evidence-status">
              <div><dt>実装例</dt><dd>{implementedCount}件（既存Capabilityの実装表示による分類）</dd></div>
              <div><dt>模擬例</dt><dd>{simulatedCount}件（架空デモ。実復旧・本番保証ではありません）</dd></div>
              <div><dt>CIの記載</dt><dd>{recordedCiCount}件（各カードの既存テスト説明。最新main SHAの検証判定ではありません）</dd></div>
              <div><dt>Preview / Production</dt><dd>この掲載情報だけでは確認できません（Not Verified ≠ Failed）</dd></div>
            </dl>
            <p>採用区分（Core / Standard / Optional / Future）と成熟度（Designed / Implemented / Stable）は別軸です。掲載6件に個別のAdoptionやStableを推定せず、各カードの実装・検証・制約とGitHubの根拠を確認してください。CI Verified ≠ Preview Verified ≠ Production Verified。Designは利用可能の保証ではありません。</p>
            <p><ExternalEvidence path="docs/RUNTIME_EVIDENCE_STATUS.md">Revisionに結び付くRuntime Evidenceの判定方法</ExternalEvidence></p>
            <p><a href="#reference-capabilities">代表6件の個別Source / Testを見る →</a></p>
          </article>
          <div className="reference-entry-grid">
            <article className="reference-entry">
              <span className="reference-entry-number">01 / REFERENCE</span>
              <h3>この画面の実装範囲</h3>
              <p>既存の6つの代表Capabilityと3つの業務シナリオを紹介しています。Reference Site全体の完成を意味しません。元受入14条件の完了数・未完了条件はIssue本文を確認してください。判定コメントとチェック欄に差がある場合、チェック欄を正本とします。</p>
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
              <p>コードやCIの成功と、正式なシステムテスト・PreviewやProductionの配信確認は別です。未実施の試験や未承認のデプロイを完了と扱いません。</p>
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
