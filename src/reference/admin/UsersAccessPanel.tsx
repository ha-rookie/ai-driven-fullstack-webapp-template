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
    <p className="admin-audit-note">最大50件の先頭表示です。全ユーザー検索や全件表示ではありません。ここからユーザー状態や権限を変更する操作はまだ提供していません。</p>
    <button type="button" onClick={() => { void loadMembers(); }} disabled={members.kind === "loading"}>所属ユーザーを再取得</button>
    {members.kind === "loading" && <p role="status" className="admin-audit-state">所属ユーザーを取得しています…</p>}
    {members.kind === "error" && <p role="alert" className="admin-audit-state is-error">所属ユーザーを取得できませんでした。{failure(members.status)}</p>}
    {members.kind === "ready" && <>
      {members.data.members.length === 0
        ? <p className="admin-audit-state">このScopeの所属ユーザーは見つかりませんでした。</p>
        : <div className="admin-audit-table-wrap">
          <table className="admin-audit-table">
            <thead><tr><th>ユーザー</th><th>Role</th><th>状態</th><th>セッション</th></tr></thead>
            <tbody>{members.data.members.map(member => <tr key={member.userId}>
              <td><strong>{member.displayName || "表示名なし"}</strong><small>{member.userId}</small></td>
              <td>{member.role}</td>
              <td>{member.status === "active" ? "有効" : "無効"}</td>
              <td><button type="button" className="admin-inline-action"
                aria-pressed={selected?.userId === member.userId}
                onClick={() => { void selectMember(member); }}>有効セッションを確認</button></td>
            </tr>)}</tbody>
          </table>
        </div>}
      {members.data.hasMore && <p role="status" className="admin-audit-note">51件目以降はこの画面に表示されません。50件で全件とは限りません。</p>}
    </>}
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
