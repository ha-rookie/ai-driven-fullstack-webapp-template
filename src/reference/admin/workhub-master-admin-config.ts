import {
  WORKHUB_RETIRE_DEMO_ITEM_ID, WORKHUB_SCHEDULE_DEMO_ITEM_ID,
  WORKHUB_ORDER_DEMO_ITEM_ID, WORKHUB_AVAILABILITY_DISABLE_ITEM_ID,
  WORKHUB_AVAILABILITY_ENABLE_ITEM_ID,
} from "../workhub/travel-request";
import type { MasterOperationLink } from "./MasterDataViewer";

/**
 * WORKHUB project-specific presentation metadata, NOT an authorization grant.
 * The API independently checks environment, principal, scope, operation policy,
 * target allowlists, version, confirmation and durable audit.
 */
export const WORKHUB_MASTER_ADMIN_CONFIG: {
  readonly scopeId: string;
  readonly masterKey: string;
  readonly operations: Readonly<Record<string, MasterOperationLink>>;
} = {
  scopeId: "workhub-company",
  masterKey: "workhub.office",
  operations: {
    [WORKHUB_RETIRE_DEMO_ITEM_ID]: { href: "#admin-master-retire-demo", label: "廃止操作の下見へ" },
    [WORKHUB_SCHEDULE_DEMO_ITEM_ID]: { href: "#admin-master-schedule-demo", label: "将来Revision予約の下見へ" },
    [WORKHUB_ORDER_DEMO_ITEM_ID]: { href: "#admin-master-order-demo", label: "将来表示順変更の下見へ" },
    [WORKHUB_AVAILABILITY_DISABLE_ITEM_ID]: { href: "#admin-master-availability", label: "有効・無効切替の下見へ" },
    [WORKHUB_AVAILABILITY_ENABLE_ITEM_ID]: { href: "#admin-master-availability", label: "有効・無効切替の下見へ" },
  },
};
