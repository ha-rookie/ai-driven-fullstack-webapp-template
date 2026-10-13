/**
 * WORKHUB Stage6 Reference-only static screen-to-source index.
 * This file contains NO user/business records, secrets, logs, SQL or
 * deployment configuration and MUST NOT be treated as an authorization source.
 */
export type DeveloperScreenId = "home" | "requests" | "my-work" | "search" | "apps" | "people" | "documents" | "notifications" | "ask-cecil";
export type DeveloperReadiness = "production-pattern" | "reference-implementation" | "mock-adapter" | "not-implemented";
export type DeveloperLocale = "ja-JP" | "en-US";
export interface DeveloperScreen {
  readonly id: DeveloperScreenId;
  readonly title: { readonly ja: string; readonly en: string };
  readonly scenario: string;
  readonly capabilities: readonly string[];
  readonly sourceOfTruth: readonly { readonly view: string; readonly owner: string; readonly kind: "domain" | "workflow" | "projection" | "adapter" | "catalog" }[];
  readonly authorization: string;
  readonly readiness: readonly { readonly component: string; readonly state: DeveloperReadiness }[];
  readonly limitations: readonly string[];
  readonly docs: readonly string[];
  readonly source: readonly string[];
}
const ROOT = "https://github.com/ha-rookie/ai-driven-fullstack-webapp-template/blob/main/";
export const developerSourceUrl = (relativePath: string): string | null =>
  /^(?:src|docs|tests|e2e)\/[a-zA-Z0-9/_-]+\.(?:ts|tsx|md)$/u.test(relativePath)
    ? ROOT + relativePath : null;

/** Local development + exact WORKHUB Reference Preview only.
 * Production custom domains have no entry by default. This is UI exposure
 * control for PUBLIC-SAFE static metadata, not a security entitlement. */
export const isDeveloperReferenceEnvironment = (hostname: string, isDevelopment: boolean): boolean =>
  isDevelopment
    ? hostname === "localhost" || hostname === "127.0.0.1"
    : hostname === "ai-driven-fullstack-webapp-template-preview.ha-rookie.workers.dev";

export const developerScreens: readonly DeveloperScreen[] = [
  {
    id: "home", title: { ja: "ホーム", en: "Home" }, scenario: "common.home",
    capabilities: ["Session / Authentication", "MY WORK", "Notification", "Authorization-aware Search"],
    sourceOfTruth: [
      { view: "MY WORK", owner: "Workflow / task assignment", kind: "projection" },
      { view: "Important News", owner: "Announcement Domain", kind: "domain" },
      { view: "Search results", owner: "Authorization-aware Search", kind: "projection" },
    ],
    authorization: "Current principal and server-side resource scope. Developer entitlement grants no business-data access.",
    readiness: [{ component: "WORKHUB HOME", state: "reference-implementation" }, { component: "Session / Auth", state: "production-pattern" }],
    limitations: ["HOME is a read projection, not a new source of business truth."],
    docs: ["docs/reference/WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md"],
    source: ["src/App.tsx", "src/reference/workhub/my-requests.ts"],
  },
  {
    id: "requests", title: { ja: "出張申請・手続き", en: "Travel requests" }, scenario: "travel-request-settlement",
    capabilities: ["TravelRequest Application Service", "Master Data", "Human Workflow", "Mutation integrity", "Timeline"],
    sourceOfTruth: [
      { view: "Request fields", owner: "Travel Request Domain", kind: "domain" },
      { view: "Approval assignment", owner: "Human Workflow / Work Item", kind: "workflow" },
      { view: "MY REQUESTS", owner: "WORKHUB request projection", kind: "projection" },
    ],
    authorization: "Submitter: own travel requests. Approver: assigned work item only, not all subordinate data.",
    readiness: [{ component: "TravelRequest", state: "reference-implementation" }, { component: "Workflow", state: "production-pattern" }],
    limitations: ["Demo scenario is domestic travel; not a commercial travel booking or payroll service."],
    docs: ["docs/reference/WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md"],
    source: ["src/App.tsx", "src/reference/workhub/travel-request/service.ts"],
  },
  {
    id: "my-work", title: { ja: "自分のタスク", en: "My work" }, scenario: "common.my-work",
    capabilities: ["Assigned workflow tasks", "Action-required projection", "Role-aware read"],
    sourceOfTruth: [
      { view: "Pending approvals", owner: "Workflow work items", kind: "workflow" },
      { view: "Card order", owner: "MY WORK projection", kind: "projection" },
    ],
    authorization: "Only current user assignments; system administrator role does not grant business access.",
    readiness: [{ component: "MY WORK", state: "reference-implementation" }],
    limitations: ["Home cards are projections; always reopen the authoritative workflow for decisions."],
    docs: [], source: ["src/App.tsx", "src/reference/workhub/my-requests.ts"],
  },
  {
    id: "search", title: { ja: "社内検索", en: "Search" }, scenario: "common.find",
    capabilities: ["Authorization-aware Search", "Document governance", "Safe internal deep-link"],
    sourceOfTruth: [
      { view: "Search candidates", owner: "Search index / projection", kind: "projection" },
      { view: "Visible documents", owner: "Current Document Domain", kind: "domain" },
    ],
    authorization: "Search candidates and target hydration both use current server Authorization.",
    readiness: [{ component: "Search", state: "production-pattern" }],
    limitations: ["Search index is not authorization or business source of truth."],
    docs: ["docs/reference/WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md"],
    source: ["src/App.tsx", "src/reference/workhub/ask-cecil.ts"],
  },
  {
    id: "apps", title: { ja: "アプリ一覧", en: "App launcher" }, scenario: "common.app-discovery",
    capabilities: ["App catalog", "Available-to-user projection", "Role-aware launch"],
    sourceOfTruth: [{ view: "App availability", owner: "App catalog + server authorization", kind: "catalog" }],
    authorization: "Availability is server-scoped; visible catalog does not grant third-party access.",
    readiness: [{ component: "App launcher", state: "reference-implementation" }, { component: "External SaaS", state: "mock-adapter" }],
    limitations: ["Real SSO provisioning and external SaaS integrations are not included."],
    docs: [], source: ["src/reference/workhub/WorkhubAppLauncher.tsx"],
  },
  {
    id: "people", title: { ja: "組織・人", en: "People & organization" }, scenario: "common.people",
    capabilities: ["People directory", "Minimum-necessary profile display"],
    sourceOfTruth: [{ view: "Directory entries", owner: "People / HR Adapter", kind: "adapter" }],
    authorization: "Only currently visible basic directory attributes; no private HR profiles.",
    readiness: [{ component: "People directory", state: "reference-implementation" }],
    limitations: ["This is not an HR system or authoritative payroll directory."],
    docs: [], source: ["src/App.tsx"],
  },
  {
    id: "documents", title: { ja: "ナレッジ", en: "Documents & knowledge" }, scenario: "common.knowledge",
    capabilities: ["Document governance", "Version / Owner / ReviewedAt", "Scoped access"],
    sourceOfTruth: [{ view: "Current content", owner: "Documents / Knowledge", kind: "domain" }],
    authorization: "Current membership applies to documents, including AI retrieval.",
    readiness: [{ component: "Documents", state: "reference-implementation" }],
    limitations: ["Stale/superseded references are not authoritative guidance."],
    docs: ["docs/reference/WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md"],
    source: ["src/App.tsx"],
  },
  {
    id: "notifications", title: { ja: "通知", en: "Notifications" }, scenario: "common.notification",
    capabilities: ["Transactional notification", "Unread count", "Source links"],
    sourceOfTruth: [
      { view: "Notification read state", owner: "Notification Store", kind: "domain" },
      { view: "Approval needed", owner: "Workflow / MY WORK projection", kind: "projection" },
    ],
    authorization: "Only notifications issued for the signed-in principal.",
    readiness: [{ component: "Notification center", state: "reference-implementation" }],
    limitations: ["Marking notification read never completes a workflow task."],
    docs: [], source: ["src/App.tsx"],
  },
  {
    id: "ask-cecil", title: { ja: "Ask CECIL", en: "Ask CECIL" }, scenario: "travel-request-assistant",
    capabilities: ["Evidence-first Answer", "Scoped Find", "Draft-first L2", "Human-confirm L3", "Manual Escalate"],
    sourceOfTruth: [
      { view: "Answer provenance", owner: "Authorized Document / Search", kind: "projection" },
      { view: "Submitted travel", owner: "Travel Request / Workflow", kind: "domain" },
    ],
    authorization: "Retrieval uses ordinary server Authorization; AI cannot approve or submit without human confirmation.",
    readiness: [{ component: "Reference concierge", state: "reference-implementation" }, { component: "Autonomous privileged action", state: "not-implemented" }],
    limitations: ["No autonomous LLM actor or ticket sending; user-owned action and manual escalation only."],
    docs: ["docs/reference/WORKHUB_STAGE5_ASK_CECIL_ACCEPTANCE.md"],
    source: ["src/reference/workhub/AskCecilPanel.tsx", "src/reference/workhub/ask-cecil.ts"],
  },
];

export const developerScreenFromRoute = (
  fragment: string, notificationOpen = false, askCecilOpen = false,
): DeveloperScreenId => {
  if (askCecilOpen) return "ask-cecil";
  if (notificationOpen) return "notifications";
  if (/^#workhub-(?:request|travel|expense)/u.test(fragment)) return "requests";
  if (fragment.startsWith("#workhub-my-work")) return "my-work";
  if (fragment.startsWith("#workhub-apps")) return "apps";
  if (fragment.startsWith("#workhub-people")) return "people";
  if (fragment.startsWith("#workhub-documents")) return "documents";
  if (fragment.startsWith("#workhub-notifications")) return "notifications";
  if (fragment.startsWith("#workhub-search")) return "search";
  return "home";
};
export const findDeveloperScreen = (id: DeveloperScreenId): DeveloperScreen =>
  developerScreens.find(item => item.id === id) ?? developerScreens[0];
