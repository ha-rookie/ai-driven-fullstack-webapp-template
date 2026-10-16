import { useEffect, useState } from "react";

const SCOPE = "workhub-company";
type Coverage = {
  readonly sourceId: string;
  readonly coverageState: "checked" | "not-checked" | "unavailable" | "not-applicable";
  readonly sourceHealth: "ready" | "degraded" | "unavailable" | "unmonitored";
  readonly freshness: "current" | "stale" | "unknown";
  readonly lastSuccessfulCheckAt?: string;
  readonly evidenceValidUntil?: string;
  readonly checkedFindingCount: number | null;
};
type Requirement = {
  readonly id: string; readonly level: string; readonly name: string;
  readonly responsibility: string; readonly control: string;
  readonly testReference: string | null; readonly evidenceReference: string | null;
  readonly evidenceFreshness: "current" | "stale" | "unknown";
  readonly finding: null; readonly remediation: null;
};
interface Snapshot {
  readonly schemaVersion: 1; readonly scopeId: string; readonly observedAt: string;
  readonly posture: "not-assessed";
  readonly findings: { readonly state: "not-connected"; readonly items: null; readonly verifiedCount: null };
  readonly sources: readonly Coverage[];
  readonly scs: {
    readonly sourceVerifiedAt: string; readonly certification: "not-assessed";
    readonly requirements: readonly Requirement[];
  };
}
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const validTime = (v: unknown): v is string =>
  typeof v === "string" && ISO_TIME.test(v) && Number.isFinite(Date.parse(v))
    && new Date(v).toISOString() === v;
const sourceIds = new Set(["secret_detection", "dependency_audit", "configuration_check", "scs_control_mapping"]);
const validCoverage = (value: unknown, observedAt: string): value is Coverage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Partial<Coverage>;
  if (!sourceIds.has(s.sourceId ?? "") || !["checked", "not-checked", "unavailable", "not-applicable"].includes(s.coverageState ?? "")
    || !["ready", "degraded", "unavailable", "unmonitored"].includes(s.sourceHealth ?? "")
    || !["current", "stale", "unknown"].includes(s.freshness ?? "")) return false;
  if (s.coverageState !== "checked") {
    return s.checkedFindingCount === null && s.freshness === "unknown"
      && (s.coverageState === "unavailable" ? s.sourceHealth === "unavailable"
        : s.sourceHealth === "unmonitored");
  }
  if (!["ready", "degraded"].includes(s.sourceHealth ?? "") || !validTime(s.lastSuccessfulCheckAt)
    || Date.parse(s.lastSuccessfulCheckAt) > Date.parse(observedAt)
    || typeof s.checkedFindingCount !== "number" || !Number.isSafeInteger(s.checkedFindingCount)
    || s.checkedFindingCount < 0) return false;
  if (s.freshness === "unknown") return s.evidenceValidUntil === undefined;
  return validTime(s.evidenceValidUntil) && (s.freshness === "current"
    ? Date.parse(s.evidenceValidUntil) >= Date.parse(observedAt)
    : Date.parse(s.evidenceValidUntil) < Date.parse(observedAt));
};
const isSnapshot = (value: unknown): value is Snapshot => {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<Snapshot>;
  return v.schemaVersion === 1 && v.scopeId === SCOPE && validTime(v.observedAt)
    && v.posture === "not-assessed" && v.findings?.state === "not-connected"
    && v.findings?.verifiedCount === null && v.findings?.items === null
    && Array.isArray(v.sources) && v.sources.length === 4
    && v.sources.every(s => validCoverage(s, v.observedAt!))
    && new Set(v.sources.map(s => s.sourceId)).size === 4
    && v.scs?.certification === "not-assessed"
    && Array.isArray(v.scs.requirements)
    && v.scs.requirements.every(r => typeof r.id === "string"
      && typeof r.name === "string" && typeof r.responsibility === "string"
      && typeof r.control === "string" && r.evidenceFreshness === "unknown");
};
/** A verified source-bound zero is not a whole-system security verdict. */
const coverageDisplay = (source: Coverage) => {
  if (source.coverageState === "unavailable") return { label: "利用不可（Gray）", count: "不明" };
  if (source.coverageState !== "checked") return {
    label: source.coverageState === "not-applicable" ? "対象外（Gray）" : "未検査（Gray）",
    count: "不明",
  };
  const expired = source.evidenceValidUntil !== undefined
    && Date.parse(source.evidenceValidUntil) < Date.now();
  if (source.freshness === "stale" || expired) return {
    label: "証跡期限切れ（Gray）", count: `${source.checkedFindingCount}件（過去の検査値）`,
  };
  if (source.freshness !== "current") return {
    label: "証跡鮮度不明（Gray）", count: `${source.checkedFindingCount}件（鮮度不明）`,
  };
  return { label: "当該ソース確認済（全体の安全判定ではない）",
    count: `${source.checkedFindingCount}件（当該ソースのみ）` };
};

export default function SecurityCenter() {
  const [state, setState] = useState<
    { readonly kind: "loading" | "denied" | "unavailable" }
    | { readonly kind: "ready"; readonly data: Snapshot }
  >({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const load = async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/admin/security/center?scopeId=${encodeURIComponent(SCOPE)}`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        setState({ kind: "denied" }); return;
      }
      if (!response.ok) { setState({ kind: "unavailable" }); return; }
      const payload: unknown = await response.json();
      setState(isSnapshot(payload) ? { kind: "ready", data: payload } : { kind: "unavailable" });
    } catch { setState({ kind: "unavailable" }); }
  };
  useEffect(() => { void load(); }, []);
  const ready = state.kind === "ready" ? state.data : null;
  const requirements = ready?.scs.requirements.filter((r) =>
    `${r.id} ${r.name} ${r.responsibility}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) ?? [];
  return <section className="admin-audit-panel" id="admin-security-center" aria-labelledby="admin-security-center-title">
    <div className="admin-audit-heading"><div>
      <p className="admin-eyebrow">SECURITY / SELF-AUDIT CENTER</p>
      <h2 id="admin-security-center-title">セキュリティ確認センター</h2>
      <p>実際の検査結果と未接続の検査を分けて確認します。監査ログは操作履歴であり、脆弱性Findingではありません。</p>
    </div><div className="admin-audit-scope"><span>Scope</span><strong>{SCOPE}</strong></div></div>
    {state.kind === "loading" && <p role="status">セキュリティ状態を確認しています…</p>}
    {state.kind === "denied" && <p role="alert">このSecurity Centerの参照権限がありません。</p>}
    {state.kind === "unavailable" && <div role="alert"><strong>状態を取得できませんでした</strong>
      <p>未取得を「問題なし」とは扱いません。</p><button type="button" onClick={() => { void load(); }}>再試行</button></div>}
    {ready && <>
      <div className="admin-audit-state" data-testid="security-center-posture">
        <strong>判定：未評価（Gray）</strong>
        <p>検査ソース未接続／Finding件数は不明。0件・安全・SCS適合を意味しません。</p>
      </div>
      <h3>検査ソースと証跡の鮮度</h3>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>検査ソース</th><th>評価状態</th><th>Health</th><th>最終成功</th><th>Evidence freshness</th><th>Finding件数</th></tr></thead>
        <tbody>{ready.sources.map((source) => <tr key={source.sourceId}>
          <td>{source.sourceId}</td><td>{coverageDisplay(source).label}</td>
          <td>{source.sourceHealth}</td><td>{source.lastSuccessfulCheckAt ?? "未取得"}</td>
          <td>{source.freshness}</td><td>{coverageDisplay(source).count}</td>
        </tr>)}</tbody>
      </table></div>
      <h3>SCS要件別の責任・Control・証跡</h3>
      <p>既存要件対応表の参照元確認日：{ready.scs.sourceVerifiedAt}。これは各要件の監査・証跡の最終確認日ではありません。検査実行やSCS認証取得を示しません。</p>
      <label>要件・責任を検索 <input value={filter} onChange={(event) => setFilter(event.target.value)}
        placeholder="例：3-1-1、Project Responsibility" /></label>
      <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>Requirement</th><th>Responsibility</th><th>Control</th><th>Test / Evidence（参照のみ）</th><th>Freshness</th><th>Finding / Remediation</th></tr></thead>
        <tbody>{requirements.map((r) => <tr key={r.id}>
          <td><strong>{r.id}</strong><small>{r.name}</small></td><td>{r.responsibility}</td>
          <td>{r.control}</td><td>{r.testReference ?? "未登録"} / {r.evidenceReference ?? "未登録"}</td>
          <td>未検証（{r.evidenceFreshness}）</td><td>未接続 / 未接続</td>
        </tr>)}</tbody>
      </table></div>
      <p>表示 {requirements.length} / {ready.scs.requirements.length} 要件。SeverityはFinding、SCS statusは要件別の責任・実装状態であり、別の評価軸です。</p>
      <p><a href="#admin-audit-and-security">操作監査ログを別画面で確認</a></p>
    </>}
  </section>;
}
