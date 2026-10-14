import { useEffect, useRef, useState, type FormEvent } from "react";

const SCOPE_ID = "workhub-company";
const ROLES = ["newcomer", "employee", "manager", "accounting", "corporate"] as const;
type Role = (typeof ROLES)[number];
type InvitationState = "open" | "expired" | "redeemed" | "revoked";
interface Invitation {
  readonly id: string;
  readonly inviteeIdentifier: string | null;
  readonly intendedRole: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly state: InvitationState;
}
type Directory = { kind: "loading" } | { kind: "error"; status: number | null }
  | { kind: "ready"; invitations: readonly Invitation[]; hasMore: boolean };
const BASE = "/api/admin/scopes/workhub-company/invitations";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invitationValid = (value: unknown): value is Invitation =>
  isRecord(value) && typeof value.id === "string"
  && (value.inviteeIdentifier === null || typeof value.inviteeIdentifier === "string")
  && typeof value.intendedRole === "string" && typeof value.issuedAt === "string"
  && typeof value.expiresAt === "string" && ["open", "expired", "redeemed", "revoked"].includes(String(value.state));
const failure = (status: number | null): string => status === 401 ? "ログイン状態を再確認してください。"
  : status === 403 ? "この操作に必要な権限がありません。"
    : status === 409 ? "招待状態が変更されています。再取得して確認してください。"
      : status === 429 ? "アクセスが集中しています。時間を置いて再取得してください。"
        : "操作・取得を完了できませんでした。再取得して確認してください。";
const fmt = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("ja-JP") : "不明";

export default function InvitationOperationsPanel() {
  const [directory, setDirectory] = useState<Directory>({ kind: "loading" });
  const [role, setRole] = useState<Role>("employee");
  const [invitee, setInvitee] = useState("");
  const [issueReason, setIssueReason] = useState("");
  const [issueConfirmed, setIssueConfirmed] = useState(false);
  const [revokeId, setRevokeId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const [ephemeralToken, setEphemeralToken] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const open = directory.kind === "ready" ? directory.invitations.filter(item => item.state === "open") : [];

  const reload = async (clearToken = true): Promise<boolean> => {
    if (clearToken) setEphemeralToken(null);
    setDirectory({ kind: "loading" });
    try {
      const result = await fetch(BASE, { cache: "no-store", headers: { accept: "application/json" } });
      if (!result.ok) {
        setDirectory({ kind: "error", status: result.status });
        return false;
      }
      const value: unknown = await result.json();
      if (!isRecord(value) || value.scopeId !== SCOPE_ID || value.limit !== 50 ||
        !Array.isArray(value.invitations) || value.invitations.length > 50 ||
        !value.invitations.every(invitationValid) || typeof value.hasMore !== "boolean") {
        setDirectory({ kind: "error", status: null });
        return false;
      }
      setDirectory({ kind: "ready", invitations: value.invitations as readonly Invitation[], hasMore: value.hasMore });
      return true;
    } catch {
      setDirectory({ kind: "error", status: null });
      return false;
    }
  };

  const csrf = async (): Promise<string | null> => {
    const result = await fetch("/api/auth/csrf", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!result.ok) return null;
    const value: unknown = await result.json();
    return isRecord(value) && typeof value.csrfToken === "string" ? value.csrfToken : null;
  };

  const mutate = async (kind: "issue" | "revoke", event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || directory.kind !== "ready") return;
    if (kind === "issue" && (!issueConfirmed || !issueReason.trim() || invitee.length > 320)) return;
    if (kind === "revoke" && (!revokeConfirmed || !revokeReason.trim() ||
      !open.some(item => item.id === revokeId))) return;
    inFlight.current = true;
    setBusy(true);
    setEphemeralToken(null);
    setMessage(null);
    try {
      const proof = await csrf();
      if (!proof) {
        setMessage({ error: true, value: "操作用のCSRF確認情報を取得できませんでした。" });
        return;
      }
      const path = kind === "issue" ? BASE : BASE + "/" + encodeURIComponent(revokeId) + "/revoke";
      const response = await fetch(path, { method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": proof },
        body: JSON.stringify(kind === "issue"
          ? { intendedRole: role, inviteeIdentifier: invitee.trim() || null, reason: issueReason.trim(), confirmed: true }
          : { reason: revokeReason.trim(), confirmed: true, expectedState: "open" }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setRevokeId("");
          setRevokeConfirmed(false);
          await reload();
        }
        setMessage({ error: true, value: failure(response.status) });
        return;
      }
      let issuedToken: string | null = null;
      if (kind === "issue") {
        const value: unknown = await response.json();
        if (!isRecord(value) || typeof value.redeemToken !== "string" || value.redeemToken.length < 32) {
          setMessage({ error: true, value: "発行結果を確認できません。招待状態を再取得してください。" });
          return;
        }
        issuedToken = value.redeemToken;
      }
      setIssueReason("");
      setRevokeReason("");
      setIssueConfirmed(false);
      setRevokeConfirmed(false);
      setRevokeId("");
      const refreshed = await reload(false);
      if (issuedToken) setEphemeralToken(issuedToken);
      setMessage({ error: !refreshed, value: refreshed ? (kind === "issue"
        ? "招待を発行しました。トークンは今回だけ表示します。" : "招待を取り消し、一覧を更新しました。")
        : "サーバー操作後に一覧を取得できません。招待状態を再確認してください。" });
    } catch {
      setMessage({ error: true, value: "通信エラーで実行結果を確認できません。再取得して確認してください。" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  return <section id="admin-invitations" className="admin-audit-panel" aria-labelledby="admin-invitations-title">
    <div className="admin-audit-heading">
      <div><p className="admin-eyebrow">USERS & ACCESS / INVITATIONS</p>
        <h2 id="admin-invitations-title">Scopeへの招待</h2>
        <p>対象Scope：<strong>{SCOPE_ID}</strong>。発行・取消は管理者だけに許可されます。</p></div>
    </div>
    <p className="admin-audit-note">招待の発行だけではユーザーに権限を付与しません。メール・SMS自動送信はありません。共有方法は管理者が別途管理してください。</p>
    <button type="button" disabled={busy || directory.kind === "loading"} onClick={() => { setMessage(null); void reload(); }}>招待一覧を再取得</button>
    {directory.kind === "loading" && <p role="status">招待一覧を読み込んでいます…</p>}
    {directory.kind === "error" && <p role="alert">招待一覧を取得できません。{failure(directory.status)}</p>}
    {directory.kind === "ready" && (directory.invitations.length === 0
      ? <p>現在このScopeへの招待記録はありません。</p>
      : <div className="admin-audit-table-wrap"><table className="admin-audit-table">
        <thead><tr><th>招待ID</th><th>宛先</th><th>Role</th><th>状態</th><th>有効期限</th></tr></thead>
        <tbody>{directory.invitations.map(item => <tr key={item.id}>
          <td><code>{item.id}</code></td><td>{item.inviteeIdentifier || "宛先指定なし"}</td>
          <td>{item.intendedRole}</td><td>{item.state}</td><td>{fmt(item.expiresAt)}</td>
        </tr>)}</tbody>
      </table></div>)}
    {directory.kind === "ready" && directory.hasMore && <p role="status">50件を超える履歴があります。ここでは先頭50件のみを表示しています。</p>}
    <div className="admin-grid">
      <form aria-label="招待発行の確認" className="admin-retry-panel" onSubmit={event => { void mutate("issue", event); }}>
        <h3>招待を発行</h3>
        <label>付与予定の一般Role<select disabled={busy || directory.kind !== "ready"} value={role}
          onChange={event => { setRole(event.target.value as Role); setIssueConfirmed(false); }}>
          {ROLES.map(item => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <label>宛先識別子（任意）<input maxLength={320} value={invitee} disabled={busy || directory.kind !== "ready"}
          onChange={event => { setInvitee(event.target.value); setIssueConfirmed(false); }} placeholder="例：社内のメールアドレス" /></label>
        <label>発行理由<textarea value={issueReason} required maxLength={200} disabled={busy || directory.kind !== "ready"}
          onChange={event => setIssueReason(event.target.value)} /></label>
        <label><input type="checkbox" checked={issueConfirmed} disabled={busy || directory.kind !== "ready"}
          onChange={event => setIssueConfirmed(event.target.checked)} />Scope・Role・宛先と発行理由を確認しました</label>
        <button type="submit" disabled={busy || directory.kind !== "ready" || !issueConfirmed || !issueReason.trim()}>
          {busy ? "実行中…" : "招待を発行する"}
        </button>
      </form>
      <form aria-label="招待取消の確認" className="admin-retry-panel" onSubmit={event => { void mutate("revoke", event); }}>
        <h3>有効な招待を取り消す</h3>
        <label>対象の招待<select disabled={busy || directory.kind !== "ready"} value={revokeId}
          onChange={event => { setRevokeId(event.target.value); setRevokeConfirmed(false); }}>
          <option value="">取消対象を選択</option>
          {open.map(item => <option key={item.id} value={item.id}>{item.inviteeIdentifier || "宛先なし"} / {item.intendedRole} / {item.id}</option>)}
        </select></label>
        <label>取消理由<textarea value={revokeReason} maxLength={200} required disabled={busy || directory.kind !== "ready"}
          onChange={event => setRevokeReason(event.target.value)} /></label>
        <label><input type="checkbox" checked={revokeConfirmed} disabled={busy || directory.kind !== "ready"}
          onChange={event => setRevokeConfirmed(event.target.checked)} />取消対象と影響を確認しました</label>
        <button type="submit" disabled={busy || directory.kind !== "ready" || !revokeId || !revokeReason.trim() || !revokeConfirmed}>
          {busy ? "実行中…" : "この招待を取り消す"}
        </button>
      </form>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={message.error ? "admin-audit-state is-error" : "admin-audit-state"}>{message.value}</p>}
    {ephemeralToken && <div className="admin-retry-panel" role="region" aria-label="発行直後のワンタイム招待">
      <h3>一度だけ表示される招待トークン</h3>
      <p>以下は発行時だけ取得できます。再取得・画面再読み込みで消えます。アプリ内の保存領域・履歴に保管しません。</p>
      <code>{ephemeralToken}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(ephemeralToken).catch(() => {
        setMessage({ error: true, value: "コピーできませんでした。ブラウザの権限を確認してください。" });
      }); }}>トークンをコピー</button>
      <button type="button" onClick={() => setEphemeralToken(null)}>表示を消す</button>
    </div>}
  </section>;
}
