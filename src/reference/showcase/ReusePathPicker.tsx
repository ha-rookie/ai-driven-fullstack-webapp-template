import { useState } from "react";
import "./reuse-path-picker.css";

/** Public, read-only navigation. Links target reviewed repository files, not runtime controls. */
const REPO = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template";
const file = (path: string) => REPO + "/blob/main/" + path;

const reuseRoutes = [
  {
    key: "workflow",
    button: "申請・承認を作る",
    hint: "Workflow / Validation",
    title: "申請・承認の仕組みを持ち帰る",
    outcome: "作りたいもの：承認付きの業務申請",
    reason: "業務データ・承認状態・通知を混同せず、二重送信や途中失敗をどう扱うか確認する。",
    caution: "これは架空の出張申請です。業務固有の権限・承認ルール・状態遷移は導入先で再設計してください。",
    links: [
      { label: "1. Recipeを読む", desc: "設計と失敗時の扱い", href: file("docs/recipes/REFERENCE_TRAVEL_REQUEST.md") },
      { label: "2. 実装を読む", desc: "出張申請Service", href: file("src/reference/workhub/travel-request/service.ts") },
      { label: "3. 検証を見る", desc: "出張申請Browser E2E", href: file("e2e/tests/workhub-travel-request.spec.ts") },
    ],
  },
  {
    key: "authorization",
    button: "権限制御を組み込む",
    hint: "AuthZ / Resource Scope",
    title: "「画面で隠す」以上の権限制御を持ち帰る",
    outcome: "作りたいもの：ユーザー・所属・対象データを考慮する認可",
    reason: "現在の所属と対象Scopeをサーバーで照合し、権限不足を拒否する位置を確認する。",
    caution: "Recipeは汎用的な設計例です。RoleやScope、認可ポリシーをそのまま別案件へコピーしないでください。",
    links: [
      { label: "1. Recipeを読む", desc: "認可境界のチェック項目", href: file("docs/recipes/AUTHORIZATION_BOUNDARY.md") },
      { label: "2. 実装を読む", desc: "Server側の認可判定", href: file("src/worker/authorization/policy.ts") },
      { label: "3. 検証方針を読む", desc: "401/403・拒否後の整合性", href: file("docs/BOUNDARY_TESTING.md") },
    ],
  },
  {
    key: "operations",
    button: "障害・運用を考える",
    hint: "Outbox / Administration",
    title: "失敗・再試行待ちを見失わない仕組みを持ち帰る",
    outcome: "作りたいもの：非同期処理と運用者が確認できる状態",
    reason: "外部連携の状態をどう保持し、運用者に何を見せるかを分離して考える。",
    caution: "現時点の管理画面は参照中心です。外部SaaSの受領実照合や自由な再送機能が完成しているという意味ではありません。",
    links: [
      { label: "1. Recipeを読む", desc: "Integration Event / Outbox", href: file("docs/recipes/INTEGRATION_EVENT_OUTBOX_RECIPE.md") },
      { label: "2. 実装を読む", desc: "Outbox参照API", href: file("src/worker/administration/integration-operations-api.ts") },
      { label: "3. 関連E2Eを見る", desc: "管理Overviewの表示検証", href: file("e2e/tests/workhub-operations-overview.spec.ts") },
    ],
  },
] as const;

type ReuseKey = (typeof reuseRoutes)[number]["key"];

export default function ReusePathPicker() {
  const [selected, setSelected] = useState<ReuseKey>("workflow");
  const route = reuseRoutes.find((item) => item.key === selected) ?? reuseRoutes[0];

  return <section className="showcase-reuse" id="showcase-reuse" aria-labelledby="showcase-reuse-title">
    <div className="showcase-reuse-head">
      <p className="showcase-label">REUSE / PICK YOUR PURPOSE</p>
      <h2 id="showcase-reuse-title">全部ではなく、<span>欲しい部分から。</span></h2>
      <p>自分の案件で必要なものを選ぶと、Recipe → 実装 → 検証の順に確認できます。導入やforkは必須ではありません。</p>
    </div>
    <div className="showcase-reuse-picker" role="group" aria-label="持ち帰りたいテーマを選ぶ">
      {reuseRoutes.map((item) => <button key={item.key} type="button"
        className={selected === item.key ? "is-selected" : ""}
        aria-pressed={selected === item.key}
        onClick={() => setSelected(item.key)}>
        <strong>{item.button}</strong>
        <small>{item.hint}</small>
      </button>)}
    </div>
    <article className="showcase-reuse-detail" role="region" aria-label="選択した再利用テーマ" aria-live="polite">
      <div className="showcase-reuse-description">
        <p className="showcase-reuse-outcome">{route.outcome}</p>
        <h3>{route.title}</h3>
        <p>{route.reason}</p>
        <p className="showcase-reuse-caution">{route.caution}</p>
      </div>
      <div className="showcase-reuse-links">
        {route.links.map((link) => <a key={link.href} href={link.href}
          target="_blank" rel="noopener noreferrer">
          <strong>{link.label} <span aria-hidden="true">↗</span></strong>
          <small>{link.desc}</small>
        </a>)}
      </div>
    </article>
    <p className="showcase-reuse-note">この画面は公開資料の案内のみです。選択しても認証API・DB・業務データへアクセスしません。</p>
  </section>;
}
