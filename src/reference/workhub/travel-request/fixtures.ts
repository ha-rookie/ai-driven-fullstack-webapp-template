import type { MasterDefinition } from "../../../worker/master-data";
import type {
  WorkflowAssigneeResolver,
  WorkflowDefinition,
} from "../../../worker/workflow";

export const WORKHUB_OFFICE_MASTER_KEY = "workhub.office";
export const WORKHUB_RETIRE_DEMO_ITEM_ID = "workhub-office-legacy";
export const WORKHUB_SCHEDULE_DEMO_ITEM_ID = "workhub-office-schedule";
export const WORKHUB_TRAVEL_WORKFLOW_KEY = "workhub.travel_request_approval";
export const WORKHUB_TRAVEL_WORKFLOW_VERSION = 1;
export const WORKHUB_TRAVEL_MANAGER_RESOLVER_KEY = "workhub.manager";
export const WORKHUB_TRAVEL_RESOURCE_TYPE = "workhub.travel_request";

export const WORKHUB_OFFICE_MASTER_DEFINITION: MasterDefinition = {
  key: WORKHUB_OFFICE_MASTER_KEY,
  schemaVersion: 1,
  supportsHierarchy: false,
  validateCode(code) {
    if (!/^[A-Z0-9_]+$/u.test(code)) throw new Error("office code must use A-Z, 0-9, or underscore");
  },
  validateAttributes(attributes) {
    if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
      throw new Error("office attributes must be an object");
    }
  },
};

export const WORKHUB_REFERENCE_OFFICES = [
  { code: "NAGOYA", label: "Nagoya Office", displayOrder: 10 },
  { code: "TOKYO", label: "Tokyo Office", displayOrder: 20 },
] as const;

export const WORKHUB_TRAVEL_WORKFLOW_DEFINITION: WorkflowDefinition = {
  key: WORKHUB_TRAVEL_WORKFLOW_KEY,
  version: WORKHUB_TRAVEL_WORKFLOW_VERSION,
  allowWithdrawWhileActive: true,
  allowWithdrawWhileAwaitingResubmission: true,
  steps: [{
    key: "manager_approval",
    assigneeResolverKey: WORKHUB_TRAVEL_MANAGER_RESOLVER_KEY,
    reasonPolicy: { return: "required", reject: "required" },
  }],
};

const WORKHUB_MANAGER_BY_REQUESTER = new Map<string, string>([
  ["workhub-demo-aoi", "workhub-demo-ren"],
]);

export const WORKHUB_TRAVEL_ASSIGNEE_RESOLVER: WorkflowAssigneeResolver = {
  async resolve(resolverKey, context) {
    if (resolverKey !== WORKHUB_TRAVEL_MANAGER_RESOLVER_KEY) return null;
    return WORKHUB_MANAGER_BY_REQUESTER.get(context.requesterId) ?? null;
  },
};
