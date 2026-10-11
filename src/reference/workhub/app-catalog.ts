/**
 * WORKHUB Reference App Catalog (#352).
 * This is demo-only metadata. The Worker checks the current scope membership
 * before returning these entries; actual APIs retain their own Authorization.
 */
export const WORKHUB_APP_SCOPE_ID = "workhub-company";

export type WorkhubAppAvailability = "available" | "unavailable";
export type WorkhubAppCategory = "申請・手続き" | "経理・財務" | "コミュニケーション" | "組織・人" | "システム";

export interface WorkhubAppEntry {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: WorkhubAppCategory;
  readonly sourceSystem: string;
  readonly availability: WorkhubAppAvailability;
  readonly launchTarget: string | null;
}

interface ReferenceAppDefinition extends WorkhubAppEntry {
  readonly allowedRoles: readonly string[];
}

const EVERY_ROLE = ["newcomer", "employee", "manager", "accounting", "corporate", "system_admin"] as const;

/** Explicit internal routes only; no arbitrary external URLs or non-existent app actions. */
const REFERENCE_APPS: readonly ReferenceAppDefinition[] = [
  {
    key: "travel-request", displayName: "出張申請", description: "出張を申請する",
    category: "申請・手続き", sourceSystem: "WORKHUB",
    availability: "available", launchTarget: "/#workhub-requests", allowedRoles: ["employee"],
  },
  {
    key: "approval-tasks", displayName: "承認タスク", description: "担当する申請を確認・処理する",
    category: "申請・手続き", sourceSystem: "WORKHUB",
    availability: "available", launchTarget: "/#workhub-my-work", allowedRoles: ["manager"],
  },
  {
    key: "expense-settlement", displayName: "交通費・経費精算", description: "出張費用を申請・確認する",
    category: "経理・財務", sourceSystem: "WORKHUB",
    availability: "available", launchTarget: "/#workhub-expenses", allowedRoles: ["employee", "accounting"],
  },
  {
    key: "announcements", displayName: "社内お知らせ", description: "会社からのお知らせを読む",
    category: "コミュニケーション", sourceSystem: "WORKHUB",
    availability: "available", launchTarget: "/#workhub-announcements", allowedRoles: EVERY_ROLE,
  },
  {
    key: "directory", displayName: "社員・組織", description: "社員や組織の情報を探す（未接続）",
    category: "組織・人", sourceSystem: "Reference / not connected",
    availability: "unavailable", launchTarget: null, allowedRoles: EVERY_ROLE,
  },
  {
    key: "admin-portal", displayName: "管理ポータル", description: "システムの運用状況を確認する",
    category: "システム", sourceSystem: "WORKHUB",
    availability: "available", launchTarget: "/admin", allowedRoles: ["system_admin"],
  },
];

export const listWorkhubApps = (currentRole: string): readonly WorkhubAppEntry[] =>
  REFERENCE_APPS.filter(app => app.allowedRoles.includes(currentRole)).map(app => ({
    key: app.key,
    displayName: app.displayName,
    description: app.description,
    category: app.category,
    sourceSystem: app.sourceSystem,
    availability: app.availability,
    launchTarget: app.launchTarget,
  }));

/**
 * Project the *same* current-role-filtered app catalog into the WORKHUB global
 * search contract. Only connected apps receive launch results; the caller's
 * role must come from the current server-side membership, never the query.
 */
export interface WorkhubAppSearchResult {
  readonly resourceType: "workhub_app";
  readonly resourceId: string;
  readonly category: "apps";
  readonly title: string;
  readonly snippet: string;
  readonly actionTarget: string;
}

export const searchWorkhubApps = (
  currentRole: string,
  searchText: string,
): readonly WorkhubAppSearchResult[] => {
  const term = searchText.trim().toLocaleLowerCase("ja-JP");
  if (!term) return [];

  const matches: WorkhubAppSearchResult[] = [];
  for (const app of listWorkhubApps(currentRole)) {
    if (app.availability !== "available" || !app.launchTarget) continue;
    if (![app.displayName, app.description, app.category]
      .some(value => value.toLocaleLowerCase("ja-JP").includes(term))) continue;

    matches.push({
      resourceType: "workhub_app",
      resourceId: app.key,
      category: "apps",
      title: app.displayName,
      snippet: app.description,
      actionTarget: app.launchTarget,
    });
  }
  return matches;
};

/**
 * Stage 1 Reference HOME shortcuts use the same *already authorized* app list
 * as the launcher. These are fixed-order demo links, not actual usage statistics
 * or #292 personal favorites/recent history.
 */
export type WorkhubLaunchableApp = WorkhubAppEntry & {
  readonly availability: "available";
  readonly launchTarget: string;
};

const isWorkhubLaunchableApp = (app: WorkhubAppEntry): app is WorkhubLaunchableApp =>
  app.availability === "available"
  && app.launchTarget !== null
  && /^\/(?:#workhub-[a-z-]+|admin)$/u.test(app.launchTarget);

export const selectWorkhubHomeShortcuts = (
  authorizedApps: readonly WorkhubAppEntry[],
): readonly WorkhubLaunchableApp[] =>
  authorizedApps.filter(isWorkhubLaunchableApp).slice(0, 4);
