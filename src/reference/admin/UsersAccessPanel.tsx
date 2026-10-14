import { useEffect, useRef, useState } from "react";

/**
 * #99 Stage5: a bounded, read-only administrator view.
 * Every request is still independently authorized on the Worker.
 * Raw credentials, identity-provider subjects and session tokens are never loaded.
 */
const SCOPE_ID = "workhub-company";

interface Member {
  readonly userId: string;
  readonly displayName: string | null;
  readonly status: "active" | "disabled";
  readonly role: string;
}

interface MembersResponse {
  readonly scopeId: string;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly members: readonly Member[];
}

interface ActiveSession {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

type LoadState<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly status: number | null }
  | { readonly kind: "ready"; readonly data: T };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMember = (value: unknown): value is Member =>
  isRecord(value) && typeof value.userId === "string"
  && (typeof value.displayName === "string" || value.displayName === null)
  && (value.status === "active" || value.status === "disabled")
  && typeof value.role === "string";

const isMembersResponse = (value: unknown): value is MembersResponse =>
  isRecord(value) && value.scopeId === SCOPE_ID && value.limit === 50
  && typeof value.hasMore === "boolean"
  && Array.isArray(value.members) && value.members.length <= 50
  && value.members.every(isMember);

const isActiveSession = (value: unknown): value is ActiveSession =>
  isRecord(value) && typeof value.sessionId === "string"
  && typeof value.createdAt === "string"
  && typeof value.lastSeenAt === "string"
  && typeof value.expiresAt === "string"
  && typeof value.current === "boolean";

const formatDate = (value: string) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ja-JP") : "不明";

const failure = (status: number | null) => {
  if (status === 401) return "ログイン状態を再確認してください。";
  if (status === 403 || status === 404) return "対象を参照する権限がありません。";
  if (status === 429) return "アクセスが集中しています。時間を置いて再取得してください。";
  return "取得できませんでした。再度確認してください。";
};

export default function UsersAccessPanel() {
  const [members, setMembers] = useState<LoadState<MembersResponse>>({ kind: "loading" });
  const [selected, setSelected] = useState<Member | null>(null);
  const [sessions, setSessions] = useState<LoadState<readonly ActiveSession[]> | null>(null);
  const requestSerial = useRef(0);
  const inFlight = useRef(false);
  const [operation, setOperation] = useState<{ member: Member; kind: "disable" | "reactivate" } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ error: boolean; text: string } | null>(null);

  const loadMembers = async () => {
    requestSerial.current++;
    setSelected(null);
    setSessions(null);
    setMembers({ kind: "loading" });
    try {
      const response = await fetch(`/api/admin/scopes/${encodeURIComponent(SCOPE_ID)}/memberships`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (!response.ok) {
        setMembers({ kind: "error", status: response.status });
        return;
      }
      const value: unknown = await response.json();
      setMembers(isMembersResponse(value)
        ? { kind: "ready", data: value } : { kind: "error", status: null });
    } catch {
      setMembers({ kind: "error", status: null });
    }
  };

  const selectMember = async (member: Member) => {
    const serial = ++requestSerial.current;
    setSelected(member);
    setSessions({ kind: "loading" });
    try {
      const response = await fetch(
        `/api/admin/scopes/${encodeURIComponent(SCOPE_ID)}/users/${encodeURIComponent(member.userId)}/sessions`,
        { headers: { accept: "application/json" }, cache: "no-store" },
      );
      if (serial !== requestSerial.current) return;
      if (!response.ok) {
        setSessions({ kind: "error", status: response.status });
        return;
      }
      const value: unknown = await response.json();
      if (serial !== requestSerial.current) return;
      setSessions(isRecord(value) && Array.isArray(value.sessions)
        && value.sessions.length <= 20 && value.sessions.every(isActiveSession)
        ? { kind: "ready", data: value.sessions as readonly ActiveSession[] }
        : { kind: "error", status: null });
    } catch {
      if (serial === requestSerial.current) setSessions({ kind: "error", status: null });
    }
  };

  const executeLifecycle = async () => {
    if (!operation || inFlight.current || !confirmed || !reason.trim()) return;
    inFlight.current = true;
    setSubmitting(true);
    setActionMessage(null);
    try {
      const csrf = await fetch("/api/auth/csrf", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!csrf.ok) {
        setActionMessage({ error: true, text: csrf.status === 401 ? "ログイン状態を再確認してください。" : "操作用の確認情報を取得できませんでした。" });
        return;
      }
      const proof = await csrf.json() as { csrfToken?: string };
      if (!proof.csrfToken) {
        setActionMessage({ error: true, text: "操作用の確認情報を取得できませんでした。" });
        return;
      }
      const target = operation.member;
      const response = await fetch(
        "/api/admin/scopes/" + encodeURIComponent(SCOPE_ID) + "/users/" + encodeURIComponent(target.userId) + "/" + operation.kind,
        { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": proof.csrfToken },
          body: JSON.stringify({ reason: reason.trim(), confirmed: true, expectedStatus: target.status }) },
      );
      if (!response.ok) {
        if (response.status === 409) {
          await loadMembers();
          setActionMessage({ error: true, text: "対象の状態が変更されています。再取得した状態を確認してください。" });
        } else {
          setActionMessage({ error: true, text: response.status === 403 ? "この対象の操作は許可されていません。"
            : response.status === 401 ? "ログイン状態を再確認してください。"
              : response.status === 503 ? "現在は更新できません。後で再確認してください。"
                : "操作を完了できませんでした（HTTP " + response.status + "）。" });
        }
        return;
      }
      const completed = operation.kind === "disable" ? "無効化" : "再有効化";
      setOperation(null);
      setReason("");
      setConfirmed(false);
      await loadMembers();
      setActionMessage({ error: false, text: (target.displayName || target.userId) + " の" + completed + "が完了しました。最新の所属情報を取得しました。" });
    } catch {
      setActionMessage({ error: true, text: "通信エラーのため操作結果を確認できません。再取得して状態を確認してください。" });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  useEffect(() => { void loadMembers(); }, []);

  return <section id="admin-users-and-access" className="admin-audit-panel" aria-labelledby="admin-users-title">
    <div className="admin-audit-heading">
      <div>
        <p className="admin-eyebrow">USERS & ACCESS / SCOPE VIEW</p>
        <h2 id="admin-users-title">ユーザー・権限管理</h2>
        <p>このScopeの所属ユーザー・ロール・状態と有効セッションを確認します。権限判定はAPI側で行われます。</p>
      </div>
      <div className="admin-audit-scope"><span>Scope</span><strong>{SCOPE_ID}</strong></div>
    </div>
    <p className="admin-audit-note">最大50件の先頭表示です。全ユーザー検索や全件表示ではありません。管理者以外の無効化・再有効化のみ、理由と確認を記録して操作できます。Membership・Role・Invitationの変更は未接続です。</p>
    <button type="button" onClick={() => { void loadMembers(); }} disabled={members.kind === "loading"}>所属ユーザーを再取得</button>
    {members.kind === "loading" && <p role="status" className="admin-audit-state">所属ユーザーを取得しています…</p>}
    {members.kind === "error" && <p role="alert" className="admin-audit-state is-error">所属ユーザーを取得できませんでした。{failure(members.status)}</p>}
    {members.kind === "ready" && <>
      {members.data.members.length === 0
        ? <p className="admin-audit-state">このScopeの所属ユーザーは見つかりませんでした。</p>
        : <div className="admin-audit-table-wrap">
          <table className="admin-audit-table">
            <thead><tr><th>ユーザー</th><th>Role</th><th>状態</th><th>セッション</th><th>状態操作</th></tr></thead>
            <tbody>{members.data.members.map(member => <tr key={member.userId}>
              <td><strong>{member.displayName || "表示名なし"}</strong><small>{member.userId}</small></td>
              <td>{member.role}</td>
              <td>{member.status === "active" ? "有効" : "無効"}</td>
              <td><button type="button" className="admin-inline-action"
                aria-pressed={selected?.userId === member.userId}
                onClick={() => { void selectMember(member); }}>有効セッションを確認</button></td>
              <td>{member.role === "system_admin" ? <small>管理者の状態変更不可</small>
                : <button type="button" className="admin-inline-action" disabled={submitting}
                    onClick={() => { setOperation({ member, kind: member.status === "active" ? "disable" : "reactivate" }); setReason(""); setConfirmed(false); setActionMessage(null); }}>
                    {member.status === "active" ? "無効化を確認" : "再有効化を確認"}</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      {members.data.hasMore && <p role="status" className="admin-audit-note">51件目以降はこの画面に表示されません。50件で全件とは限りません。</p>}
    </>}
    {operation && <form className="admin-retry-panel" aria-label="ユーザー状態変更の確認"
      onSubmit={(event) => { event.preventDefault(); void executeLifecycle(); }}>
      <h3>{operation.member.displayName || operation.member.userId} の{operation.kind === "disable" ? "無効化" : "再有効化"}</h3>
      <p>対象ID: <code>{operation.member.userId}</code> / 現在の状態: {operation.member.status === "active" ? "有効" : "無効"} / Scope: {SCOPE_ID}</p>
      <label>操作理由
        <textarea value={reason} onChange={event => setReason(event.target.value)}
          maxLength={200} required disabled={submitting} placeholder="例：管理担当者の申請を確認したため" />
      </label>
      <label className="admin-confirm"><input type="checkbox" checked={confirmed}
        onChange={event => setConfirmed(event.target.checked)} disabled={submitting} />
        対象・状態・影響範囲を確認しました
      </label>
      <div className="admin-retry-actions">
        <button type="button" disabled={submitting} onClick={() => { setOperation(null); setConfirmed(false); setReason(""); }}>キャンセル</button>
        <button type="submit" disabled={submitting || !confirmed || !reason.trim()}>
          {submitting ? "処理中…" : operation.kind === "disable" ? "このユーザーを無効化" : "このユーザーを再有効化"}
        </button>
      </div>
    </form>}
    {actionMessage && <p role={actionMessage.error ? "alert" : "status"} className={`admin-audit-state${actionMessage.error ? " is-error" : ""}`}>{actionMessage.text}</p>}
    {selected && <div className="admin-users-sessions" aria-live="polite">
      <h3>{selected.displayName || selected.userId} の有効セッション</h3>
      {sessions?.kind === "loading" && <p role="status">確認しています…</p>}
      {sessions?.kind === "error" && <p role="alert">{failure(sessions.status)}</p>}
      {sessions?.kind === "ready" && (sessions.data.length === 0
        ? <p>有効セッションはありません（最大20件を照会）。</p>
        : <div className="admin-audit-table-wrap"><table className="admin-audit-table">
          <thead><tr><th>最終利用</th><th>有効期限</th><th>備考</th></tr></thead>
          <tbody>{sessions.data.map(item => <tr key={item.sessionId}>
            <td>{formatDate(item.lastSeenAt)}</td>
            <td>{formatDate(item.expiresAt)}</td>
            <td>{item.current ? "現在のセッション" : "有効"}</td>
          </tr>)}</tbody>
        </table></div>)}
      <p className="admin-audit-note">セッションは最大20件の表示です。認証トークンやハッシュは取得・表示しません。</p>
    </div>}
  </section>;
}
