import { useEffect, useState } from "react";
import scsMapping from "../../../config/scs-control-mapping.json";

/**
 * #420 Stage8 first read-only slice: the API has its own session/scope guard.
 * A local SCS mapping is a reference, not a certified live posture.
 */
const URL = "/api/admin/security-center?scopeId=workhub-company";
const kinds = [
  "secret-detection", "dependency-audit", "configuration-check", "scs-control-mapping",
] as const;
type SourceKind = typeof kinds[number];
interface Source {
  readonly sourceKind: SourceKind;
  readonly connection: "not-connected";
  readonly checkConclusion: null;
  readonly coverage: {
    readonly sourceId: string;
    readonly coverageState: "not-checked";
    readonly sourceHealth: "unmonitored";
    readonly checkedFindingCount: null;
    readonly freshness: "unknown";
  };
}
interface Snapshot {
  readonly schemaVersion: 1;
  readonly scopeId: "workhub-company";
  readonly observedAt: string;
  readonly evidenceBoundary: "no_live_security_source_connected";
  readonly findings: { readonly availability: "not-checked"; readonly verifiedCount: null; readonly items: readonly never[] };
  readonly sources: readonly Source[];
}
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly data: Snapshot };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const decode = (value: unknown): Snapshot | null => {
  if (!record(value) || value.schemaVersion !== 1 || value.scopeId !== "workhub-company"
    || value.evidenceBoundary !== "no_live_security_source_connected"
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))
    || !record(value.findings) || value.findings.availability !== "not-checked"
    || value.findings.verifiedCount !== null || !Array.isArray(value.findings.items)
    || value.findings.items.length !== 0 || !Array.isArray(value.sources)
    || value.sources.length !== kinds.length) return null;
  for (const kind of kinds) {
    const matches = value.sources.filter((src: unknown) => record(src) && src.sourceKind === kind);
    if (matches.length !== 1) return null;
    const item = matches[0];
    if (!record(item) || item.connection !== "not-connected" || item.checkConclusion !== null
      || !record(item.coverage)
      || item.coverage.sourceId !== kind.replaceAll("-", "_")
      || item.coverage.coverageState !== "not-checked"
      || item.coverage.sourceHealth !== "unmonitored"
      || item.coverage.checkedFindingCount !== null
      || item.coverage.freshness !== "unknown") return null;
  }
  return value as unknown as Snapshot;
};
const labels: Record<SourceKind, string> = {
  "secret-detection": "シークレット検出",
  "dependency-audit": "依存関係監査",
  "configuration-check": "セキュリティ構成",
  "scs-control-mapping": "SCS管理項目マッピング",
};

export default function SecurityCenterPanel() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [generation, setGeneration] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => {
    let active = true;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const response = await fetch(URL, { headers: { accept: "application/json" }, cache: "no-store" });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setState({ kind: "denied" });
          return;
        }
        const data: unknown = response.ok ? await response.json() : null;
        if (active) setState(data !== null && decode(data)
          ? { kind: "ready", data: decode(data)! } : { kind: "unavailable" });
      } catch {
        if (active) setState({ kind: "unavailable" });
      }
    };
    void load();
    return () => { active = false; };
  }, [generation]);

  const rows = scsMapping.requirements.filter(item => statusFilter === "all" || item.status === statusFilter);
  const statuses = [...new Set(scsMapping.requirements.map(item => item.status))].sort();

  return <section className="admin-audit-panel" id="admin-security-center"
    aria-labelledby="admin-security-center-title">
    <p className="admin-eyebrow">SECURITY / READ-ONLY</p>
    <h2 id="admin-security-center-title">Security Center｜監査の現在地</h2>
    <p>監査実行状況・証跡・責任範囲を確認します。CI成功やFindingが0件という表示だけで安全とは判断しません。</p>
    <button type="button" onClick={() => setGeneration(n => n + 1)} disabled={state.kind === "loading"}>
      監査状態を再取得
    </button>
    {state.kind === "loading" && <p role="status">監査状態を読み込んでいます…</p>}
    {state.kind === "denied" && <p role="alert">管理者権限が必要です。監査状態は開示できません。</p>}
    {state.kind === "unavailable" && <p role="alert">監査状態を確認できません。取得不能を「問題なし」として扱いません。再取得してください。</p>}
    {state.kind === "ready" && <>
      <div className="admin-audit-state" role="status" data-testid="security-coverage">
        <strong>未検査／証拠未接続（Gray）</strong>
        <p>確認済み0件ではありません。Security Findingの実データ・最終成功時刻・証跡の鮮度は未確認です。</p>
        <small>取得日時（画面更新時刻）：{new Date(state.data.observedAt).toLocaleString("ja-JP")}。監査実施日時ではありません。</small>
      </div>
      <h3>監査ソースの接続状況</h3>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>監査領域</th><th>ソース状態</th><th>Finding件数</th><th>証跡鮮度</th></tr></thead>
        <tbody>{state.data.sources.map(src => <tr key={src.sourceKind}>
          <td>{labels[src.sourceKind]}</td><td>未接続／未検査</td><td>不明（確認済み0件ではない）</td><td>未確認</td>
        </tr>)}</tbody>
      </table></div>
      <p>CIのジョブ状態とSecurity Findingは別の情報です。Scanner/Providerが未接続の場合、検出件数を推測しません。</p>
      <h3>SCS管理項目：既存マッピング（静的参照）</h3>
      <p>以下はテンプレートの登録情報です。実環境で検証した最新の証拠やSCS認定結果ではありません。組織・案件責任の項目はテンプレートが保証しません。</p>
      <label>SCS責務・状態で絞り込み
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="all">すべて（{scsMapping.requirements.length}件）</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>Requirement</th><th>登録済みの責務・状態</th><th>Control</th><th>Test / Evidence</th><th>鮮度</th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.id}>
          <td><strong>{item.id}</strong><small>{item.name}</small></td>
          <td>{item.status}</td>
          <td>{item.control || "未登録"}</td>
          <td>{item.test || item.evidence ? <>
            <small>Test: {item.test || "未登録"}</small><small>Evidence: {item.evidence || "未登録"}</small>
          </> : "未登録"}</td>
          <td>未検証</td>
        </tr>)}</tbody>
      </table></div>
      <p>Security FindingのseverityとSCSのstatusは別軸です。証跡の実検証・Requirementへの相関は後続工程で接続します。</p>
      <p><a href="#admin-audit-and-security">既存の監査ログを確認（Audit Event）</a> — 監査イベントはSecurity Findingに自動変換しません。</p>
    </>}
  </section>;
}
