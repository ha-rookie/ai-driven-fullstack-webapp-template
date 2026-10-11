import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./frontend/auth";
import AdminPortal from "./reference/admin/AdminPortal";
import AccountSwitchButton from "./reference/workhub/AccountSwitchButton";
import ExpenseWorkspace from "./reference/workhub/ExpenseWorkspace";
import { listActionRequiredMyRequests } from "./reference/workhub/my-requests";
import WorkhubAppLauncher from "./reference/workhub/WorkhubAppLauncher";
import "./workhub.css";

interface DemoPersona { readonly key: string; readonly userId: string; readonly displayName: string; readonly roleLabel: string; readonly homeHint: string; }
interface DemoConfig { readonly demoEnabled: boolean; readonly personas: DemoPersona[]; readonly demoPassword?: string; readonly authMode?: "google_oidc"; readonly oidcEnabled?: boolean; }
interface OfficeOption { readonly itemId: string; readonly revisionId: string; readonly code: string; readonly label: string; }
interface UnifiedMyRequest {
  readonly kind: "travel" | "expense";
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: "draft" | "in_progress" | "action_required" | "completed" | "rejected" | "withdrawn" | "unknown";
  readonly statusLabel: string;
  readonly returnReason: string | null;
  readonly amountYen: number | null;
  readonly updatedAt: string;
  readonly journey: { readonly travelStage: string; readonly settlementStage: string; readonly linkedClaimCount: number } | null;
}
interface TravelRequestRecord { readonly id: string; readonly destinationOfficeItemId: string; readonly startDate: string; readonly endDate: string; readonly purpose: string; readonly status: "draft" | "submitting" | "submitted"; readonly version: number; readonly workflowInstanceId: string | null; }
interface WorkflowRecord { readonly id: string; readonly state: string; readonly version: number; }
interface WorkItemRecord { readonly id: string; readonly workflowInstanceId: string; readonly version: number; }
interface MyWorkEntry { readonly workItem: WorkItemRecord; readonly workflow: WorkflowRecord; readonly request: TravelRequestRecord; }
interface NotificationRecord { readonly id: string; readonly notificationType: string; readonly actionTarget: string | null; readonly version: number; readonly readAt: string | null; readonly createdAt: string; }
interface TimelineActivity { readonly id: string; readonly activityType: string; readonly occurredAt: string; }
interface SearchResultRecord { readonly resourceType: string; readonly resourceId: string; readonly category: string; readonly title: string; readonly snippet?: string; readonly actionTarget?: string; }
interface CompanyAnnouncement { readonly id: string; readonly title: string; readonly body: string; readonly authorId: string; readonly publishedAt: string; }

const HOME_HINTS: Record<string, { role: string; hint: string }> = {
  "workhub-demo-haru": { role: "新入社員", hint: "Onboarding / 必須研修" },
  "workhub-demo-aoi": { role: "一般社員", hint: "MY WORK / 申請" },
  "workhub-demo-ren": { role: "Manager", hint: "承認Task / Team" },
  "workhub-demo-mei": { role: "経理", hint: "経費確認Queue" },
  "workhub-demo-sora": { role: "人事 / 総務", hint: "人事・総務Task" },
  "workhub-demo-kai": { role: "System Admin", hint: "System Administration" },
};
const NOTIFICATION_LABELS: Record<string, string> = { "workflow.approval_requested": "出張申請の承認依頼が届きました", "workflow.returned": "出張申請が差し戻されました", "workflow.approved": "出張申請が承認されました", "workflow.rejected": "出張申請が却下されました" };
const TIMELINE_LABELS: Record<string, string> = { "workflow.submitted": "申請しました", "workflow.returned": "差し戻されました", "workflow.resubmitted": "再申請しました", "workflow.approved": "承認されました", "workflow.rejected": "却下されました", "workflow.withdrawn": "取り下げました" };
const REMEMBERED_USER_ID_KEY = "workhub.rememberedUserId";
const readRememberedUserId = (): string => { try { return localStorage.getItem(REMEMBERED_USER_ID_KEY) ?? ""; } catch { return ""; } };
const persistRememberedUserId = (remember: boolean, userId: string): void => { try { if (remember) localStorage.setItem(REMEMBERED_USER_ID_KEY, userId); else localStorage.removeItem(REMEMBERED_USER_ID_KEY); } catch { /* browser storage is optional */ } };
const loginFailureMessage = (status: number): string => status === 401 ? "ユーザーIDまたはパスワードを確認してください。" : status === 429 ? "ログイン試行が一時的に制限されています。しばらくしてから再度お試しください。" : status === 400 || status === 413 || status === 415 ? "入力内容を確認してください。" : "現在ログインできません。時間をおいて再度お試しください。";

async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers); headers.set("accept", "application/json"); if (init?.body) headers.set("content-type", "application/json");
  if (init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())) { const csrfResponse = await fetch("/api/auth/csrf", { credentials: "same-origin" }); if (!csrfResponse.ok) throw new Error("CSRF token unavailable"); const csrfPayload = await csrfResponse.json() as { csrfToken: string }; headers.set("x-csrf-token", csrfPayload.csrfToken); }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: { message?: string } }; throw new Error(payload.error?.message ?? `Request failed (${response.status})`); }
  return response.json() as Promise<T>;
}

function Brand() { return <div className="workhub-brand" aria-label="WORKHUB CECIL WORKS Digital Workplace"><div className="workhub-logo" aria-hidden="true">W</div><div><div className="workhub-brand-name">WORKHUB</div><div className="workhub-brand-subtitle">CECIL WORKS Digital Workplace</div></div></div>; }
interface PersonaDialogProps { readonly personas: DemoPersona[]; readonly onSelect: (persona: DemoPersona) => void; readonly onClose: () => void; }
function PersonaDialog({ personas, onSelect, onClose }: PersonaDialogProps) { useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onClose]); return <div className="workhub-dialog-backdrop" onMouseDown={onClose}><section className="workhub-dialog" role="dialog" aria-modal="true" aria-labelledby="persona-dialog-title" onMouseDown={(event) => event.stopPropagation()}><div className="workhub-dialog-heading"><div><p className="workhub-eyebrow">REFERENCE PERSONA</p><h2 id="persona-dialog-title">デモユーザを選ぶ</h2></div><button className="workhub-icon-button" type="button" onClick={onClose} aria-label="閉じる">×</button></div><p className="workhub-muted">Personaを選ぶとUser IDとデモ用Passwordを入力します。認証は省略せず、最後に「ログイン」を押してください。</p><div className="workhub-persona-list">{personas.map((persona) => <button className="workhub-persona-card" type="button" key={persona.key} onClick={() => onSelect(persona)}><span className="workhub-persona-avatar" aria-hidden="true">{persona.displayName.slice(0, 1)}</span><span className="workhub-persona-copy"><strong>{persona.displayName}</strong><span>{persona.roleLabel}</span><small>{persona.homeHint}</small></span><span className="workhub-persona-id">{persona.userId}</span></button>)}</div></section></div>; }

function LoginScreen() {
  const auth = useAuth(); const remembered = useMemo(readRememberedUserId, []); const [userId, setUserId] = useState(remembered); const [password, setPassword] = useState(""); const [remember, setRemember] = useState(remembered.length > 0); const [submitting, setSubmitting] = useState(false); const [message, setMessage] = useState<string | null>(null); const [demoConfig, setDemoConfig] = useState<DemoConfig>({ demoEnabled: false, personas: [] }); const [configStatus, setConfigStatus] = useState<"loading" | "ready" | "error">("loading"); const [personaOpen, setPersonaOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const loadAuthMode = async () => {
      try {
        const response = await fetch("/api/workhub/demo-config", {
          method: "GET",
          headers: { accept: "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("workhub_auth_mode_unavailable");
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new Error("workhub_auth_mode_invalid");
        }
        const config = payload as Partial<DemoConfig>;
        let nextConfig: DemoConfig;
        if (config.authMode === "google_oidc") {
          nextConfig = { authMode: "google_oidc", oidcEnabled: config.oidcEnabled === true, demoEnabled: false, personas: [] };
        } else {
          if (config.authMode !== undefined || typeof config.demoEnabled !== "boolean"
            || !Array.isArray(config.personas)) {
            throw new Error("workhub_auth_mode_invalid");
          }
          const personas = config.personas.filter((item): item is DemoPersona => {
            if (!item || typeof item !== "object") return false;
            const candidate = item as Partial<DemoPersona>;
            return [candidate.key, candidate.userId, candidate.displayName, candidate.roleLabel, candidate.homeHint]
              .every((value) => typeof value === "string" && value.length > 0 && value.length <= 200);
          });
          nextConfig = {
            demoEnabled: config.demoEnabled,
            personas: config.demoEnabled ? personas : [],
            ...(config.demoEnabled && typeof config.demoPassword === "string" && config.demoPassword.length <= 256
              ? { demoPassword: config.demoPassword } : {}),
          };
        }
        if (controller.signal.aborted) return;
        setDemoConfig(nextConfig);
        setConfigStatus("ready");
      } catch (caught) {
        if (controller.signal.aborted || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setConfigStatus("error");
      }
    };
    void loadAuthMode();
    return () => controller.abort();
  }, []);
  const choosePersona = (persona: DemoPersona) => { setUserId(persona.userId); setPassword(demoConfig.demoPassword ?? ""); setMessage(null); setPersonaOpen(false); };
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (submitting || configStatus !== "ready" || demoConfig.authMode === "google_oidc") return; setSubmitting(true); setMessage(null); try { const response = await fetch("/api/auth/login", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ userId, password, remember }) }); if (!response.ok) { setMessage(loginFailureMessage(response.status)); return; } persistRememberedUserId(remember, userId); setPassword(""); const synchronized = await auth.synchronize(); if (synchronized.status !== "authenticated") setMessage("ログイン状態を確認できませんでした。もう一度お試しください。"); } catch { setMessage("現在ログインできません。ネットワーク状態を確認してください。"); } finally { setSubmitting(false); } };
  return <main className="workhub-login-shell"><section className="workhub-login-story" aria-label="WORKHUB紹介"><div className="workhub-story-content"><Brand /><p className="workhub-story-kicker">CECIL WORKS INTERNAL PORTAL</p><h1>仕事の入口を、ひとつに。</h1><p className="workhub-story-lead">社内システムの名前ではなく、「何をしたいか」から仕事を始めるためのDigital Workplaceです。</p><div className="workhub-story-grid" aria-hidden="true"><span>MY WORK</span><span>REQUESTS</span><span>PEOPLE</span><span>DOCUMENTS</span></div></div></section><section className="workhub-login-panel" aria-labelledby="login-title"><div className="workhub-login-card"><div className="workhub-mobile-brand"><Brand /></div><p className="workhub-eyebrow">EMPLOYEE SIGN IN</p><h2 id="login-title">WORKHUBにログイン</h2><p className="workhub-muted">CECIL WORKSの社内ポータルへアクセスします。</p>{demoConfig.demoEnabled && <div className="workhub-demo-note" role="note"><strong>Reference Demo</strong><span>この環境ではデモ用Credentialを利用できます。本番用の認証情報ではありません。</span></div>}{configStatus !== "ready" ? <div className="workhub-login-form"><p role="status">{configStatus === "loading" ? "認証方式を確認しています…" : "認証設定を確認できません。時間をおいて再読み込みしてください。"}</p></div> : demoConfig.authMode === "google_oidc" ? <div className="workhub-login-form"><div className="workhub-demo-note" role="note"><strong>Google認証</strong><span>この環境では登録済みの外部アカウントでログインします。</span></div>{demoConfig.oidcEnabled ? <a className="workhub-primary-button" href="/api/auth/oidc/start">Googleでログイン</a> : <p role="status">外部認証の設定を確認しています。管理者にお問い合わせください。</p>}</div> : <form className="workhub-login-form" onSubmit={submit}><label><span>ユーザーID</span><input name="userId" autoComplete="username" value={userId} onChange={(event) => setUserId(event.target.value)} required maxLength={254} disabled={submitting} /></label><label><span>パスワード</span><input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={1024} disabled={submitting} /></label><label className="workhub-remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={submitting} /><span>ログイン情報を保持する<small>この端末にはユーザーIDだけを保存し、Passwordは保存しません。</small></span></label>{message && <div className="workhub-login-error" role="alert">{message}</div>}<button className="workhub-primary-button" type="submit" disabled={submitting}>{submitting ? "確認しています…" : "ログイン"}</button>{demoConfig.demoEnabled && demoConfig.personas.length > 0 && <button className="workhub-secondary-button" type="button" onClick={() => setPersonaOpen(true)} disabled={submitting}>デモユーザを選ぶ</button>}</form>}<p className="workhub-login-footer"><a href="/showcase">WORKHUB Showcaseを見る ↗</a><br />CECIL WORKS Inc. · Reference Application</p></div></section>{personaOpen && <PersonaDialog personas={demoConfig.personas} onSelect={choosePersona} onClose={() => setPersonaOpen(false)} />}</main>;
}

function TravelWorkspace() {
  const auth = useAuth(); const user = auth.user; const isAoi = user?.id === "workhub-demo-aoi"; const isRen = user?.id === "workhub-demo-ren"; const canPublishAnnouncements = user?.id === "workhub-demo-sora"; const reference = user ? HOME_HINTS[user.id] : undefined;
  const [offices, setOffices] = useState<OfficeOption[]>([]); const [myWork, setMyWork] = useState<MyWorkEntry[]>([]); const [myWorkState, setMyWorkState] = useState<"loading" | "ready" | "error">("loading"); const [returnReasons, setReturnReasons] = useState<Record<string, string>>({}); const [myRequests, setMyRequests] = useState<UnifiedMyRequest[]>([]); const [journeyTravelId, setJourneyTravelId] = useState<string | null>(null); const [announcements, setAnnouncements] = useState<CompanyAnnouncement[]>([]); const [announcementLoad, setAnnouncementLoad] = useState<"loading" | "ready" | "error">("loading"); const [announcementTitle, setAnnouncementTitle] = useState(""); const [announcementBody, setAnnouncementBody] = useState(""); const [myRequestsState, setMyRequestsState] = useState<"loading" | "ready" | "error">("loading"); const [notifications, setNotifications] = useState<NotificationRecord[]>([]); const [unreadCount, setUnreadCount] = useState(0); const [notificationState, setNotificationState] = useState<"loading" | "ready" | "error">("loading"); const [selectedRequest, setSelectedRequest] = useState<TravelRequestRecord | null>(null); const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRecord | null>(null); const [returnComment, setReturnComment] = useState<string | null>(null); const [timeline, setTimeline] = useState<TimelineActivity[]>([]); const [destinationOfficeItemId, setDestinationOfficeItemId] = useState(""); const [startDate, setStartDate] = useState("2026-10-12"); const [endDate, setEndDate] = useState("2026-10-13"); const [purpose, setPurpose] = useState("東京での顧客打ち合わせ"); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [searchText, setSearchText] = useState(""); const [searchResults, setSearchResults] = useState<SearchResultRecord[]>([]); const [searching, setSearching] = useState(false);
  const loadNotifications = useCallback(async () => {
    setNotificationState("loading");
    try {
      const [list, count] = await Promise.all([
        apiJson<{ items: NotificationRecord[] }>("/api/workhub/notifications"),
        apiJson<{ unreadCount: number }>("/api/workhub/notifications/unread-count"),
      ]);
      setNotifications(list.items);
      setUnreadCount(count.unreadCount);
      setNotificationState("ready");
    } catch {
      setNotificationState("error");
    }
  }, []);
  const loadMyWork = useCallback(async () => { if (!isRen) return; setMyWorkState("loading"); try { const result = await apiJson<{ items: MyWorkEntry[] }>("/api/workhub/my-work"); setMyWork(result.items); setMyWorkState("ready"); } catch { setMyWorkState("error"); } }, [isRen]);
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementLoad("loading");
    try {
      const result = await apiJson<{ items: CompanyAnnouncement[] }>("/api/workhub/announcements");
      setAnnouncements(result.items);
      setAnnouncementLoad("ready");
    } catch {
      setAnnouncementLoad("error");
    }
  }, []);
  const loadMyRequests = useCallback(async () => { if (!isAoi) return; setMyRequestsState("loading"); try { const result = await apiJson<{ items: UnifiedMyRequest[] }>("/api/workhub/my-requests"); setMyRequests(result.items); setMyRequestsState("ready"); } catch { setMyRequestsState("error"); } }, [isAoi]);
  const openRequest = useCallback(async (id: string) => { const detail = await apiJson<{ request: TravelRequestRecord; workflow: WorkflowRecord | null; returnComment: string | null }>(`/api/workhub/travel-requests/${encodeURIComponent(id)}`); const history = await apiJson<{ items: TimelineActivity[] }>(`/api/workhub/travel-requests/${encodeURIComponent(id)}/timeline`); setSelectedRequest(detail.request); setSelectedWorkflow(detail.workflow); setReturnComment(detail.workflow?.state === "awaiting_resubmission" ? detail.returnComment : null); setTimeline(history.items ?? []); setDestinationOfficeItemId(detail.request.destinationOfficeItemId); setStartDate(detail.request.startDate); setEndDate(detail.request.endDate); setPurpose(detail.request.purpose); return detail; }, []);
  useEffect(() => { void Promise.all([apiJson<{ items: OfficeOption[] }>("/api/workhub/offices").then((result) => { setOffices(result.items); setDestinationOfficeItemId((current) => current || result.items[0]?.itemId || ""); }), loadNotifications(), loadMyWork(), loadMyRequests(), loadAnnouncements()]).catch(() => setMessage("WORKHUBの業務データを読み込めませんでした。")); }, [loadMyWork, loadMyRequests, loadNotifications, loadAnnouncements]);
  const run = async (operation: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(null); try { await operation(); } catch (caught) { setMessage(caught instanceof Error ? caught.message : "処理に失敗しました。"); } finally { setBusy(false); } };
  const publishAnnouncement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPublishAnnouncements || !announcementTitle.trim() || !announcementBody.trim()) return;
    void run(async () => {
      await apiJson("/api/workhub/announcements", {
        method: "POST",
        body: JSON.stringify({ title: announcementTitle, body: announcementBody }),
      });
      setAnnouncementTitle("");
      setAnnouncementBody("");
      await loadAnnouncements();
      setMessage("社内お知らせを公開しました。");
    });
  };
  const createAndSubmit = () => void run(async () => { const created = await apiJson<{ request: TravelRequestRecord }>("/api/workhub/travel-requests", { method: "POST", body: JSON.stringify({ destinationOfficeItemId, startDate, endDate, purpose }) }); const submitted = await apiJson<{ request: TravelRequestRecord }>(`/api/workhub/travel-requests/${created.request.id}/submit`, { method: "POST", body: JSON.stringify({ expectedVersion: created.request.version }) }); await openRequest(submitted.request.id); await Promise.all([loadNotifications(), loadMyRequests()]); setMessage("出張申請を提出しました。"); });
  const updateAndResubmit = () => void run(async () => { if (!selectedRequest || !selectedWorkflow) return; const updated = await apiJson<{ request: TravelRequestRecord }>(`/api/workhub/travel-requests/${selectedRequest.id}`, { method: "PUT", body: JSON.stringify({ expectedVersion: selectedRequest.version, destinationOfficeItemId, startDate, endDate, purpose }) }); await apiJson(`/api/workhub/travel-requests/${selectedRequest.id}/resubmit`, { method: "POST", body: JSON.stringify({ expectedRequestVersion: updated.request.version, expectedWorkflowVersion: selectedWorkflow.version }) }); await openRequest(selectedRequest.id); await Promise.all([loadNotifications(), loadMyRequests()]); setMessage("出張申請を再申請しました。"); });
  const decide = (entry: MyWorkEntry, action: "approve" | "return") => { const comment = returnReasons[entry.workItem.id]?.trim() ?? ""; if (action === "return" && !comment) { setMessage("差戻し理由を入力してください。"); return; } void run(async () => { await apiJson(`/api/workhub/workflows/${entry.workflow.id}/${action}`, { method: "POST", body: JSON.stringify({ expectedInstanceVersion: entry.workflow.version, expectedWorkItemVersion: entry.workItem.version, ...(action === "return" ? { reasonCode: "correction_required", comment } : {}) }) }); await loadMyWork(); await loadNotifications(); setMessage(action === "approve" ? "承認しました。" : "差し戻しました。"); }); };
  const openNotification = (notification: NotificationRecord) => void run(async () => { if (!notification.readAt) await apiJson(`/api/workhub/notifications/${notification.id}/read`, { method: "POST", body: JSON.stringify({ expectedVersion: notification.version }) }); const target = notification.actionTarget?.match(/^resource:travel_request:(.+)$/u)?.[1]; if (target && isAoi) await openRequest(target); await loadNotifications(); });
  const search = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const query = searchText.trim(); if (!query || searching) return; setSearching(true); setMessage(null); try { const response = await apiJson<{ results: SearchResultRecord[] }>(`/api/workhub/search?q=${encodeURIComponent(query)}`); setSearchResults(response.results); } catch (caught) { setMessage(caught instanceof Error ? caught.message : "検索に失敗しました。"); } finally { setSearching(false); } };
  const openSearchResult = (result: SearchResultRecord) => void run(async () => { if (result.resourceType === "travel_request") await openRequest(result.resourceId); });
  const selectMyRequest = (request: UnifiedMyRequest) => {
    if (request.kind === "expense") {
      // ExpenseWorkspace owns the correction form and fetches its data from
      // the expense domain. The unified projection is only an entry point.
      const openExpense = () => {
        const target = document.getElementById(`workhub-expense-${request.id}`)
          ?? document.getElementById("workhub-expenses");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target?.id !== "workhub-expenses") target?.focus({ preventScroll: true });
      };
      requestAnimationFrame(openExpense);
      return;
    }
    void run(async () => {
      // Always re-read authoritative request/workflow before editing.
      const detail = await openRequest(request.id);
      const isStillReturned = detail.request.status === "submitted"
        && detail.workflow?.state === "awaiting_resubmission";
      if (request.status === "action_required" && !isStillReturned) {
        setMessage("申請状況が更新されています。最新の状態を確認してください。");
        await loadMyRequests();
      }
      requestAnimationFrame(() => {
        const target = document.getElementById(isStillReturned ? "workhub-travel-purpose" : "workhub-request-detail");
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        if (isStillReturned) target.focus({ preventScroll: true });
      });
    });
  };
  const awaitingResubmission = selectedWorkflow?.state === "awaiting_resubmission";
  const pendingMyRequests = listActionRequiredMyRequests(myRequests);
  const homeWorkCount: number | null = isRen ? (myWorkState === "ready" ? myWork.length : null) : isAoi ? (myRequestsState === "ready" ? pendingMyRequests.length : null) : null;
  // Print the authoritative current request, not unsaved form fields.
  // This is a browser print/PDF-save view, NOT a historical approved artifact.
  const printTravelRequest = () => void run(async () => {
    if (!selectedRequest) return;
    const detail = await openRequest(selectedRequest.id);
    if (detail.request.status !== "submitted") throw new Error("提出済みの申請だけ印刷できます。");
    requestAnimationFrame(() => window.print());
  });
  return <div className="workhub-home-shell">
    <header className="workhub-home-header">
      <Brand />
      <form className="workhub-global-search" onSubmit={search} role="search">
        <label className="workhub-sr-only" htmlFor="workhub-global-search">WORKHUBを検索</label>
        <input id="workhub-global-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="社内の情報を検索" />
        <button type="submit" disabled={searching || !searchText.trim()} aria-label="検索">{searching ? "…" : "⌕"}</button>
      </form>
      <div className="workhub-header-actions" aria-label="グローバル操作">
        <button className="workhub-header-action" type="button" aria-label="Ask CECIL">Ask CECIL</button>
        <a className="workhub-header-action workhub-header-icon" href="#workhub-notifications" aria-label={notificationState === "ready" ? `通知 未読${unreadCount}件` : "通知 取得状況を確認"}>🔔{notificationState === "ready" && <span className="workhub-notification-badge">{unreadCount}</span>}</a>
        <a className="workhub-header-action workhub-header-icon" href="#workhub-apps" aria-label="アプリ一覧">▦</a>
        <div className="workhub-user-chip"><span className="workhub-user-dot" aria-hidden="true" /><span><strong>{user?.displayName ?? "CECIL WORKS User"}</strong><small>{reference?.role ?? "Authenticated User"}</small></span></div>
        <AccountSwitchButton />
      </div>
    </header>
    <div className="workhub-portal-layout">
      <nav className="workhub-side-nav" aria-label="WORKHUB メインナビゲーション">
        <a className="is-active" href="#workhub-home" aria-current="page"><span aria-hidden="true">⌂</span>ホーム</a>
        <a href="#workhub-my-work"><span aria-hidden="true">✓</span>MY WORK</a>
        <a href="#workhub-requests"><span aria-hidden="true">▤</span>申請・手続き</a>
        {isAoi && <a href="#workhub-my-requests"><span aria-hidden="true">☷</span>自分の申請一覧</a>}
        {(isAoi || user?.id === "workhub-demo-mei") && <a href="#workhub-expenses"><span aria-hidden="true">¥</span>交通費・経費精算</a>}
        <a href="#workhub-apps"><span aria-hidden="true">▦</span>アプリ</a>
        <span className="workhub-nav-coming" aria-disabled="true"><span aria-hidden="true">♙</span>組織・人</span>
        <span className="workhub-nav-coming" aria-disabled="true"><span aria-hidden="true">▱</span>ナレッジ</span>
        <a href="#workhub-announcements"><span aria-hidden="true">◌</span>社内お知らせ</a>
        <div className="workhub-side-nav-spacer" />
        <span className="workhub-nav-coming" aria-disabled="true"><span aria-hidden="true">?</span>サポート</span>
      </nav>
      <main className="workhub-home-main" id="workhub-home">
        <section className="workhub-home-hero" aria-labelledby="workhub-home-title">
          <img src="/images/workhub/workhub-top-hero.jpg" alt="WORKHUB Digital Workplaceのトップビジュアル" />
          <div className="workhub-home-hero-copy">
            <p className="workhub-eyebrow">CECIL WORKS DIGITAL WORKPLACE</p>
            <h1 id="workhub-home-title">おはようございます、{user?.displayName ?? "ユーザー"}さん</h1>
            <p>仕事の入口を、ひとつに。今日やることから始めましょう。</p>
          </div>
        </section>
        {message && <div className="workhub-demo-note" role="status"><strong>WORKHUB</strong><span>{message}</span></div>}
        {searchText.trim() && !searching && <section className="workhub-search-panel workhub-global-search-results" aria-live="polite" aria-label="検索結果">
          {searchResults.length === 0 ? <p>該当する検索結果はありません。</p> : <div className="workhub-search-results">
            {searchResults.map(result => {
              const key = `${result.resourceType}:${result.resourceId}`;
              const internalAppTarget = result.resourceType === "workhub_app"
                && /^\/(?:#workhub-[a-z-]+|admin)$/u.test(result.actionTarget ?? "")
                  ? result.actionTarget : null;
              const content = <><strong>{result.title}</strong>{result.snippet && <span>{result.snippet}</span>}<small>{result.category === "apps" ? "アプリ" : result.category}</small></>;
              return internalAppTarget
                ? <a key={key} className="workhub-search-result" href={internalAppTarget}>{content}</a>
                : <button key={key} type="button" className="workhub-search-result" onClick={() => openSearchResult(result)} disabled={result.resourceType === "workhub_app"}>{content}</button>;
            })}
          </div>}
        </section>}
        <section className="workhub-dashboard-row" id="workhub-my-work" aria-label="今日の仕事">
          <article className="workhub-dashboard-card workhub-my-work-summary">
            <div className="workhub-section-heading"><div><span className="workhub-card-label">MY WORK</span><h2>今日対応すること</h2></div><span className="workhub-summary-count">{homeWorkCount ?? "—"}</span></div>
            {isRen ? (
              myWorkState === "loading" ? <p role="status">承認タスクを読み込んでいます…</p>
              : myWorkState === "error" ? <div role="alert"><p>承認タスクを取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadMyWork()}>再読み込み</button></div>
              : myWork.length === 0 ? <p className="workhub-empty-state">現在、対応が必要なタスクはありません。</p> : <div className="workhub-task-list">{myWork.slice(0, 3).map((entry) => <div className="workhub-task-item" key={entry.workItem.id}><strong>{entry.request.purpose}</strong><span>{entry.request.startDate} → {entry.request.endDate}</span><label className="workhub-return-reason-input">差戻し理由<textarea aria-label={`${entry.request.purpose}の差戻し理由`} value={returnReasons[entry.workItem.id] ?? ""} onChange={(event) => setReturnReasons((current) => ({ ...current, [entry.workItem.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="修正してほしい箇所を具体的に入力" disabled={busy} /></label><div className="workhub-inline-actions"><button className="workhub-secondary-button" type="button" disabled={busy} onClick={() => decide(entry, "return")}>差し戻す</button><button className="workhub-primary-button" type="button" disabled={busy} onClick={() => decide(entry, "approve")}>承認する</button></div></div>)}</div>
            ) : isAoi ? (
              myRequestsState === "loading" ? <p role="status">対応が必要な申請を確認しています…</p>
              : myRequestsState === "error" ? <div role="alert"><p>申請状況を取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadMyRequests()}>再読み込み</button></div>
              : pendingMyRequests.length === 0 ? <p className="workhub-empty-state">直近の申請に対応が必要なものはありません。</p>
              : <div className="workhub-task-list">{pendingMyRequests.slice(0, 3).map(request =>
                  <button key={`${request.kind}:${request.id}`} type="button" className="workhub-work-link" disabled={busy} onClick={() => selectMyRequest(request)}>
                    <strong>{request.kind === "travel" ? "出張申請の修正" : "経費精算の修正"}：{request.title}</strong>
                    <span>{request.returnReason?.trim() || "差戻し内容を確認して再申請してください"}</span>
                  </button>
                )}<small className="workhub-reference-note">直近20件の申請から要対応を表示しています。すべての履歴の総件数ではありません。</small></div>
            ) : user?.id === "workhub-demo-mei" ? (
              <div className="workhub-task-list"><p>経費確認はこちらから行えます。処理待ち件数はHOMEでは取得していません。</p><a className="workhub-work-link" href="#workhub-expenses">経費確認画面を開く →</a></div>
            ) : canPublishAnnouncements ? (
              <div className="workhub-task-list"><p>社内お知らせの公開・確認はこちらから行えます。未処理件数の集計ではありません。</p><a className="workhub-work-link" href="#workhub-announcements">社内お知らせを管理する →</a></div>
            ) : user?.id === "workhub-demo-kai" ? (
              <div className="workhub-task-list"><p>システムの運用状況はこちらから確認できます。未処理タスクの件数ではありません。</p><a className="workhub-work-link" href="/admin">管理ポータルを開く →</a></div>
            ) : <p className="workhub-empty-state">このデモ利用者向けの対応タスクはまだ接続されていません。お知らせとアプリ一覧を利用できます。</p>}
          </article>
          <article className="workhub-dashboard-card workhub-today-card">
            <span className="workhub-card-label">TODAY</span><h2>今日の予定</h2>
            <div className="workhub-today-list"><div><strong>勤務</strong><span>名古屋オフィス</span></div><div><strong>予定</strong><span>{selectedRequest ? `${selectedRequest.startDate} → ${selectedRequest.endDate} 出張予定` : "登録された出張予定はありません"}</span></div></div>
            <small className="workhub-reference-note">Reference data / Adapter projection</small>
          </article>
        </section>
        <section className="workhub-quick-actions" aria-labelledby="workhub-quick-actions-title">
          <div className="workhub-section-heading"><div><span className="workhub-card-label">QUICK ACTIONS</span><h2 id="workhub-quick-actions-title">何をしたいですか？</h2></div></div>
          <div className="workhub-quick-action-grid">
            <button type="button" disabled={!isAoi} onClick={() => document.getElementById("workhub-requests")?.scrollIntoView({ behavior: "smooth" })}><span aria-hidden="true">✈</span><strong>出張したい</strong><small>{isAoi ? "申請を始める" : "一般社員向けのデモ"}</small></button>
            <button type="button" disabled={!isAoi && user?.id !== "workhub-demo-mei"} onClick={() => document.getElementById("workhub-expenses")?.scrollIntoView({ behavior: "smooth" })}><span aria-hidden="true">¥</span><strong>{user?.id === "workhub-demo-mei" ? "経費を確認したい" : "経費を精算したい"}</strong><small>{isAoi || user?.id === "workhub-demo-mei" ? "経費画面へ" : "利用できるデモ権限がありません"}</small></button>
            <button type="button" disabled><span aria-hidden="true">⌂</span><strong>引っ越した</strong><small>Showcase準備中</small></button>
            <button type="button" disabled><span aria-hidden="true">▣</span><strong>PCを交換したい</strong><small>Showcase準備中</small></button>
          </div>
        </section>
        <WorkhubAppLauncher />
        {isAoi && <section className="workhub-my-requests" id="workhub-my-requests" aria-labelledby="workhub-my-requests-title">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">MY REQUESTS</span><h2 id="workhub-my-requests-title">自分の申請一覧</h2></div>
            <button type="button" className="workhub-secondary-button" onClick={() => void loadMyRequests()} disabled={myRequestsState === "loading"}>一覧を更新</button>
          </div>
          <p className="workhub-reference-note">出張申請と経費精算の進捗を、更新日時順にまとめて確認できます。</p>
          {myRequestsState === "loading" ? <p role="status">申請を読み込んでいます…</p> :
            myRequestsState === "error" ? <div role="alert"><p>申請一覧を取得できませんでした。申請が0件とは限りません。</p><button type="button" className="workhub-secondary-button" onClick={() => void loadMyRequests()}>再読み込み</button></div> :
              myRequests.length === 0 ? <p className="workhub-empty-state">申請はまだありません。「出張したい」や「交通費・経費精算」から開始できます。</p> :
                <div className="workhub-my-requests-list">{myRequests.map((request) =>
                  <article className="workhub-journey-entry" key={`${request.kind}:${request.id}`}>
                  <button className={`workhub-my-request-item ${request.status === "action_required" ? "is-returned" : ""}`}
                    type="button" disabled={busy} onClick={() => selectMyRequest(request)}>
                    <span className="workhub-request-kind">{request.kind === "travel" ? "出張申請" : "経費精算"}</span>
                    <strong>{request.title}</strong>
                    <span>{request.subtitle}</span>
                    {request.amountYen !== null && <span>合計 {request.amountYen.toLocaleString("ja-JP")}円</span>}
                    <small className="workhub-request-status">{request.statusLabel}</small>
                    {request.kind === "travel" && request.journey && <span className="workhub-journey-progress" aria-label="出張から経費精算までの進捗">
                      <span>① 出張申請：{request.journey.travelStage}</span>
                      <span>② 紐づく経費精算：{request.journey.settlementStage}</span>
                    </span>}
                    {request.status === "action_required" && <span className="workhub-request-return-comment"><span>差戻し理由：</span>{request.returnReason?.trim() || "理由の記載がありません。担当者に確認してください。"}</span>}
                    <span className="workhub-request-next-action">{request.kind === "travel" ? request.status === "action_required" ? "選択して修正・再申請する →" : "申請内容・履歴を確認する →" : request.status === "action_required" ? "精算の修正画面へ →" : "精算の明細を確認する →"}</span>
                  </button>
                  {request.kind === "travel" && request.status === "completed" && request.journey?.linkedClaimCount === 0 &&
                    <button className="workhub-journey-expense-action" type="button" onClick={() => {
                      setJourneyTravelId(request.id);
                      requestAnimationFrame(() => document.getElementById("workhub-expenses")?.scrollIntoView({ behavior: "smooth", block: "center" }));
                    }}>この出張の経費精算を始める →</button>}
                  </article>)}</div>}
          <small className="workhub-reference-note">自分の申請を最大20件表示。進捗はこの出張に明示的に紐づけた精算のみを集計し、支払完了は意味しません。状態は一覧更新で再取得します。</small>
        </section>}
        <section className="workhub-home-grid" id="workhub-requests" aria-label="出張申請 Reference Scenario">
          {isAoi && <article className="workhub-home-card workhub-home-card-primary" id="workhub-travel-form"><span className="workhub-card-label">REQUESTS / 出張したい</span><h2>{awaitingResubmission ? "出張申請を修正" : "出張申請"}</h2>{awaitingResubmission && <div className="workhub-return-reason" role="note"><strong>差戻し理由</strong><p>{returnComment?.trim() || "理由の記載がありません。承認者に確認してください。"}</p></div>}<div className="workhub-business-form"><label>行先<select aria-label="行先" value={destinationOfficeItemId} onChange={(event) => setDestinationOfficeItemId(event.target.value)}>{offices.map((office) => <option key={office.itemId} value={office.itemId}>{office.label} ({office.code})</option>)}</select></label><label>開始日<input aria-label="開始日" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>終了日<input aria-label="終了日" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><label>目的<textarea id="workhub-travel-purpose" aria-label="目的" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>{awaitingResubmission ? <button className="workhub-primary-button" type="button" disabled={busy} onClick={updateAndResubmit}>修正して再申請</button> : <button className="workhub-primary-button" type="button" disabled={busy} onClick={createAndSubmit}>出張申請を提出</button>}</div></article>}
          <article className="workhub-home-card" id="workhub-notifications"><span className="workhub-card-label">NOTIFICATIONS</span><h2>通知 {notificationState === "ready" && unreadCount > 0 ? `(${unreadCount})` : ""}</h2>{
            notificationState === "loading" ? <p role="status">通知を確認しています…</p>
            : notificationState === "error" ? <div role="alert"><p>通知を取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadNotifications()}>通知を再読み込み</button></div>
            : notifications.length === 0 ? <p className="workhub-empty-state">通知はありません。</p>
            : <div className="workhub-notification-list">{notifications.slice(0, 4).map(notification =>
              <button key={notification.id} type="button" className={`workhub-notification-item ${notification.readAt ? "is-read" : ""}`} onClick={() => openNotification(notification)}>
                <strong>{NOTIFICATION_LABELS[notification.notificationType] ?? notification.notificationType}</strong>
                <small>{new Date(notification.createdAt).toLocaleString("ja-JP")}</small>
              </button>
            )}</div>
          }</article>
          {selectedRequest && <article className="workhub-home-card" id="workhub-request-detail"><span className="workhub-card-label">MY REQUEST DETAIL</span><h2>{selectedRequest.purpose}</h2><p>{selectedRequest.startDate} → {selectedRequest.endDate}</p><p>Workflow: <strong>{selectedWorkflow?.state ?? selectedRequest.status}</strong></p>{isAoi && selectedRequest.status === "submitted" && <div className="workhub-travel-print-action">
              <button className="workhub-secondary-button" type="button" disabled={busy} onClick={printTravelRequest}>申請内容を印刷・PDF保存</button>
              <small>ブラウザの印刷画面からPDF保存できます。承認結果の履歴固定PDFではありません。</small>
            </div>}<div className="workhub-timeline" aria-label="申請履歴">{timeline.length === 0 ? <p>履歴はまだありません。</p> : timeline.map((activity) => <div key={activity.id} className="workhub-timeline-item"><strong>{TIMELINE_LABELS[activity.activityType] ?? activity.activityType}</strong><small>{new Date(activity.occurredAt).toLocaleString("ja-JP")}</small></div>)}</div></article>}
          {!isAoi && !isRen && <article className="workhub-home-card workhub-home-card-primary"><span className="workhub-card-label">あなたの優先エリア</span><h2>{reference?.hint ?? "MY WORK"}</h2><p>このReferenceではPersonaごとにHOMEの優先領域を変えます。</p></article>}
        </section>
        <ExpenseWorkspace principalId={user?.id ?? ""} selectedTravelRequestId={journeyTravelId} onChanged={() => void loadMyRequests()} />
        <section className="workhub-announcements" id="workhub-announcements" aria-labelledby="workhub-announcements-title">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">COMPANY ANNOUNCEMENTS</span><h2 id="workhub-announcements-title">社内お知らせ</h2></div>
            <button type="button" className="workhub-secondary-button" onClick={() => void loadAnnouncements()} disabled={announcementLoad === "loading"}>お知らせを更新</button>
          </div>
          <p className="workhub-announcements-intro">会社からの公式連絡です。申請の状態変化を伝える個人宛て通知とは別に表示しています。</p>
          {canPublishAnnouncements && <form className="workhub-announcement-compose" onSubmit={publishAnnouncement} aria-label="社内お知らせを登録">
            <h3>お知らせを公開する（総務担当）</h3>
            <label>件名<input aria-label="お知らせの件名" value={announcementTitle} maxLength={120} required onChange={(event) => setAnnouncementTitle(event.target.value)} /></label>
            <label>本文<textarea aria-label="お知らせの本文" value={announcementBody} maxLength={2000} required rows={3} onChange={(event) => setAnnouncementBody(event.target.value)} /></label>
            <button className="workhub-primary-button" type="submit" disabled={busy || !announcementTitle.trim() || !announcementBody.trim()}>お知らせを公開</button>
          </form>}
          {announcementLoad === "loading" ? <p role="status">お知らせを読み込んでいます…</p> :
            announcementLoad === "error" ? <div role="alert">お知らせを読み込めませんでした。<button className="workhub-secondary-button" type="button" onClick={() => void loadAnnouncements()}>再読み込み</button></div> :
              announcements.length === 0 ? <p className="workhub-empty-state">現在公開されているお知らせはありません。</p> :
                <div className="workhub-announcement-list">{announcements.map((item) =>
                  <article key={item.id} className="workhub-announcement-item">
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <small>公開日時：{new Date(item.publishedAt).toLocaleString("ja-JP")}</small>
                  </article>
                )}</div>}
          <small className="workhub-reference-note">全社員向けのお知らせを新しい順に最大10件表示します。これはReference Applicationの最小実装です。</small>
        </section>
        <section className="workhub-showcase-strip" aria-label="Component Showcase">
          <div><span className="workhub-card-label">COMPONENT SHOWCASE</span><h2>共通部品を、実際の業務画面で検証する</h2><p>Authentication / Authorization / Workflow / Search / Notificationを、WORKHUBの一連の業務Scenarioで組み合わせています。</p></div>
          <div className="workhub-capability-chips" aria-label="利用中のTemplate capability"><span>Authentication</span><span>Authorization</span><span>Workflow</span><span>Search</span><span>Notification</span></div>
        </section>
      </main>
    </div>
    {isAoi && selectedRequest?.status === "submitted" && <section className="workhub-travel-print-sheet" aria-label="出張申請内容（印刷用）">
      <p className="workhub-print-eyebrow">WORKHUB / REFERENCE</p>
      <h1>出張申請書（現在の申請内容）</h1>
      <dl>
        <div><dt>申請ID</dt><dd>{selectedRequest.id}</dd></div>
        <div><dt>申請者</dt><dd>{user?.displayName ?? selectedRequest.id}</dd></div>
        <div><dt>行先（現在のマスター表示）</dt><dd>{offices.find(office => office.itemId === selectedRequest.destinationOfficeItemId)?.label ?? selectedRequest.destinationOfficeItemId}</dd></div>
        <div><dt>出張期間</dt><dd>{selectedRequest.startDate} ～ {selectedRequest.endDate}</dd></div>
        <div><dt>出張目的</dt><dd>{selectedRequest.purpose}</dd></div>
        <div><dt>現在の申請状態</dt><dd>{selectedWorkflow?.state === "completed" ? "承認済み" : selectedWorkflow?.state === "awaiting_resubmission" ? "差戻し・修正待ち" : "申請中"}</dd></div>
      </dl>
      <p className="workhub-print-disclaimer">この帳票は画面表示用の最新データから作成した参考資料です。提出時点の原本、正式な承認証跡、電子署名付きPDFではありません。行先の表示名は現在のマスターを参照しています。</p>
    </section>}
  </div>;
}

export default function App() { const auth = useAuth(); if (auth.status === "loading") return <main className="workhub-loading" aria-live="polite"><Brand /><span className="workhub-loading-bar" aria-hidden="true" /><p>ログイン状態を確認しています…</p></main>; if (auth.status === "authenticated") return window.location.pathname.startsWith("/admin") ? <AdminPortal /> : <TravelWorkspace />; if (auth.status === "error") return <main className="workhub-loading"><Brand /><h1>ログイン状態を確認できません</h1><p>通信状態を確認してから、もう一度お試しください。</p><button className="workhub-primary-button workhub-retry-button" type="button" onClick={() => void auth.synchronize()}>再試行</button></main>; return <LoginScreen />; }
