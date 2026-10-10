import {
  WORKHUB_RETIRE_DEMO_ITEM_ID, WORKHUB_SCHEDULE_DEMO_ITEM_ID,
  WORKHUB_ORDER_DEMO_ITEM_ID, WORKHUB_AVAILABILITY_DISABLE_ITEM_ID,
  WORKHUB_AVAILABILITY_ENABLE_ITEM_ID, WORKHUB_OFFICE_MASTER_KEY,
  WORKHUB_EXPENSE_CATEGORY_MASTER_KEY,
} from "../workhub/travel-request";
import { buildMasterOperationLinks, type MasterProjectOperationConfig, type MasterViewDefinition } from "./master-admin-operation-config";

/**
 * WORKHUB is a reference Project: its declared targets and labels are
 * presentation metadata, NEVER a server-side capability or permission grant.
 * The server enforces an independent, strict, project-approved allowlist.
 */
const scopeId = "workhub-company";
const masterKey = WORKHUB_OFFICE_MASTER_KEY;
const target = (itemId: string) => ({ scopeId, masterKey, itemId });
const projectOperations: MasterProjectOperationConfig = {
  scopeId, masterKey,
  retireTarget: target(WORKHUB_RETIRE_DEMO_ITEM_ID),
  scheduleTargets: [
    { ...target(WORKHUB_SCHEDULE_DEMO_ITEM_ID), variant: "revision",
      effectiveFrom: "2027-04-01T00:00:00.000Z", label: "Scheduled Office Next" },
    { ...target(WORKHUB_ORDER_DEMO_ITEM_ID), variant: "order",
      effectiveFrom: "2027-10-01T00:00:00.000Z", label: "Order demo unchanged", displayOrder: 73 },
  ],
  availabilityTargets: [
    { ...target(WORKHUB_AVAILABILITY_DISABLE_ITEM_ID), enabled: false, label: "有効 → 将来無効" },
    { ...target(WORKHUB_AVAILABILITY_ENABLE_ITEM_ID), enabled: true, label: "無効 → 将来有効" },
  ],
};

/** Master definitions are Project display metadata, not grants.
 * The Worker independently allows both keys and never provides a mutation
 * capability for the reference expense-category definition.
 */
const definitions: readonly [MasterViewDefinition, ...MasterViewDefinition[]] = [{
  masterKey,
  label: "拠点マスタ（WORKHUB）",
  operations: buildMasterOperationLinks(projectOperations),
}, {
  masterKey: WORKHUB_EXPENSE_CATEGORY_MASTER_KEY,
  label: "費目カテゴリ（参照専用サンプル）",
  operations: Object.freeze({}),
}];

/** The same Project declaration configures read-only navigation AND bounded forms. */
export const WORKHUB_MASTER_ADMIN_CONFIG = {
  ...projectOperations,
  definitions,
};
