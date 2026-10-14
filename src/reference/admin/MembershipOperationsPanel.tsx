import { useRef, useState, type FormEvent } from "react";

const SCOPE_ID = "workhub-company";
const ASSIGNABLE_ROLES = ["newcomer", "employee", "manager", "accounting", "corporate"] as const;
type Role = (typeof ASSIGNABLE_ROLES)[number];
type Action = "add" | "remove" | "role";

interface Member {
  readonly userId: string;
  readonly displayName: string | null;
  readonly role: string;
  readonly status: string;
}
interface Props {
  readonly members: readonly Member[];
  readonly ready: boolean;
  readonly onRefresh: () => Promise<boolean>;
}

const safeFailure = (status: number): string => {
  if (status === 401) return "ログイン状態を再確認してください。";
  if (status === 403) return "この操作の権限がありません。";
  if (status === 409) return "所属・ロール・対象情報が変更されています。再取得後に確認してください。";
  if (status === 429) return "操作が集中しています。時間を置いて再確認してください。";
  if (status === 503) return "現在この操作はできません。再取得後に確認してください。";
  return "操作に失敗しました（HTTP " + status + "）。";
};

/** WORKHUB Stage5's deliberately narrow UI. No system_admin assignment/demotion. */
export default function MembershipOperationsPanel({ members, ready, onRefresh }: Props) {
  const [action, setAction] = useState<Action>("role");
  const [selectedId, setSelectedId] = useState("");
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState<Role>("employee");
  const [nextRole, setNextRole] = useState<Role>("employee");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; value: string } | null>(null);
  const inFlight = useRef(false);
  const selected = members.find(item => item.userId === selectedId) ?? null;
  const isAllowedTarget = Boolean(selected && selected.role !== "system_admin");
  const validInput = ready && (action === "add"
    ? /^[A-Za-z0-9_.:-]{1,128}$/u.test(addId) && ASSIGNABLE_ROLES.includes(addRole)
    : isAllowedTarget && (action === "remove" || (selected?.role !== nextRole && ASSIGNABLE_ROLES.includes(nextRole))));
  const clear = () => {
    setConfirmed(false);
    setReason("");
  };

  const execute = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !confirmed || !reason.trim() || !validInput || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const userId = action === "add" ? addId.trim() : selectedId;
    const base = "/api/admin/scopes/" + encodeURIComponent(SCOPE_ID) + "/memberships";
    const path = action === "add" ? base
      : action === "remove" ? base + "/" + encodeURIComponent(userId)
      : base + "/" + encodeURIComponent(userId) + "/role";
    const method = action === "add" ? "POST" : action === "remove" ? "DELETE" : "PATCH";
    const payload = {
      reason: reason.trim(), confirmed: true,
      ...(action === "add" ? { userId, role: addRole }
        : action === "role" ? { expectedRole: selected?.role, nextRole }
          : { expectedRole: selected?.role }),
    };
    try {
      const csrf = await fetch("/api/auth/csrf", { cache: "no-store", headers: { accept: "application/json" } });
      if (!csrf.ok) {
        setMessage({ error: true, value: safeFailure(csrf.status) });
        return;
      }
      const token: unknown = await csrf.json();
      if (!token || typeof token !== "object" || !("csrfToken" in token)
        || typeof token.csrfToken !== "string") {
        setMessage({ error: true, value: "操作確認情報が取得できませんでした。" });
        return;
      }
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", accept: "application/json", "x-csrf-token": token.csrfToken },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setSelectedId("");
          clear();
          await onRefresh();
        }
        setMessage({ error: true, value: safeFailure(response.status) });
        return;
      }
      setSelectedId("");
      setAddId("");
      clear();
      const refreshed = await onRefresh();
      setMessage({ error: !refreshed, value: refreshed
        ? "所属情報の変更が完了し、現在の一覧を再取得しました。"
        : "操作は受け付けられましたが一覧を再取得できません。確認するまで再操作しないでください。" });
    } catch {
      setMessage({ error: true, value: "通信エラーで操作結果を確認できません。再取得して状態を確認してください。" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <section className="admin-retry-panel" aria-labelledby="admin-membership-actions-title">
    <h3 id="admin-membership-actions-title">所属・ロールの管理</h3>
    <p>対象Scope：<strong>{SCOPE_ID}</strong>。既存ユーザーの所属追加、一般ロール変更・所属削除ができます。特権管理者のRole付与・変更・削除はこの画面から行えません。</p>
    {!ready && <p role="status">所属情報の確認が完了するまで、管理操作を実行できません。</p>}
    <form aria-label="所属・ロール変更の確認" onSubmit={event => { void execute(event); }}>
      <label>操作の種類
        <select value={action} disabled={busy || !ready} onChange={event => { setAction(event.target.value as Action); clear(); setMessage(null); }}>
          <option value="role">所属ロールの変更</option>
          <option value="add">既存ユーザーをScopeに追加</option>
          <option value="remove">Scopeから所属を削除</option>
        </select>
      </label>
      {action === "add" ? <>
        <label>既存ユーザーID<input value={addId} maxLength={128} required disabled={busy || !ready}
          onChange={event => { setAddId(event.target.value); clear(); }} placeholder="例：workhub-demo-haru" /></label>
        <label>付与する一般ロール<select value={addRole} disabled={busy || !ready}
          onChange={event => { setAddRole(event.target.value as Role); clear(); }}>
          {ASSIGNABLE_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
        </select></label>
      </> : <>
        <label>対象の所属ユーザー
          <select value={selectedId} required disabled={busy || !ready}
            onChange={event => { setSelectedId(event.target.value); clear(); }}>
            <option value="">対象を選択</option>
            {members.filter(item => item.role !== "system_admin").map(item =>
              <option key={item.userId} value={item.userId}>{item.displayName || item.userId}（{item.userId} / {item.role}）</option>)}
          </select>
        </label>
        {selected && <p>対象：<strong>{selected.displayName || selected.userId}</strong> / 現在のRole：<strong>{selected.role}</strong></p>}
        {action === "role" && <label>変更後の一般ロール
          <select value={nextRole} disabled={busy || !ready} onChange={event => { setNextRole(event.target.value as Role); clear(); }}>
            {ASSIGNABLE_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>}
      </>}
      <label>操作理由<textarea required value={reason} maxLength={200} disabled={busy || !ready}
        onChange={event => setReason(event.target.value)} placeholder="変更申請・承認などの根拠" /></label>
      <label><input type="checkbox" checked={confirmed} disabled={busy || !ready}
        onChange={event => setConfirmed(event.target.checked)} />
        対象ID・Scope・現在のRole・変更内容を確認しました
      </label>
      <button type="submit" disabled={!confirmed || !reason.trim() || !validInput || busy}>
        {busy ? "実行中…" : action === "add" ? "所属の追加を実行" : action === "remove" ? "所属の削除を実行" : "ロール変更を実行"}
      </button>
    </form>
    {message && <p role={message.error ? "alert" : "status"} className={message.error ? "admin-audit-state is-error" : "admin-audit-state"}>{message.value}</p>}
  </section>;
}
