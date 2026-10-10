/**
 * Project-supplied Master operation presentation configuration.
 * This is NOT a permission source: server-side scope, definition, target
 * allowlist, role, operation policy and Production Human Gate are authoritative.
 */
export interface MasterTarget {
  readonly scopeId: string;
  readonly masterKey: string;
  readonly itemId: string;
}
export interface MasterScheduleTarget extends MasterTarget {
  readonly variant: "revision" | "order";
  readonly effectiveFrom: string;
  readonly label: string;
  readonly displayOrder?: number;
}
export interface MasterAvailabilityTarget extends MasterTarget {
  readonly enabled: boolean;
  readonly label: string;
}
export interface MasterOperationLink {
  readonly href: `#${string}`;
  readonly label: string;
}
export interface MasterProjectOperationConfig {
  readonly scopeId: string;
  readonly masterKey: string;
  readonly retireTarget: MasterTarget;
  readonly scheduleTargets: readonly MasterScheduleTarget[];
  readonly availabilityTargets: readonly [MasterAvailabilityTarget, ...MasterAvailabilityTarget[]];
}

/**
 * Fail closed if a declared item is off-definition or appears in multiple
 * incompatible actions. The UI must never suggest a wrong-target operation.
 */
export function buildMasterOperationLinks(
  config: MasterProjectOperationConfig,
): Readonly<Record<string, MasterOperationLink>> {
  const links: Record<string, MasterOperationLink> = Object.create(null) as Record<string, MasterOperationLink>;
  const duplicates = new Set<string>();
  const add = (target: MasterTarget, link: MasterOperationLink) => {
    if (target.scopeId !== config.scopeId || target.masterKey !== config.masterKey || !target.itemId) return;
    if (Object.prototype.hasOwnProperty.call(links, target.itemId)) {
      delete links[target.itemId];
      duplicates.add(target.itemId);
    }
    if (!duplicates.has(target.itemId)) links[target.itemId] = link;
  };
  add(config.retireTarget, { href: "#admin-master-retire-demo", label: "廃止操作の下見へ" });
  for (const target of config.scheduleTargets) {
    add(target, target.variant === "order"
      ? { href: "#admin-master-order-demo", label: "将来表示順変更の下見へ" }
      : { href: "#admin-master-schedule-demo", label: "将来Revision予約の下見へ" });
  }
  for (const target of config.availabilityTargets) {
    add(target, { href: "#admin-master-availability", label: "有効・無効切替の下見へ" });
  }
  return links;
}
