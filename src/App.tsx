import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./frontend/auth";
import AdminPortal from "./reference/admin/AdminPortal";
import AccountSwitchButton from "./reference/workhub/AccountSwitchButton";
import AskCecilPanel from "./reference/workhub/AskCecilPanel";
import CecilTravelReview from "./reference/workhub/CecilTravelReview";
import { isAuthorizedCecilTravelApp, matchesCecilTravelReview, validateCecilTravelDraft, type CecilTravelDraft } from "./reference/workhub/travel-draft";
import { ANNOUNCEMENT_AUDIENCE_DEPARTMENTS } from "./reference/workhub/announcements";
import ExpenseWorkspace from "./reference/workhub/ExpenseWorkspace";
import { listActionRequiredMyRequests } from "./reference/workhub/my-requests";
import WorkhubAppLauncher from "./reference/workhub/WorkhubAppLauncher";
import "./workhub.css";

interface DemoPersona { readonly key: string; readonly userId: string; readonly displayName: string; readonly roleLabel: string; readonly homeHint: string; }
interface DemoConfig { readonly demoEnabled: boolean; readonly personas: DemoPersona[]; readonly demoPassword?: string; readonly authMode?: "google_oidc"; readonly oidcEnabled?: boolean; }
interface OfficeOption { readonly itemId: string; readonly revisionId: string; readonly code: string; readonly label: string; }
interface WorkhubDirectoryPerson { readonly displayName: string; readonly roleLabel: string; readonly organizationLabel: string; }
interface WorkhubDocumentSummary {
  readonly id: string; readonly title: string; readonly category: "公式" | "手順" | "FAQ";
  readonly version: number; readonly ownerLabel: string; readonly reviewedAt: string;
  readonly state: "current" | "stale" | "superseded";
  readonly summary: string; readonly replacementTitle: string | null;
}
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
interface ApprovalDelegationGrant { readonly validFrom: string; readonly validUntil: string; readonly revokedAt: string | null; }
const isActiveApprovalDelegation = (grant: ApprovalDelegationGrant | null): boolean =>
  !!grant && grant.revokedAt === null
  && Date.parse(grant.validFrom) <= Date.now() && Date.now() < Date.parse(grant.validUntil);
interface NotificationRecord { readonly id: string; readonly notificationType: string; readonly actionTarget: string | null; readonly version: number; readonly readAt: string | null; readonly createdAt: string; }
interface TimelineActivity { readonly id: string; readonly activityType: string; readonly occurredAt: string; }
interface SearchResultRecord { readonly resourceType: string; readonly resourceId: string; readonly category: string; readonly title: string; readonly snippet?: string; readonly actionTarget?: string; }
interface CompanyAnnouncement {
  readonly id: string; readonly title: string; readonly body: string; readonly authorId: string;
  readonly publishedAt: string; readonly importance: "normal" | "important" | "critical";
  readonly audienceRole: string | null; readonly audienceDepartment: string | null;
  readonly visibleFrom: string; readonly visibleUntil: string | null;
}
const ANNOUNCEMENT_IMPORTANCE_LABELS: Record<CompanyAnnouncement["importance"], string> = {
  normal: "通常", important: "重要", critical: "緊急",
};
const ANNOUNCEMENT_AUDIENCE_LABELS: Record<string, string> = {
  newcomer: "新入社員", employee: "一般社員", manager: "管理職", accounting: "経理",
  corporate: "総務", system_admin: "システム管理者",
};
const ANNOUNCEMENT_DEPARTMENT_LABELS: Record<string, string> = Object.fromEntries(
  ANNOUNCEMENT_AUDIENCE_DEPARTMENTS.map(({ code, label }) => [code, label]),
);
const announcementAudienceLabel = (item: CompanyAnnouncement): string => {
  const role = item.audienceRole ? ANNOUNCEMENT_AUDIENCE_LABELS[item.audienceRole] ?? "指定ロール" : null;
  const department = item.audienceDepartment
    ? ANNOUNCEMENT_DEPARTMENT_LABELS[item.audienceDepartment] ?? "指定部署"
    : null;
  return role && department ? `${role}・${department}向け`
    : role ? `${role}向け` : department ? `${department}向け` : "全社員向け";
};
interface WorkhubSocialPost {
  readonly id: string; readonly category: "community" | "thanks" | "knowledge_share";
  readonly title: string; readonly body: string; readonly authorLabel: string; readonly createdAt: string;
  readonly reactionCount: number; readonly commentCount: number;
}
const SOCIAL_CATEGORY_LABELS: Record<WorkhubSocialPost["category"], string> = {
  community: "コミュニティ", thanks: "ありがとう", knowledge_share: "ナレッジ共有",
};

const HOME_HINTS: Record<string, { role: string; hint: string }> = {
  "workhub-demo-haru": { role: "新入社員", hint: "Onboarding / 必須研修" },
  "workhub-demo-aoi": { role: "一般社員", hint: "MY WORK / 申請" },
  "workhub-demo-ren": { role: "Manager", hint: "承認Task / Team" },
  "workhub-demo-mei": { role: "経理", hint: "経費確認Queue" },
  "workhub-demo-sora": { role: "人事 / 総務", hint: "人事・総務Task" },
  "workhub-demo-kai": { role: "System Admin", hint: "System Administration" },
};
const SEARCH_CATEGORY_LABELS: Readonly<Record<string, string>> = { all: "すべて", requests: "申請", apps: "アプリ", documents: "文書", people: "社員" };
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
  const auth = useAuth(); const user = auth.user; const isAoi = user?.id === "workhub-demo-aoi"; const isRen = user?.id === "workhub-demo-ren"; const isMei = user?.id === "workhub-demo-mei"; const canReviewTravel = isRen || isMei; const canPublishAnnouncements = user?.id === "workhub-demo-sora"; const reference = user ? HOME_HINTS[user.id] : undefined;
  const [offices, setOffices] = useState<OfficeOption[]>([]); const [myWork, setMyWork] = useState<MyWorkEntry[]>([]); const [myWorkState, setMyWorkState] = useState<"loading" | "ready" | "error">("loading"); const [returnReasons, setReturnReasons] = useState<Record<string, string>>({}); const [myRequests, setMyRequests] = useState<UnifiedMyRequest[]>([]); const [journeyTravelId, setJourneyTravelId] = useState<string | null>(null); const [expenseSelection, setExpenseSelection] = useState<{ readonly id: string; readonly edit: boolean; readonly sequence: number } | null>(null); const [announcements, setAnnouncements] = useState<CompanyAnnouncement[]>([]); const [announcementLoad, setAnnouncementLoad] = useState<"loading" | "ready" | "error">("loading"); const [showAllAnnouncements, setShowAllAnnouncements] = useState(false); const [announcementTitle, setAnnouncementTitle] = useState(""); const [announcementBody, setAnnouncementBody] = useState(""); const [announcementImportance, setAnnouncementImportance] = useState<CompanyAnnouncement["importance"]>("normal"); const [announcementAudience, setAnnouncementAudience] = useState("all"); const [announcementDepartment, setAnnouncementDepartment] = useState("all"); const [announcementFrom, setAnnouncementFrom] = useState(""); const [announcementUntil, setAnnouncementUntil] = useState(""); const [myRequestsState, setMyRequestsState] = useState<"loading" | "ready" | "error">("loading"); const [notifications, setNotifications] = useState<NotificationRecord[]>([]); const [unreadCount, setUnreadCount] = useState(0); const [notificationState, setNotificationState] = useState<"loading" | "ready" | "error">("loading"); const [selectedRequest, setSelectedRequest] = useState<TravelRequestRecord | null>(null); const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowRecord | null>(null); const [returnComment, setReturnComment] = useState<string | null>(null); const [timeline, setTimeline] = useState<TimelineActivity[]>([]); const [destinationOfficeItemId, setDestinationOfficeItemId] = useState(""); const [startDate, setStartDate] = useState("2026-10-12"); const [endDate, setEndDate] = useState("2026-10-13"); const [purpose, setPurpose] = useState("東京での顧客打ち合わせ"); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [searchText, setSearchText] = useState(""); const [searchResults, setSearchResults] = useState<SearchResultRecord[]>([]); const [searching, setSearching] = useState(false);
  const [showNotificationCenter, setShowNotificationCenter] = useState(false);
  const [showAskCecil, setShowAskCecil] = useState(false);
  const [cecilDraftPrepared, setCecilDraftPrepared] = useState(false);
  const [cecilTravelReview, setCecilTravelReview] = useState<CecilTravelDraft | null>(null);
  const cecilSubmitButtonRef = useRef<HTMLButtonElement>(null);
  const cecilConfirmationPending = useRef(false);
  const askCecilButtonRef = useRef<HTMLButtonElement>(null);
  const restoreAskCecilFocus = useRef(false);
  const closeAskCecil = () => { restoreAskCecilFocus.current = true; setShowAskCecil(false); };
  useEffect(() => {
    if (!showAskCecil && restoreAskCecilFocus.current) {
      restoreAskCecilFocus.current = false;
      askCecilButtonRef.current?.focus({ preventScroll: true });
    }
  }, [showAskCecil]);
  const [notificationFilter, setNotificationFilter] = useState<"all" | "unread">("all");
  const notificationBellRef = useRef<HTMLButtonElement>(null);
  const notificationTitleRef = useRef<HTMLHeadingElement>(null);
  const restoreNotificationBellFocus = useRef(false);
  useEffect(() => {
    if (showNotificationCenter) {
      notificationTitleRef.current?.focus({ preventScroll: true });
    } else if (restoreNotificationBellFocus.current) {
      restoreNotificationBellFocus.current = false;
      notificationBellRef.current?.focus({ preventScroll: true });
    }
  }, [showNotificationCenter]);
  const [people, setPeople] = useState<readonly WorkhubDirectoryPerson[]>([]);
  const [peopleState, setPeopleState] = useState<"loading" | "ready" | "error">("loading");
  const [documents, setDocuments] = useState<readonly WorkhubDocumentSummary[]>([]);
  const [documentsState, setDocumentsState] = useState<"loading" | "ready" | "error">("loading");
  const [socialPosts, setSocialPosts] = useState<readonly WorkhubSocialPost[]>([]);
  const [socialState, setSocialState] = useState<"loading" | "ready" | "error">("loading");
  const [searchCategory, setSearchCategory] = useState("all");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const searchRequestVersion = useRef(0);
  const [delegation, setDelegation] = useState<ApprovalDelegationGrant | null>(null);
  const [delegationState, setDelegationState] = useState<"loading" | "ready" | "error">("loading");
  const activeDelegation = isActiveApprovalDelegation(delegation);
  const mutationInFlight = useRef(false);
  const pendingTravelDraft = useRef<TravelRequestRecord | null>(null);
  const focusDelegationAfterRead = useRef(false);
  const focusMyWorkAfterDecision = useRef(false);
  // Actions replace their focused controls. Restore keyboard focus only after
  // authoritative readback settles; a screen reader also gets the live status.
  useEffect(() => {
    if (!focusDelegationAfterRead.current || delegationState === "loading") return;
    focusDelegationAfterRead.current = false;
    document.getElementById("workhub-delegation-heading")?.focus({ preventScroll: true });
  }, [delegationState, delegation]);
  useEffect(() => {
    if (!focusMyWorkAfterDecision.current || myWorkState === "loading") return;
    focusMyWorkAfterDecision.current = false;
    document.getElementById("workhub-my-work-heading")?.focus({ preventScroll: true });
  }, [myWorkState, myWork]);
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
  const loadMyWork = useCallback(async () => { if (!canReviewTravel) return; setMyWorkState("loading"); try { const result = await apiJson<{ items: MyWorkEntry[] }>("/api/workhub/my-work"); setMyWork(result.items); setMyWorkState("ready"); } catch { setMyWorkState("error"); } }, [canReviewTravel]);
  const loadDelegation = useCallback(async (): Promise<{ grant: ApprovalDelegationGrant | null } | null> => {
    if (!canReviewTravel) return null;
    setDelegationState("loading");
    try {
      const status = await apiJson<{ grant: ApprovalDelegationGrant | null }>("/api/workhub/approval-delegation");
      setDelegation(status.grant);
      setDelegationState("ready");
      return status;
    } catch {
      // Keep the previous value only as historical client state, never actionable.
      setDelegationState("error");
      return null;
    }
  }, [canReviewTravel]);
  const loadPeople = useCallback(async () => {
    setPeopleState("loading");
    try {
      const response = await apiJson<{ items: WorkhubDirectoryPerson[] }>("/api/workhub/people");
      if (!Array.isArray(response.items)) throw new Error("invalid_directory_response");
      setPeople(response.items);
      setPeopleState("ready");
    } catch {
      setPeople([]);
      setPeopleState("error");
    }
  }, []);
  const loadDocuments = useCallback(async () => {
    setDocumentsState("loading");
    try {
      const response = await apiJson<{ items: WorkhubDocumentSummary[] }>("/api/workhub/documents");
      if (!Array.isArray(response.items)) throw new Error("invalid_documents_response");
      setDocuments(response.items);
      setDocumentsState("ready");
    } catch {
      // A failed authorized read must not leave a stale list pretending to be current.
      setDocuments([]);
      setDocumentsState("error");
    }
  }, []);
  const loadSocial = useCallback(async () => {
    setSocialState("loading");
    try {
      const result = await apiJson<{ items: WorkhubSocialPost[] }>("/api/workhub/social");
      if (!Array.isArray(result.items)) throw new Error("invalid_social_response");
      setSocialPosts(result.items);
      setSocialState("ready");
    } catch {
      // A failed refresh cannot leave a previous authorized feed on screen.
      setSocialPosts([]);
      setSocialState("error");
    }
  }, []);
  const loadAnnouncements = useCallback(async () => {
    setAnnouncementLoad("loading");
    try {
      const result = await apiJson<{ items: CompanyAnnouncement[] }>("/api/workhub/announcements");
      setAnnouncements(result.items);
      setAnnouncementLoad("ready");
    } catch {
      setAnnouncements([]);
      setAnnouncementLoad("error");
    }
  }, []);
  const loadMyRequests = useCallback(async () => { if (!isAoi) return; setMyRequestsState("loading"); try { const result = await apiJson<{ items: UnifiedMyRequest[] }>("/api/workhub/my-requests"); setMyRequests(result.items); setMyRequestsState("ready"); } catch { setMyRequestsState("error"); } }, [isAoi]);
  const openRequest = useCallback(async (id: string) => { const detail = await apiJson<{ request: TravelRequestRecord; workflow: WorkflowRecord | null; returnComment: string | null }>(`/api/workhub/travel-requests/${encodeURIComponent(id)}`); const history = await apiJson<{ items: TimelineActivity[] }>(`/api/workhub/travel-requests/${encodeURIComponent(id)}/timeline`); setSelectedRequest(detail.request); setSelectedWorkflow(detail.workflow); setReturnComment(detail.workflow?.state === "awaiting_resubmission" ? detail.returnComment : null); setTimeline(history.items ?? []); setDestinationOfficeItemId(detail.request.destinationOfficeItemId); setStartDate(detail.request.startDate); setEndDate(detail.request.endDate); setPurpose(detail.request.purpose); return detail; }, []);
  useEffect(() => { void Promise.all([apiJson<{ items: OfficeOption[] }>("/api/workhub/offices").then((result) => { setOffices(result.items); setDestinationOfficeItemId((current) => current || result.items[0]?.itemId || ""); }), loadNotifications(), loadMyWork(), loadMyRequests(), loadAnnouncements(), loadDelegation(), loadPeople(), loadDocuments(), loadSocial()]).catch(() => setMessage("WORKHUBの業務データを読み込めませんでした。")); }, [loadMyWork, loadMyRequests, loadNotifications, loadAnnouncements, loadDelegation, loadPeople, loadDocuments, loadSocial]);
  const run = async (operation: () => Promise<void>) => {
    // A React state update does not synchronously block two rapid click events.
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setMessage(null);
    try { await operation(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "処理に失敗しました。"); }
    finally { mutationInFlight.current = false; setBusy(false); }
  };
  const publishAnnouncement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPublishAnnouncements || !announcementTitle.trim() || !announcementBody.trim()) return;
    void run(async () => {
      await apiJson("/api/workhub/announcements", {
        method: "POST",
        body: JSON.stringify({
          title: announcementTitle, body: announcementBody,
          importance: announcementImportance,
          audienceRole: announcementAudience === "all" ? null : announcementAudience,
          audienceDepartment: announcementDepartment === "all" ? null : announcementDepartment,
          ...(announcementFrom ? { visibleFrom: new Date(announcementFrom).toISOString() } : {}),
          ...(announcementUntil ? { visibleUntil: new Date(announcementUntil).toISOString() } : {}),
        }),
      });
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementImportance("normal");
      setAnnouncementAudience("all");
      setAnnouncementDepartment("all");
      setAnnouncementFrom("");
      setAnnouncementUntil("");
      await loadAnnouncements();
      setMessage("社内お知らせを公開しました。");
    });
  };
  const createAndSubmit = (humanConfirmed?: CecilTravelDraft) => {
    const liveDraft: CecilTravelDraft = { destinationOfficeItemId, startDate, endDate, purpose };
    if (cecilDraftPrepared && (
      !isAoi || !humanConfirmed || !cecilTravelReview ||
      !matchesCecilTravelReview(humanConfirmed, liveDraft) ||
      !matchesCecilTravelReview(cecilTravelReview, liveDraft) ||
      validateCecilTravelDraft(liveDraft, offices) ||
      selectedRequest || awaitingResubmission
    )) {
      setCecilTravelReview(null);
      setMessage("下書きの確認内容が変更されたか申請状態が更新されました。再度確認してください。");
      return;
    }
    if (cecilDraftPrepared && cecilConfirmationPending.current) return;
    if (cecilDraftPrepared) cecilConfirmationPending.current = true;
    void run(async () => {
      if (cecilDraftPrepared) {
        // Revalidate the current server-authorized app and selectable master
        // immediately before the first business write, not only during L2.
        const [apps, currentOffices] = await Promise.all([
          apiJson<{ items: unknown }>("/api/workhub/apps"),
          apiJson<{ items: OfficeOption[] }>("/api/workhub/offices"),
        ]);
        if (!isAuthorizedCecilTravelApp(apps.items) || !humanConfirmed ||
          !Array.isArray(currentOffices.items) ||
          validateCecilTravelDraft(humanConfirmed, currentOffices.items)) {
          throw new Error("出張申請の権限または出張先が更新されています。提出せずに確認をやり直してください。");
        }
      }
    // The create and submit calls are separate business mutations. If submit's
    // response is lost, reuse the owner-authorized draft instead of creating
    // another request. Never retry a mutation automatically.
    let request = pendingTravelDraft.current;
    if (request) {
      const current = await apiJson<{ request: TravelRequestRecord }>(
        `/api/workhub/travel-requests/${encodeURIComponent(request.id)}`,
      );
      request = current.request;
      pendingTravelDraft.current = request;
      if (request.status === "submitting") {
        throw new Error("前回の提出処理を確認中です。時間をおいて状態を再確認してください。");
      }
    } else {
      const created = await apiJson<{ request: TravelRequestRecord }>("/api/workhub/travel-requests", {
        method: "POST",
        body: JSON.stringify({ destinationOfficeItemId, startDate, endDate, purpose }),
      });
      request = created.request;
      pendingTravelDraft.current = request;
    }
    if (request.status === "draft") {
      if (request.destinationOfficeItemId !== destinationOfficeItemId
        || request.startDate !== startDate || request.endDate !== endDate
        || request.purpose !== purpose) {
        const updated = await apiJson<{ request: TravelRequestRecord }>(
          `/api/workhub/travel-requests/${encodeURIComponent(request.id)}`,
          { method: "PUT", body: JSON.stringify({
            expectedVersion: request.version, destinationOfficeItemId, startDate, endDate, purpose,
          }) },
        );
        request = updated.request;
        pendingTravelDraft.current = request;
      }
      await apiJson<{ request: TravelRequestRecord }>(
        `/api/workhub/travel-requests/${encodeURIComponent(request.id)}/submit`,
        { method: "POST", body: JSON.stringify({ expectedVersion: request.version }) },
      );
    } else if (request.status !== "submitted") {
      throw new Error("申請状態を確認できませんでした。再送信せず、申請一覧で確認してください。");
    }
    // A successful write must not be undone or repeated when a read-side
    // timeline/notification projection is temporarily unavailable.
    const detail = await openRequest(request.id);
    if (!detail.workflow) {
      throw new Error("提出状況の確認が完了していません。再度状態を確認してください。");
    }
    await Promise.all([loadNotifications(), loadMyRequests()]);
    pendingTravelDraft.current = null;
    setCecilDraftPrepared(false);
    setCecilTravelReview(null);
    setMessage("出張申請を提出しました。");
    }).finally(() => { cecilConfirmationPending.current = false; });
  };
  const updateAndResubmit = () => void run(async () => { if (!selectedRequest || !selectedWorkflow) return; const updated = await apiJson<{ request: TravelRequestRecord }>(`/api/workhub/travel-requests/${selectedRequest.id}`, { method: "PUT", body: JSON.stringify({ expectedVersion: selectedRequest.version, destinationOfficeItemId, startDate, endDate, purpose }) }); await apiJson(`/api/workhub/travel-requests/${selectedRequest.id}/resubmit`, { method: "POST", body: JSON.stringify({ expectedRequestVersion: updated.request.version, expectedWorkflowVersion: selectedWorkflow.version }) }); await openRequest(selectedRequest.id); await Promise.all([loadNotifications(), loadMyRequests()]); setMessage("出張申請を再申請しました。"); });
  const toggleDelegation = () => void run(async () => {
    if (delegationState !== "ready") return;
    focusDelegationAfterRead.current = true;
    const requestedEnabled = !activeDelegation;
    // Fail closed before POST. A lost response is not proof that the server
    // rejected the mutation. Do not enable another POST until GET resolves.
    setDelegationState("loading");
    let acknowledged = false;
    try {
      await apiJson("/api/workhub/approval-delegation", {
        method: "POST", body: JSON.stringify({ enabled: requestedEnabled }),
      });
      acknowledged = true;
    } catch {
      // The write may have committed. Never automatically retry the mutation.
    }
    const current = await loadDelegation();
    await loadMyWork();
    if (!current) {
      setMessage("委任処理の結果を確認できません。再送信せず、委任状態を再確認してください。");
    } else if (!acknowledged) {
      setMessage(`委任処理の応答を確認できませんでした。再取得した現在の状態は${isActiveApprovalDelegation(current.grant) ? "有効" : "無効"}です。自動再送信はしていません。`);
    } else if (isActiveApprovalDelegation(current.grant) !== requestedEnabled) {
      setMessage("委任の状態が操作後に変化しました。表示されている現在の状態を確認してください。");
    } else {
      setMessage(requestedEnabled ? "Meiへの出張承認代理を24時間有効にしました。" : "代理承認を取り消しました。");
    }
  });
  const decide = (entry: MyWorkEntry, action: "approve" | "return") => { const comment = returnReasons[entry.workItem.id]?.trim() ?? ""; if (action === "return" && !comment) { setMessage("差戻し理由を入力してください。"); return; } void run(async () => { await apiJson(`/api/workhub/workflows/${entry.workflow.id}/${action}`, { method: "POST", body: JSON.stringify({ expectedInstanceVersion: entry.workflow.version, expectedWorkItemVersion: entry.workItem.version, ...(action === "return" ? { reasonCode: "correction_required", comment } : {}) }) }); focusMyWorkAfterDecision.current = true; await loadMyWork(); await loadNotifications(); setMessage(action === "approve" ? "承認しました。" : "差し戻しました。"); }); };
  const retryDelegationRead = () => { focusDelegationAfterRead.current = true; void loadDelegation(); };
  const openNotification = (notification: NotificationRecord) => void run(async () => { if (!notification.readAt) await apiJson(`/api/workhub/notifications/${notification.id}/read`, { method: "POST", body: JSON.stringify({ expectedVersion: notification.version }) }); const target = notification.actionTarget?.match(/^resource:travel_request:(.+)$/u)?.[1]; if (target && isAoi) await openRequest(target); await loadNotifications(); });
  const search = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const query = searchText.trim();
    if (!query || searching) return;
    const version = ++searchRequestVersion.current;
    setSearching(true);
    setSearchState("loading");
    setSearchResults([]);
    try {
      const response = await apiJson<{ results: SearchResultRecord[] }>(
        `/api/workhub/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(searchCategory)}`,
      );
      if (version !== searchRequestVersion.current) return;
      setSearchResults(response.results);
      setSearchState("ready");
    } catch {
      if (version !== searchRequestVersion.current) return;
      setSearchResults([]);
      setSearchState("error");
    } finally {
      if (version === searchRequestVersion.current) setSearching(false);
    }
  };
  const openSearchResult = (result: SearchResultRecord) => void run(async () => { if (result.resourceType === "travel_request") await openRequest(result.resourceId); });
  const selectMyRequest = (request: UnifiedMyRequest) => {
    if (request.kind === "expense") {
      // A unified row is only a pointer. ExpenseWorkspace re-reads its current
      // owner-authorized resource and version before opening the edit form.
      setExpenseSelection(current => ({
        id: request.id,
        edit: request.status === "action_required",
        sequence: (current?.sequence ?? 0) + 1,
      }));
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
  const centerNotifications = notificationFilter === "unread" ? notifications.filter(item => !item.readAt) : notifications;
  // The single most urgent official announcement gets one Global Banner.
  // Its record does not appear a second time in the HOME announcement list.
  const bannerAnnouncement = announcements.find(item => item.importance === "critical") ?? null;
  const regularAnnouncements = announcements.filter(item => item.id !== bannerAnnouncement?.id);
  const visibleAnnouncements = showAllAnnouncements ? regularAnnouncements : regularAnnouncements.slice(0, 3);
  // Hide only HOME projections whose *visible* MY WORK item already
  // represents the same required action. Never mutate Notification state,
  // the unread Bell count, or the full Notification Center.
  const representedHomeActions = new Set<string>();
  if (canReviewTravel && myWorkState === "ready") {
    for (const entry of myWork.slice(0, 3)) {
      representedHomeActions.add(`workflow.approval_requested:resource:travel_request:${entry.request.id}`);
    }
  } else if (isAoi && myRequestsState === "ready") {
    for (const request of pendingMyRequests.slice(0, 3)) {
      if (request.kind === "travel") {
        representedHomeActions.add(`workflow.returned:resource:travel_request:${request.id}`);
      }
    }
  }
  const isRepresentedInHomeWork = (notice: NotificationRecord): boolean =>
    representedHomeActions.has(`${notice.notificationType}:${notice.actionTarget ?? ""}`);
  const homeNotifications = notifications.filter(notice => !isRepresentedInHomeWork(notice)).slice(0, 4);
  const homeSuppressedNotification = notifications.some(isRepresentedInHomeWork);
  const openNotificationCenter = () => { setNotificationFilter("all"); setShowNotificationCenter(true); };
  const leaveNotificationCenter = () => { restoreNotificationBellFocus.current = true; setShowNotificationCenter(false); };
  const homeWorkCount: number | null = canReviewTravel ? (myWorkState === "ready" ? myWork.length : null) : isAoi ? (myRequestsState === "ready" ? pendingMyRequests.length : null) : null;
  // Print the authoritative current request, not unsaved form fields.
  // This is a browser print/PDF-save view, NOT a historical approved artifact.
  const printTravelRequest = () => void run(async () => {
    if (!selectedRequest) return;
    const detail = await openRequest(selectedRequest.id);
    if (detail.request.status !== "submitted") throw new Error("提出済みの申請だけ印刷できます。");
    requestAnimationFrame(() => window.print());
  });
  const prepareCecilSubmissionReview = () => {
    const current: CecilTravelDraft = { destinationOfficeItemId, startDate, endDate, purpose };
    const validation = validateCecilTravelDraft(current, offices);
    if (!isAoi || busy || selectedRequest || awaitingResubmission || !cecilDraftPrepared || validation) {
      setMessage(validation ?? "この申請は確認できません。申請状態を再確認してください。");
      return;
    }
    setMessage(null);
    setCecilTravelReview({ ...current });
  };
  const cancelCecilSubmissionReview = () => {
    setCecilTravelReview(null);
    requestAnimationFrame(() => cecilSubmitButtonRef.current?.focus({ preventScroll: true }));
  };
  const handoffCecilTravel = (draft: CecilTravelDraft): boolean => {
    // Only accepted while currently showing an eligible employee\u0027s new request form.
    // Never overwrite an unresolved POST draft or an existing returned request.
    if (!isAoi || busy || selectedRequest || pendingTravelDraft.current ||
      validateCecilTravelDraft(draft, offices)) return false;
    setDestinationOfficeItemId(draft.destinationOfficeItemId);
    setStartDate(draft.startDate);
    setEndDate(draft.endDate);
    setPurpose(draft.purpose);
    setCecilDraftPrepared(true);
    setCecilTravelReview(null);
    setMessage(null);
    restoreAskCecilFocus.current = false;
    setShowAskCecil(false);
    window.requestAnimationFrame(() => {
      document.getElementById("workhub-travel-form")?.scrollIntoView({ block: "center" });
      document.getElementById("workhub-travel-purpose")?.focus({ preventScroll: true });
    });
    return true;
  };
  return <div className="workhub-home-shell">
    <header className="workhub-home-header">
      <Brand />
      <form className="workhub-global-search" onSubmit={search} role="search">
        <label className="workhub-sr-only" htmlFor="workhub-global-search">WORKHUBを検索</label>
        <input id="workhub-global-search" value={searchText} onChange={(event) => { ++searchRequestVersion.current; setSearchText(event.target.value); setSearchState("idle"); setSearchResults([]); setSearching(false); }} placeholder="社内の情報を検索" />
        <select className="workhub-search-category" aria-label="検索カテゴリ" value={searchCategory} onChange={(event) => { ++searchRequestVersion.current; setSearchCategory(event.target.value); setSearchState("idle"); setSearchResults([]); setSearching(false); }}>
          <option value="all">すべて</option><option value="requests">申請</option><option value="apps">アプリ</option><option value="documents">文書</option><option value="people">社員</option>
        </select>
        <button type="submit" disabled={searching || !searchText.trim()} aria-label="検索">{searching ? "…" : "⌕"}</button>
      </form>
      <div className="workhub-header-actions" aria-label="グローバル操作">
        <button ref={askCecilButtonRef} className="workhub-header-action" type="button" aria-label="Ask CECIL" aria-haspopup="dialog" aria-controls="workhub-ask-title" aria-expanded={showAskCecil} onClick={() => setShowAskCecil(true)}>Ask CECIL</button>
        <button ref={notificationBellRef} className="workhub-header-action workhub-header-icon" type="button" aria-controls="workhub-notification-center" aria-expanded={showNotificationCenter} onClick={openNotificationCenter} aria-label={notificationState === "ready" ? `通知 未読${unreadCount}件` : "通知 取得状況を確認"}>🔔{notificationState === "ready" && <span className="workhub-notification-badge">{unreadCount}</span>}</button>
        <a className="workhub-header-action workhub-header-icon" href="#workhub-apps" aria-label="アプリ一覧">▦</a>
        <div className="workhub-user-chip"><span className="workhub-user-dot" aria-hidden="true" /><span><strong>{user?.displayName ?? "CECIL WORKS User"}</strong><small>{reference?.role ?? "Authenticated User"}</small></span></div>
        <AccountSwitchButton />
      </div>
    </header>
    {showAskCecil && <AskCecilPanel onClose={closeAskCecil} onTravelHandoff={handoffCecilTravel} />}
    <main hidden={!showNotificationCenter} className="workhub-notification-center" id="workhub-notification-center" aria-labelledby="workhub-notification-center-title">
      <div className="workhub-notification-center-heading">
        <div><span className="workhub-card-label">NOTIFICATION CENTER</span><h1 id="workhub-notification-center-title" ref={notificationTitleRef} tabIndex={-1}>通知センター</h1></div>
        <button type="button" className="workhub-secondary-button" onClick={leaveNotificationCenter}>ホームへ戻る</button>
      </div>
      <p>自分に関係する状態変化を確認できます。未読は対応が必要な仕事の件数ではありません。</p>
      <div className="workhub-notification-center-controls" role="group" aria-label="通知の表示条件">
        <button type="button" className="workhub-secondary-button" aria-pressed={notificationFilter === "all"} onClick={() => setNotificationFilter("all")}>すべて</button>
        <button type="button" className="workhub-secondary-button" aria-pressed={notificationFilter === "unread"} onClick={() => setNotificationFilter("unread")}>未読のみ</button>
        <button type="button" className="workhub-secondary-button" onClick={() => void loadNotifications()} disabled={notificationState === "loading"}>通知を更新</button>
      </div>
      {notificationState === "loading" ? <p role="status">通知を読み込んでいます…</p> :
        notificationState === "error" ? <div role="alert"><p>通知を取得できませんでした。0件とは限りません。</p><button type="button" className="workhub-secondary-button" onClick={() => void loadNotifications()}>再読み込み</button></div> :
          centerNotifications.length === 0 ? <p className="workhub-empty-state">{notificationFilter === "unread" ? "取得した通知に未読はありません。" : "通知はありません。"}</p> :
            <ul className="workhub-notification-center-list">{centerNotifications.map(notification =>
              <li key={notification.id}><button type="button" className="workhub-notification-center-item" onClick={() => { setShowNotificationCenter(false); openNotification(notification); }}>
                <span className="workhub-center-read-label">{notification.readAt ? "既読" : "未読"}</span>
                <strong>{NOTIFICATION_LABELS[notification.notificationType] ?? notification.notificationType}</strong>
                <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString("ja-JP")}</time>
              </button></li>,
            )}</ul>}
      <small className="workhub-reference-note">最新50件の取得済み通知を表示します。未読の絞り込みは取得済みの範囲内です。通知の既読化は業務タスクの完了を意味しません。</small>
    </main>
    <div className="workhub-portal-layout" hidden={showNotificationCenter}>
      <nav className="workhub-side-nav" aria-label="WORKHUB メインナビゲーション">
        <a className="is-active" href="#workhub-home" aria-current="page"><span aria-hidden="true">⌂</span>ホーム</a>
        <a href="#workhub-my-work"><span aria-hidden="true">✓</span>MY WORK</a>
        <a href="#workhub-request-intents"><span aria-hidden="true">▤</span>申請・手続き</a>
        {isAoi && <a href="#workhub-my-requests"><span aria-hidden="true">☷</span>自分の申請一覧</a>}
        {(isAoi || user?.id === "workhub-demo-mei") && <a href="#workhub-expenses"><span aria-hidden="true">¥</span>交通費・経費精算</a>}
        <a href="#workhub-apps"><span aria-hidden="true">▦</span>アプリ</a>
        <a href="#workhub-people"><span aria-hidden="true">♙</span>組織・人</a>
        <a href="#workhub-documents"><span aria-hidden="true">▱</span>ナレッジ</a>
        <a href="#workhub-announcements"><span aria-hidden="true">◌</span>社内お知らせ</a>
        <a href="#workhub-social"><span aria-hidden="true">♧</span>社内交流</a>
        <div className="workhub-side-nav-spacer" />
        <span className="workhub-nav-coming" aria-disabled="true"><span aria-hidden="true">?</span>サポート</span>
      </nav>
      <main className="workhub-home-main" id="workhub-home">
        {announcementLoad === "ready" && bannerAnnouncement && <aside className="workhub-global-banner" role="alert" aria-labelledby="workhub-critical-news-title">
          <span className="workhub-global-banner-kicker">緊急のお知らせ · {announcementAudienceLabel(bannerAnnouncement)}</span>
          <h2 id="workhub-critical-news-title">{bannerAnnouncement.title}</h2>
          <p>{bannerAnnouncement.body}</p>
          <small>総務からの公式連絡 · 公開：{new Date(bannerAnnouncement.publishedAt).toLocaleString("ja-JP")}</small>
        </aside>}
        <section className="workhub-home-hero" aria-labelledby="workhub-home-title">
          <img src="/images/workhub/workhub-top-hero.jpg" alt="WORKHUB Digital Workplaceのトップビジュアル" />
          <div className="workhub-home-hero-copy">
            <p className="workhub-eyebrow">CECIL WORKS DIGITAL WORKPLACE</p>
            <h1 id="workhub-home-title">おはようございます、{user?.displayName ?? "ユーザー"}さん</h1>
            <p>仕事の入口を、ひとつに。今日やることから始めましょう。</p>
          </div>
        </section>
        {message && <div className="workhub-demo-note" role="status"><strong>WORKHUB</strong><span>{message}</span></div>}
        {searchState !== "idle" && <section className="workhub-search-panel workhub-global-search-results" aria-live="polite" aria-label="検索結果">
          {searchState === "loading" ? <p role="status">検索しています…</p> :
            searchState === "error" ? <div role="alert"><p>検索結果を取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void search()}>再検索</button></div> :
            searchResults.length === 0 ? <div className="workhub-search-empty">
              <p>「{searchText.trim()}」に一致する結果はありません（カテゴリ：{SEARCH_CATEGORY_LABELS[searchCategory] ?? "未指定"}）。</p>
              <p>検索語やカテゴリを変えて、もう一度検索してください。</p>
              {searchCategory !== "all" && <button className="workhub-secondary-button" type="button" onClick={() => {
                ++searchRequestVersion.current;
                setSearchCategory("all");
                setSearchState("idle");
                setSearchResults([]);
                setSearching(false);
                document.getElementById("workhub-global-search")?.focus();
              }}>カテゴリを「すべて」に戻す</button>}
            </div> : <div className="workhub-search-results">
            <p role="status">{searchResults.length}件の閲覧可能な結果を表示しています。</p>
            {searchResults.map(result => {
              const key = `${result.resourceType}:${result.resourceId}`;
              const internalAppTarget = ["workhub_app", "workhub_person", "workhub_document"].includes(result.resourceType)
                && /^\/(?:#workhub-[a-z0-9-]+|admin)$/u.test(result.actionTarget ?? "")
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
            <div className="workhub-section-heading"><div><span className="workhub-card-label">MY WORK</span><h2 id="workhub-my-work-heading" tabIndex={-1}>今日対応すること</h2></div><span className="workhub-summary-count">{homeWorkCount ?? "—"}</span></div>
            {isRen && <div className="workhub-task-list" aria-labelledby="workhub-delegation-heading">
              <h3 id="workhub-delegation-heading" tabIndex={-1}>出張承認の代理設定</h3>
              <p className="workhub-reference-note">出張申請の承認・差戻しのみ、Meiへ最長24時間の代理権限を付与します。実社員の権限は変更しません。</p>
              {delegationState === "loading" ? <p role="status">委任状態を確認中…</p> :
                delegationState === "error" ? <button type="button" className="workhub-secondary-button" onClick={retryDelegationRead}>委任状態を再確認</button> :
                <><p role="status">{activeDelegation ? "Meiへ委任中（期限：" + new Date(delegation!.validUntil).toLocaleString("ja-JP") + "）" : "現在、代理承認は無効です"}</p>
                  <button className="workhub-secondary-button" type="button" disabled={busy || delegationState !== "ready"} onClick={toggleDelegation}>{activeDelegation ? "代理承認を取り消す" : "Meiへ24時間委任する"}</button></>}
            </div>}
            {isMei && <div className="workhub-task-list"><p>経費確認はこちらから行えます。処理待ち件数はHOMEでは取得していません。</p><a className="workhub-work-link" href="#workhub-expenses">経費確認画面を開く →</a></div>}
            {isMei && <p className="workhub-reference-note">{delegationState === "error" ? "代理承認の権限を確認できません。" :
              activeDelegation ? "Renからの代理承認が有効です。出張承認タスクを確認できます。" : "出張承認の代理権限はありません。"}</p>}
            {canReviewTravel ? (
              myWorkState === "loading" ? <p role="status">承認タスクを読み込んでいます…</p>
              : myWorkState === "error" ? <div role="alert"><p>承認タスクを取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadMyWork()}>再読み込み</button></div>
              : myWork.length === 0 ? <p className="workhub-empty-state">現在、対応が必要なタスクはありません。</p> : <div className="workhub-task-list">{myWork.slice(0, 3).map((entry) => <article className="workhub-task-item" key={entry.workItem.id} aria-label={`${entry.request.purpose}の出張承認タスク`}><h3>{entry.request.purpose}</h3>{entry.workItem && isMei && <small>Renの代理として操作・記録します</small>}<span>{entry.request.startDate} → {entry.request.endDate}</span><label className="workhub-return-reason-input">差戻し理由<textarea aria-label={`${entry.request.purpose}の差戻し理由`} value={returnReasons[entry.workItem.id] ?? ""} onChange={(event) => setReturnReasons((current) => ({ ...current, [entry.workItem.id]: event.target.value }))} maxLength={2000} rows={2} placeholder="修正してほしい箇所を具体的に入力" disabled={busy} /></label><div className="workhub-inline-actions"><button className="workhub-secondary-button" type="button" disabled={busy} aria-label={`${entry.request.purpose}：差し戻す`} onClick={() => decide(entry, "return")}>差し戻す</button><button className="workhub-primary-button" type="button" disabled={busy} aria-label={`${entry.request.purpose}：承認する`} onClick={() => decide(entry, "approve")}>承認する</button></div></article>)}</div>
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
        <section className="workhub-announcements" id="workhub-announcements" aria-labelledby="workhub-announcements-title">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">COMPANY NEWS / ANNOUNCEMENTS</span><h2 id="workhub-announcements-title">社内お知らせ</h2></div>
            <button type="button" className="workhub-secondary-button" onClick={() => void loadAnnouncements()} disabled={announcementLoad === "loading"}>お知らせを更新</button>
          </div>
          <p className="workhub-announcements-intro">会社からの公式連絡です。現在の所属ロール・部署と掲載期間で配信対象を判定し、緊急連絡はHOME上部に一度だけ表示します。</p>
          {canPublishAnnouncements && <form className="workhub-announcement-compose" onSubmit={publishAnnouncement} aria-label="社内お知らせを登録">
            <h3>お知らせを公開する（総務担当）</h3>
            <label>件名<input aria-label="お知らせの件名" value={announcementTitle} maxLength={120} required onChange={(event) => setAnnouncementTitle(event.target.value)} /></label>
            <label>本文<textarea aria-label="お知らせの本文" value={announcementBody} maxLength={2000} required rows={3} onChange={(event) => setAnnouncementBody(event.target.value)} /></label>
            <div className="workhub-announcement-delivery-controls">
              <label>重要度<select aria-label="お知らせの重要度" value={announcementImportance} onChange={(event) => setAnnouncementImportance(event.target.value as CompanyAnnouncement["importance"])}>
                <option value="normal">通常</option><option value="important">重要</option><option value="critical">緊急（Global Banner）</option>
              </select></label>
              <label>配信対象<select aria-label="お知らせの配信対象" value={announcementAudience} onChange={(event) => setAnnouncementAudience(event.target.value)}>
                <option value="all">全社員</option>
                {Object.entries(ANNOUNCEMENT_AUDIENCE_LABELS).map(([role, label]) => <option value={role} key={role}>{label}</option>)}
              </select></label>
              <label>配信部署<select aria-label="お知らせの配信部署" value={announcementDepartment} onChange={(event) => setAnnouncementDepartment(event.target.value)}>
                <option value="all">部署を指定しない</option>
                {ANNOUNCEMENT_AUDIENCE_DEPARTMENTS.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
              </select></label>
              <label>掲載開始（省略時は今すぐ）<input type="datetime-local" aria-label="お知らせの掲載開始" value={announcementFrom} onChange={(event) => setAnnouncementFrom(event.target.value)} /></label>
              <label>掲載終了（省略時は無期限）<input type="datetime-local" aria-label="お知らせの掲載終了" value={announcementUntil} min={announcementFrom || undefined} onChange={(event) => setAnnouncementUntil(event.target.value)} /></label>
            </div>
            <small className="workhub-reference-note">配信対象は現在のWORKHUB所属ロール・部署をサーバーで判定します。ロールと部署の両方を指定した場合は両条件を満たす社員に配信します。未来日時の告知は開始時刻まで表示されません。</small>
            <button className="workhub-primary-button" type="submit" disabled={busy || !announcementTitle.trim() || !announcementBody.trim()}>お知らせを公開</button>
          </form>}
          {announcementLoad === "loading" ? <p role="status">お知らせを読み込んでいます…</p> :
            announcementLoad === "error" ? <div role="alert">お知らせを読み込めませんでした。<button className="workhub-secondary-button" type="button" onClick={() => void loadAnnouncements()}>再読み込み</button></div> :
              regularAnnouncements.length === 0 ? <p className="workhub-empty-state">{bannerAnnouncement ? "緊急Banner以外のお知らせはありません。" : "現在公開されているお知らせはありません。"}</p> :
                <div className="workhub-announcement-list" id="workhub-announcement-list">{visibleAnnouncements.map((item) =>
                  <article key={item.id} className="workhub-announcement-item">
                    <h3>{item.importance !== "normal" && <span className="workhub-announcement-importance">{ANNOUNCEMENT_IMPORTANCE_LABELS[item.importance]}</span>}{item.title}</h3>
                    <p>{item.body}</p>
                    <small>{announcementAudienceLabel(item)} · 公開日時：{new Date(item.publishedAt).toLocaleString("ja-JP")}{item.visibleUntil ? ` · 終了：${new Date(item.visibleUntil).toLocaleString("ja-JP")}` : ""}</small>
                  </article>
                )}</div>}
          {announcementLoad === "ready" && regularAnnouncements.length > 3 &&
            <button type="button" className="workhub-secondary-button workhub-announcement-view-toggle" aria-controls="workhub-announcement-list" aria-expanded={showAllAnnouncements} onClick={() => setShowAllAnnouncements(current => !current)}>
              {showAllAnnouncements ? "最新3件に戻す" : "すべてのお知らせを見る"}
            </button>}
          <small className="workhub-reference-note">現在の配信対象・掲載期間内の公式お知らせのみ表示します。重要度順で最新3件、展開時は最大10件の同一一覧です。緊急Bannerに掲示したお知らせは重複表示しません。</small>
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
        <section className="workhub-people" id="workhub-people" aria-labelledby="workhub-people-title">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">PEOPLE / ORGANIZATION</span><h2 id="workhub-people-title">社員・組織</h2></div>
            <button className="workhub-secondary-button" type="button" disabled={peopleState === "loading"} onClick={() => void loadPeople()}>社員一覧を更新</button>
          </div>
          <p>誰に何を相談できるかを確認するためのデモ社員一覧です。実際の人事情報・連絡先ではありません。</p>
          {peopleState === "loading" ? <p role="status">社員一覧を読み込んでいます…</p> :
            peopleState === "error" ? <div role="alert"><p>社員一覧を取得できません。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadPeople()}>再読み込み</button></div> :
              people.length === 0 ? <p className="workhub-empty-state">表示できる社員データはありません。</p> :
                <div className="workhub-people-grid">{people.map((person, index) =>
                  <article id={`workhub-person-reference-person-${index + 1}`} tabIndex={-1} className="workhub-people-card" key={person.displayName} aria-label={`社員 ${person.displayName}`}>
                    <strong>{person.displayName}</strong><p>{person.roleLabel}</p><small>{person.organizationLabel}</small>
                  </article>
                )}</div>}
        </section>
        <section className="workhub-documents" id="workhub-documents" aria-labelledby="workhub-documents-title">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">DOCUMENTS / KNOWLEDGE</span><h2 id="workhub-documents-title">ナレッジ</h2></div>
            <button type="button" className="workhub-secondary-button" disabled={documentsState === "loading"} onClick={() => void loadDocuments()}>文書一覧を更新</button>
          </div>
          <p>業務文書の版と確認状況を判断するデモ一覧です。実際の社内規程や運用手順ではありません。</p>
          {documentsState === "loading" ? <p role="status">文書一覧を読み込んでいます…</p> :
            documentsState === "error" ? <div role="alert"><p>文書一覧を取得できません。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadDocuments()}>再読み込み</button></div> :
              documents.length === 0 ? <p className="workhub-empty-state">閲覧できるデモ文書はありません。</p> :
                <div className="workhub-document-grid">{documents.map(doc =>
                  <article id={`workhub-document-${doc.id}`} tabIndex={-1} className="workhub-document-card" aria-label={`文書 ${doc.title}`} key={doc.id}>
                    <div className="workhub-document-card-top"><span>{doc.category}</span><strong className={`workhub-document-state is-${doc.state}`}>{doc.state === "current" ? "現行" : doc.state === "stale" ? "要再確認" : "旧版・参照注意"}</strong></div>
                    <strong className="workhub-document-title">{doc.title}</strong>
                    <p>{doc.summary}</p>
                    <dl><div><dt>版</dt><dd>v{doc.version}</dd></div><div><dt>管理者</dt><dd>{doc.ownerLabel}</dd></div><div><dt>確認日：</dt><dd>{doc.reviewedAt}</dd></div></dl>
                    {doc.state === "superseded" && <p className="workhub-document-warning">現行文書：{doc.replacementTitle ?? "管理者に確認してください"}</p>}
                    {doc.state === "stale" && <p className="workhub-document-warning">この版は担当者の再確認が必要です。</p>}
                  </article>
                )}</div>}
        </section>
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
          {isAoi && <article className="workhub-home-card workhub-home-card-primary" id="workhub-travel-form"><span className="workhub-card-label">REQUESTS / 出張したい</span><h2>{awaitingResubmission ? "出張申請を修正" : "出張申請"}</h2>{cecilDraftPrepared && !awaitingResubmission && <p role="status" className="workhub-reference-note">Ask CECILで準備した値を入力欄へ反映しました。まだ保存・提出されていません。内容を確認してから本人が提出を判断してください。</p>}{awaitingResubmission && <div className="workhub-return-reason" role="note"><strong>差戻し理由</strong><p>{returnComment?.trim() || "理由の記載がありません。承認者に確認してください。"}</p></div>}<div className="workhub-business-form"><label>行先<select aria-label="行先" value={destinationOfficeItemId} onChange={(event) => { setDestinationOfficeItemId(event.target.value); setCecilTravelReview(null); }}>{offices.map((office) => <option key={office.itemId} value={office.itemId}>{office.label} ({office.code})</option>)}</select></label><label>開始日<input aria-label="開始日" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setCecilTravelReview(null); }} /></label><label>終了日<input aria-label="終了日" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setCecilTravelReview(null); }} /></label><label>目的<textarea id="workhub-travel-purpose" aria-label="目的" value={purpose} onChange={(event) => { setPurpose(event.target.value); setCecilTravelReview(null); }} /></label>{awaitingResubmission ? <button className="workhub-primary-button" type="button" disabled={busy} onClick={updateAndResubmit}>修正して再申請</button> : <button className="workhub-primary-button" type="button" disabled={busy} onClick={createAndSubmit}>出張申請を提出</button>}</div></article>}
          <article className="workhub-home-card" id="workhub-notifications"><span className="workhub-card-label">NOTIFICATIONS</span><h2>通知 {notificationState === "ready" && unreadCount > 0 ? `(${unreadCount})` : ""}</h2>{
            notificationState === "loading" ? <p role="status">通知を確認しています…</p>
            : notificationState === "error" ? <div role="alert"><p>通知を取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadNotifications()}>通知を再読み込み</button></div>
            : notifications.length === 0 ? <p className="workhub-empty-state">通知はありません。</p>
            : homeNotifications.length === 0 ? <p className="workhub-empty-state">この通知は「今日対応すること」に代表表示しています。通知センターではすべて確認できます。</p>
            : <div className="workhub-notification-list">{homeNotifications.map(notification =>
              <button key={notification.id} type="button" className={`workhub-notification-item ${notification.readAt ? "is-read" : ""}`} onClick={() => openNotification(notification)}>
                <strong>{NOTIFICATION_LABELS[notification.notificationType] ?? notification.notificationType}</strong>
                <small>{new Date(notification.createdAt).toLocaleString("ja-JP")}</small>
              </button>
            )}</div>
          }
          {notificationState === "ready" && homeSuppressedNotification && homeNotifications.length > 0 &&
            <small className="workhub-reference-note">対応が必要な同じ申請は「今日対応すること」に表示しています。通知そのものは消していません。</small>}
          <button className="workhub-secondary-button" type="button" onClick={openNotificationCenter}>すべての通知を見る</button>
          </article>
          <section className="workhub-home-card workhub-social-preview" aria-label="社内交流プレビュー">
            <span className="workhub-card-label">SOCIAL / COMMUNITY</span><h2>社内交流</h2>
            {socialState === "loading" ? <p role="status">社内交流を読み込み中…</p> :
              socialState === "error" ? <p>社内交流を取得できませんでした。0件とは限りません。</p> :
                socialPosts.length === 0 ? <p className="workhub-empty-state">表示できる交流投稿はありません。</p> :
                  socialPosts.slice(0, 2).map(post =>
                    <article key={post.id} className="workhub-social-preview-item">
                      <small>{SOCIAL_CATEGORY_LABELS[post.category]}・参考投稿</small><strong>{post.title}</strong>
                    </article>)}
            <a className="workhub-work-link" href="#workhub-social">社内交流フィードを見る</a>
          </section>
          {selectedRequest && <article className="workhub-home-card" id="workhub-request-detail"><span className="workhub-card-label">MY REQUEST DETAIL</span><h2>{selectedRequest.purpose}</h2><p>{selectedRequest.startDate} → {selectedRequest.endDate}</p><p>Workflow: <strong>{selectedWorkflow?.state ?? selectedRequest.status}</strong></p>{isAoi && selectedRequest.status === "submitted" && <div className="workhub-travel-print-action">
              <button className="workhub-secondary-button" type="button" disabled={busy} onClick={printTravelRequest}>申請内容を印刷・PDF保存</button>
              <small>ブラウザの印刷画面からPDF保存できます。承認結果の履歴固定PDFではありません。</small>
            </div>}<div className="workhub-timeline" aria-label="申請履歴">{timeline.length === 0 ? <p>履歴はまだありません。</p> : timeline.map((activity) => <div key={activity.id} className="workhub-timeline-item"><strong>{TIMELINE_LABELS[activity.activityType] ?? activity.activityType}</strong><small>{new Date(activity.occurredAt).toLocaleString("ja-JP")}</small></div>)}</div></article>}
          {!isAoi && !isRen && <article className="workhub-home-card workhub-home-card-primary"><span className="workhub-card-label">あなたの優先エリア</span><h2>{reference?.hint ?? "MY WORK"}</h2><p>このReferenceではPersonaごとにHOMEの優先領域を変えます。</p></article>}
        </section>
        <ExpenseWorkspace principalId={user?.id ?? ""} selectedTravelRequestId={journeyTravelId} selectedExpense={expenseSelection} onChanged={() => void loadMyRequests()} />
        <section className="workhub-social" id="workhub-social" aria-labelledby="workhub-social-title" aria-label="社内交流フィード">
          <div className="workhub-section-heading">
            <div><span className="workhub-card-label">SOCIAL FEED / REFERENCE</span><h2 id="workhub-social-title">社内交流フィード</h2></div>
            <button className="workhub-secondary-button" type="button" disabled={socialState === "loading"} onClick={() => void loadSocial()}>フィードを更新</button>
          </div>
          <p>社内コミュニティの架空の参考投稿です。公式のお知らせや規程ではありません。実際のリアクションやコメントの操作はできません。</p>
          {socialState === "loading" ? <p role="status">フィードを読み込んでいます…</p> :
            socialState === "error" ? <div role="alert"><p>社内交流を取得できませんでした。0件とは限りません。</p><button className="workhub-secondary-button" type="button" onClick={() => void loadSocial()}>再読み込み</button></div> :
              socialPosts.length === 0 ? <p className="workhub-empty-state">表示できる交流投稿はありません。</p> :
                <div className="workhub-social-list">{socialPosts.map(post =>
                  <article className="workhub-social-item" key={post.id}>
                    <span className="workhub-social-kind">{SOCIAL_CATEGORY_LABELS[post.category]}・デモ</span>
                    <h3>{post.title}</h3><p>{post.body}</p>
                    <small>{post.authorLabel} · {new Date(post.createdAt).toLocaleString("ja-JP")}</small>
                    <p className="workhub-social-counts">リアクション {post.reactionCount}件 · コメント {post.commentCount}件（デモ・閲覧のみ）</p>
                  </article>)}</div>}
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
