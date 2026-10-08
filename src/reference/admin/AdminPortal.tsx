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

interface JobItem {
  readonly jobId: string;
  readonly type: string;
  readonly state: string;
  readonly attempt: number;
  readonly updatedAt: string;
  readonly progress: { readonly percent: number; readonly code: string | null } | null;
  readonly failureCode: string | null;
  readonly retry: { readonly available: boolean; readonly reason: string };
}

interface JobResponse {
  readonly items: readonly JobItem[];
  readonly limit: number;
}

interface CorrectionProjection {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly version: number;
  readonly state: Readonly<Record<string, string | number | boolean | null>>;
}

interface CorrectionPreviewResponse {
  readonly correctionPreview: {
    readonly available: boolean;
    readonly before?: CorrectionProjection;
    readonly reasonCode?: string;
  };
  readonly preview: {
    readonly policyDecision: string;
    readonly risk: string;
  };
  readonly policyVersion: string;
}

interface CorrectionExecuteResponse {
  readonly execution: { readonly result: string };
  readonly verification: { readonly status: string; readonly summary?: string };
  readonly correction: {
    readonly result: string;
    readonly before?: CorrectionProjection;
    readonly after?: CorrectionProjection;
    readonly reasonCode?: string;
  } | null;
}

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

const DATA_CORRECTION_COMMAND = "RESTORE_SOFT_DELETED_RESOURCE";
const DATA_CORRECTION_RESOURCE_ID = "workhub-demo-deleted-resource";
const DATA_CORRECTION_EXPECTED_VERSION = 2;

const DataCorrectionViewer = () => {
  const [preview, setPreview] = useState<CorrectionPreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<CorrectionExecuteResponse | null>(null);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        scopeId: WORKHUB_SCOPE_ID,
        resourceId: DATA_CORRECTION_RESOURCE_ID,
        expectedVersion: String(DATA_CORRECTION_EXPECTED_VERSION),
      });
      const response = await fetch(
        `/api/admin/data-corrections/${DATA_CORRECTION_COMMAND}/preview?${params.toString()}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        setStatus(`補正Previewを取得できませんでした (HTTP ${response.status})`);
        return;
      }
      setPreview(await response.json() as CorrectionPreviewResponse);
    } catch {
      setStatus("補正Previewの取得で通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const executeCorrection = async () => {
    if (!preview) return;
    setStatus("補正を実行しています…");
    try {
      const csrfResponse = await fetch("/api/auth/csrf", { headers: { accept: "application/json" } });
      if (!csrfResponse.ok) {
        setStatus("CSRF tokenを取得できませんでした");
        return;
      }
      const { csrfToken } = await csrfResponse.json() as { readonly csrfToken: string };
      const params = new URLSearchParams({
        scopeId: WORKHUB_SCOPE_ID,
        resourceId: DATA_CORRECTION_RESOURCE_ID,
      });
      const response = await fetch(
        `/api/admin/data-corrections/${DATA_CORRECTION_COMMAND}/execute?${params.toString()}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "idempotency-key": `workhub-correction-${crypto.randomUUID()}`,
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            expectedVersion: DATA_CORRECTION_EXPECTED_VERSION,
            reason,
            confirmed,
            previewPolicyVersion: preview.policyVersion,
          }),
        },
      );

      if (response.status === 409) {
        setStatus("他の操作で対象状態が更新されました。最新状態を再取得しました");
        await loadPreview();
        return;
      }
      if (!response.ok) {
        setStatus(`補正を実行できませんでした (HTTP ${response.status})`);
        return;
      }

      const result = await response.json() as CorrectionExecuteResponse;
      setLastResult(result);
      setStatus("補正と検証が完了しました");
      setReason("");
      setConfirmed(false);
      await loadPreview();
    } catch {
      setStatus("補正処理で通信エラーが発生しました");
    }
  };

  useEffect(() => { void loadPreview(); }, []);

  const before = preview?.correctionPreview.before;
  const currentProjection = lastResult?.correction?.after ?? before;
  const currentState = currentProjection?.state;
  const deleted = currentState?.deleted;
  const previewAvailable = preview?.correctionPreview.available === true && !lastResult?.correction?.after;

  return <section className="admin-audit-panel" id="admin-business-operations" aria-labelledby="admin-correction-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">BUSINESS OPERATIONS / SAFE CORRECTION</p>
        <h2 id="admin-correction-title">安全なデータ補正</h2>
        <p>SQLや行編集ではなく、Projectが許可したCommandだけを実行します。対象Version・業務状態・理由・確認を明示し、競合時は更新しません。</p>
      </div>
      <div className="admin-audit-scope"><span>Scope</span><strong>{WORKHUB_SCOPE_ID}</strong></div>
    </div>

    {loading && <div className="admin-audit-state" role="status">補正対象を確認しています…</div>}

    {!loading && preview && <div className="admin-correction-grid">
      <div className="admin-correction-summary">
        <span>Command</span><strong>{DATA_CORRECTION_COMMAND}</strong>
        <span>Resource</span><code>{DATA_CORRECTION_RESOURCE_ID}</code>
        <span>Current version</span><strong>{currentProjection?.version ?? "—"}</strong>
        <span>Deleted</span><strong data-testid="correction-deleted-state">{deleted === true ? "YES" : deleted === false ? "NO" : "—"}</strong>
        <span>Policy</span><strong>{preview.preview.policyDecision} / {preview.preview.risk}</strong>
        {!previewAvailable && <small>現在は実行不可: {preview.correctionPreview.reasonCode ?? "precondition_not_met"}</small>}
      </div>

      <form className="admin-retry-panel admin-correction-form" onSubmit={(event) => { event.preventDefault(); void executeCorrection(); }}>
        <label>補正理由
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            required
            placeholder="例：誤って論理削除されたことを確認し、業務責任者の確認後に復元"
          />
        </label>
        <label className="admin-confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          対象・Version・影響範囲を確認しました
        </label>
        <div className="admin-retry-actions">
          <button
            type="submit"
            disabled={!previewAvailable || !reason.trim() || !confirmed}
          >
            このデータを復元
          </button>
        </div>
      </form>
    </div>}

    {lastResult?.correction?.after && <div className="admin-audit-state">
      復元後: version {lastResult.correction.after.version} / deleted {String(lastResult.correction.after.state.deleted)}
      / verification {lastResult.verification.status}
    </div>}
    {status && <div className="admin-audit-state" role="status">{status}</div>}
  </section>;
};

const JobOperationsViewer = () => {
  const [jobState, setJobState] = useState("");
  const [state, setState] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly data: JobResponse }
    | { readonly kind: "error"; readonly requestId: string | null }
  >({ kind: "loading" });
  const [retryJob, setRetryJob] = useState<JobItem | null>(null);
  const [retryPolicyVersion, setRetryPolicyVersion] = useState("");
  const [retryPolicyDecision, setRetryPolicyDecision] = useState("");
  const [retryReason, setRetryReason] = useState("");
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const [retryStatus, setRetryStatus] = useState("");

  const load = async () => {
    setState({ kind: "loading" });
    const params = new URLSearchParams({ scopeId: WORKHUB_SCOPE_ID, limit: "20" });
    if (jobState) params.set("state", jobState);
    try {
      const response = await fetch(`/api/admin/jobs?${params.toString()}`, {
        headers: { accept: "application/json" },
      });
      const requestId = response.headers.get("x-request-id");
      if (!response.ok) {
        setState({ kind: "error", requestId });
        return;
      }
      setState({ kind: "ready", data: await response.json() as JobResponse });
    } catch {
      setState({ kind: "error", requestId: null });
    }
  };

  const prepareRetry = async (job: JobItem) => {
    setRetryStatus("");
    const response = await fetch(
      `/api/admin/jobs/${encodeURIComponent(job.jobId)}/retry/preview?scopeId=${encodeURIComponent(WORKHUB_SCOPE_ID)}`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) {
      setRetryStatus(`Retry Previewを取得できませんでした (HTTP ${response.status})`);
      return;
    }
    const data = await response.json() as {
      readonly policyVersion: string;
      readonly preview: { readonly policyDecision: string; readonly risk: string };
    };
    setRetryJob(job);
    setRetryPolicyVersion(data.policyVersion);
    setRetryPolicyDecision(`${data.preview.policyDecision} / ${data.preview.risk}`);
    setRetryReason("");
    setRetryConfirmed(false);
  };

  const executeRetry = async () => {
    if (!retryJob) return;
    setRetryStatus("再実行しています…");
    try {
      const csrfResponse = await fetch("/api/auth/csrf", { headers: { accept: "application/json" } });
      if (!csrfResponse.ok) {
        setRetryStatus("CSRF tokenを取得できませんでした");
        return;
      }
      const { csrfToken } = await csrfResponse.json() as { readonly csrfToken: string };
      const response = await fetch(
        `/api/admin/jobs/${encodeURIComponent(retryJob.jobId)}/retry?scopeId=${encodeURIComponent(WORKHUB_SCOPE_ID)}`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({
            reason: retryReason,
            confirmed: retryConfirmed,
            previewPolicyVersion: retryPolicyVersion,
          }),
        },
      );
      if (response.status === 409) {
        setRetryStatus("他の操作でJob状態が更新されました。最新状態を再取得しました");
        setRetryJob(null);
        await load();
        return;
      }
      if (!response.ok) {
        setRetryStatus(`再実行できませんでした (HTTP ${response.status})`);
        return;
      }
      setRetryStatus("再実行と検証が完了しました");
      setRetryJob(null);
      await load();
    } catch {
      setRetryStatus("再実行処理で通信エラーが発生しました");
    }
  };

  useEffect(() => { void load(); }, []);

  return <section className="admin-audit-panel" id="admin-jobs-and-integrations" aria-labelledby="admin-jobs-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">JOBS & INTEGRATIONS</p>
        <h2 id="admin-jobs-title">ジョブ運用</h2>
        <p>状態・進捗・試行回数・失敗コードを確認します。Payload本文やCredentialは表示せず、再実行は安全なRecovery Adapterが登録されたJobだけを対象にします。</p>
      </div>
      <div className="admin-audit-scope"><span>Scope</span><strong>{WORKHUB_SCOPE_ID}</strong></div>
    </div>
    <form className="admin-audit-filters" onSubmit={(event) => { event.preventDefault(); void load(); }}>
      <label>Status
        <select value={jobState} onChange={(event) => setJobState(event.target.value)}>
          <option value="">すべて</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="retrying">retrying</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="dead_letter">dead_letter</option>
        </select>
      </label>
      <button type="submit" disabled={state.kind === "loading"}>絞り込む</button>
    </form>
    {state.kind === "loading" && <div className="admin-audit-state" role="status">ジョブ状態を取得しています…</div>}
    {state.kind === "error" && <div className="admin-audit-state is-error" role="alert"><strong>ジョブ状態を取得できませんでした</strong><span>{state.requestId ? `Request ID: ${state.requestId}` : "再試行してください"}</span></div>}
    {state.kind === "ready" && state.data.items.length === 0 && <div className="admin-audit-state">対象のジョブはありません</div>}
    {state.kind === "ready" && state.data.items.length > 0 && <div className="admin-audit-table-wrap">
      <table className="admin-audit-table">
        <thead><tr><th>更新時刻</th><th>Status</th><th>Job</th><th>Attempt</th><th>Progress</th><th>Failure</th><th>Recovery</th></tr></thead>
        <tbody>{state.data.items.map((item) => <tr key={item.jobId}>
          <td>{new Date(item.updatedAt).toLocaleString("ja-JP")}</td>
          <td><strong>{item.state}</strong></td>
          <td><strong>{item.type}</strong><small>{item.jobId}</small></td>
          <td>{item.attempt}</td>
          <td>{item.progress ? `${item.progress.percent}%${item.progress.code ? ` / ${item.progress.code}` : ""}` : "—"}</td>
          <td>{item.failureCode ?? "—"}</td>
          <td>{item.retry.available
            ? <button className="admin-inline-action" type="button" onClick={() => { void prepareRetry(item); }}>再実行を確認</button>
            : <small>不可: {item.retry.reason}</small>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {retryJob && <form className="admin-retry-panel" onSubmit={(event) => { event.preventDefault(); void executeRetry(); }}>
      <div><p className="admin-eyebrow">CONTROLLED RECOVERY</p><h3>{retryJob.type}</h3><p>Job ID: <code>{retryJob.jobId}</code></p><p>Policy: <strong>{retryPolicyDecision}</strong></p></div>
      <label>再実行理由
        <textarea value={retryReason} onChange={(event) => setRetryReason(event.target.value)} maxLength={200} required placeholder="例：依存先復旧を確認したため検索インデックスを再生成" />
      </label>
      <label className="admin-confirm"><input type="checkbox" checked={retryConfirmed} onChange={(event) => setRetryConfirmed(event.target.checked)} />対象・環境・影響範囲を確認しました</label>
      <div className="admin-retry-actions">
        <button type="button" onClick={() => setRetryJob(null)}>キャンセル</button>
        <button type="submit" disabled={!retryReason.trim() || !retryConfirmed}>このJobを再実行</button>
      </div>
    </form>}
    {retryStatus && <div className="admin-audit-state" role="status">{retryStatus}</div>}
  </section>;
};

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
          {sections.slice(1).map(([key, label, description]) => <article id={`admin-${key.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}`} className="admin-section-card" key={key}><span className="admin-section-key">{key}</span><h2>{label}</h2><p>{description}</p>{key === "Audit & Security" ? <a className="admin-section-link" href="#admin-audit-and-security">監査ログを見る</a> : key === "Jobs & Integrations" ? <a className="admin-section-link" href="#admin-jobs-and-integrations">ジョブ状態を見る</a> : key === "Business Operations" ? <a className="admin-section-link" href="#admin-business-operations">安全なデータ補正を見る</a> : <button type="button" disabled>後続Issueで接続</button>}</article>)}
        </section>
        <DataCorrectionViewer />
        <JobOperationsViewer />
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
