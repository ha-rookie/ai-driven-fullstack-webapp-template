import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../frontend/auth";
import "./admin-portal.css";

const ADMIN_USER_ID = "workhub-demo-kai";
const WORKHUB_SCOPE_ID = "workhub-company";

const sections = [
  ["Overview", "運用状況", "管理対象と運用状態を俯瞰します"],
  ["Users & Access", "ユーザー・権限", "Membership / Role / Session の管理入口"],
  ["Business Operations", "業務運用", "業務データの安全な運用入口"],
  ["Jobs & Integrations", "ジョブ・連携", "Batch / Integration の状態確認"],
  ["Audit & Security", "監査・セキュリティ", "Audit / Security Event の確認入口"],
  ["System", "システム", "環境・構成・保守情報の確認入口"],
] as const;

interface AuditItem {
  readonly id: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly category: string;
  readonly action: string;
  readonly outcome: "success" | "failure";
  readonly actorId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
}

interface AuditResponse {
  readonly items: readonly AuditItem[];
  readonly nextCursor: string | null;
}

const StateCard = ({ title, children }: { readonly title: string; readonly children: ReactNode }) => (
  <article className="admin-state-card"><strong>{title}</strong><div>{children}</div></article>
);

const AuditViewer = () => {
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [state, setState] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly data: AuditResponse }
    | { readonly kind: "error"; readonly requestId: string | null }
  >({ kind: "loading" });

  const load = async () => {
    setState({ kind: "loading" });
    const params = new URLSearchParams({
      scopeId: WORKHUB_SCOPE_ID,
      limit: "20",
    });
    if (category) params.set("category", category);
    if (outcome) params.set("outcome", outcome);

    try {
      const response = await fetch(`/api/admin/audit?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      const requestId = response.headers.get("x-request-id");
      if (!response.ok) {
        setState({ kind: "error", requestId });
        return;
      }
      const data = await response.json() as AuditResponse;
      setState({ kind: "ready", data });
    } catch {
      setState({ kind: "error", requestId: null });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return <section className="admin-audit-panel" id="admin-audit-and-security" aria-labelledby="admin-audit-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">AUDIT & SECURITY</p>
        <h2 id="admin-audit-title">監査ログ</h2>
        <p>DBを直接開かず、許可された条件だけで監査記録を確認します。環境・Scope・件数上限はAPI側でも固定します。</p>
      </div>
      <div className="admin-audit-scope"><span>Scope</span><strong>{WORKHUB_SCOPE_ID}</strong></div>
    </div>

    <form className="admin-audit-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>Category
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">すべて</option>
          <option value="authentication">authentication</option>
          <option value="authorization">authorization</option>
          <option value="mutation">mutation</option>
          <option value="system">system</option>
        </select>
      </label>
      <label>Outcome
        <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="">すべて</option>
          <option value="success">success</option>
          <option value="failure">failure</option>
        </select>
      </label>
      <button type="submit" disabled={state.kind === "loading"}>絞り込む</button>
    </form>

    {state.kind === "loading" && <div className="admin-audit-state" role="status">監査ログを取得しています…</div>}
    {state.kind === "error" && <div className="admin-audit-state is-error" role="alert">
      <strong>監査ログを取得できませんでした</strong>
      <span>{state.requestId ? `Request ID: ${state.requestId}` : "再試行してください"}</span>
    </div>}
    {state.kind === "ready" && state.data.items.length === 0 && <div className="admin-audit-state">条件に一致する監査ログはありません</div>}
    {state.kind === "ready" && state.data.items.length > 0 && <div className="admin-audit-table-wrap">
      <table className="admin-audit-table">
        <thead><tr><th>時刻</th><th>結果</th><th>Category / Action</th><th>Actor</th><th>Resource</th><th>Request ID</th></tr></thead>
        <tbody>{state.data.items.map((item) => <tr key={item.id}>
          <td>{new Date(item.timestamp).toLocaleString("ja-JP")}</td>
          <td><span className={`admin-audit-outcome is-${item.outcome}`}>{item.outcome}</span></td>
          <td><strong>{item.category}</strong><small>{item.action}</small></td>
          <td>{item.actorId ?? "—"}</td>
          <td>{item.resourceType ? `${item.resourceType}${item.resourceId ? ` / ${item.resourceId}` : ""}` : "—"}</td>
          <td><code>{item.requestId}</code></td>
        </tr>)}</tbody>
      </table>
    </div>}
    {state.kind === "ready" && state.data.nextCursor && <p className="admin-audit-note">続きがあります。次ページ操作は後続のUI改善で接続します。</p>}
  </section>;
};

export default function AdminPortal() {
  const auth = useAuth();
  const environment = import.meta.env.MODE === "production" ? "PRODUCTION" : "PREVIEW / LOCAL";
  const authorized = auth.status === "authenticated" && auth.user?.id === ADMIN_USER_ID;

  if (!authorized) {
    return <main className="admin-gate"><p className="admin-eyebrow">ADMINISTRATION</p><h1>この領域を表示する権限がありません</h1><p>管理機能の表示制御は利便性のためのものです。実際の操作はAPI側で再認証・再認可されます。</p><a href="/">WORKHUBへ戻る</a></main>;
  }

  return <div className="admin-shell">
    <header className="admin-header">
      <a className="admin-brand" href="/"><span>CECIL WORKS</span><strong>Operations Portal</strong></a>
      <div className="admin-header-context"><span className="admin-environment">{environment}</span><span>{auth.user?.displayName ?? "System Admin"}</span></div>
    </header>
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="管理ポータル">
        {sections.map(([key, label], index) => <a key={key} href={index === 0 ? "#admin-overview" : `#admin-${key.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`} className={index === 0 ? "is-active" : undefined}>{label}<small>{key}</small></a>)}
        <div className="admin-nav-spacer" />
        <a href="/">← WORKHUB</a>
      </nav>
      <main className="admin-main" id="admin-overview">
        <section className="admin-intro">
          <div><p className="admin-eyebrow">OPERATIONS / ADMINISTRATION</p><h1>管理できている状態を、ひとつの入口から</h1><p>何でも直接変更できる画面ではなく、状態を確認し、安全な運用操作へ進むためのPortal Foundationです。</p></div>
          <div className="admin-context-card"><span>Environment</span><strong>{environment}</strong><small>環境を常に明示し、誤操作を減らします</small></div>
        </section>
        <section className="admin-grid" aria-label="管理領域">
          {sections.slice(1).map(([key, label, description]) => <article id={`admin-${key.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`} className="admin-section-card" key={key}><span className="admin-section-key">{key}</span><h2>{label}</h2><p>{description}</p>{key === "Audit & Security" ? <a className="admin-section-link" href="#admin-audit-and-security">監査ログを見る</a> : <button type="button" disabled>後続Issueで接続</button>}</article>)}
        </section>
        <AuditViewer />
        <section className="admin-foundation" aria-labelledby="admin-foundation-title">
          <div><p className="admin-eyebrow">SAFE OPERATION FOUNDATION</p><h2 id="admin-foundation-title">危険な操作ほど、理由と確認を残す</h2><p>UIで隠すだけでは認可しません。MutationはServer-side Authorization / CSRF / Audit / Operations Guardを通す前提です。</p></div>
          <form className="admin-action-demo" onSubmit={(event) => event.preventDefault()}>
            <label>操作理由<textarea placeholder="例：障害復旧のため、失敗したジョブを再実行" /></label>
            <label className="admin-confirm"><input type="checkbox" />対象・環境・影響範囲を確認しました</label>
            <button type="submit" disabled>安全操作の接続点</button>
          </form>
        </section>
        <section className="admin-states" aria-label="共通状態">
          <StateCard title="Loading"><span className="admin-skeleton" aria-hidden="true" />取得中は操作を出しません</StateCard>
          <StateCard title="Empty">対象がないことを正常状態として明示</StateCard>
          <StateCard title="Unauthorized">権限不足と障害を混同しません</StateCard>
          <StateCard title="Error">Request IDと再試行導線を置ける共通領域</StateCard>
        </section>
      </main>
    </div>
  </div>;
}
