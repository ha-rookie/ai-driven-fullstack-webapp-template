import { D1OperationModeStore } from "../infrastructure/d1-operation-mode-store";
import {
  D1TravelRequestStore,
  TravelRequestError,
  TravelRequestService,
  WORKHUB_OFFICE_MASTER_DEFINITION,
  WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
  WORKHUB_TRAVEL_RESOURCE_TYPE,
  WORKHUB_TRAVEL_WORKFLOW_DEFINITION,
} from "../reference/workhub/travel-request";
import {
  WORKHUB_TRAVEL_NOTIFICATION_POLICY,
  WORKHUB_TRAVEL_NOTIFICATION_RECIPIENTS,
  WorkhubWorkflowProjectionFanOut,
} from "../reference/workhub/travel-request/integration";
import { resolveApplicationSession } from "./auth";
import {
  BusinessActivityProjector,
  BusinessActivityTimelineService,
  D1BusinessActivityStore,
  WorkflowBusinessActivityProjector,
} from "./business-activity";
import {
  D1MasterDataStore,
  MasterDataService,
  StaticMasterDefinitionRegistry,
} from "./master-data";
import {
  D1TransactionalNotificationStore,
  TransactionalNotificationError,
  TransactionalNotificationService,
  WorkflowNotificationProjector,
} from "./transactional-notification";
import {
  D1WorkflowStore,
  StaticWorkflowDefinitionRegistry,
  WorkflowError,
  WorkflowService,
} from "./workflow";
import { resolveWorkhubRuntimeEnvironment } from "./workhub-login";
import {
  OperationModeGuard,
  operationModeRejectionResponse,
} from "./http/operation-mode";
import {
  csrfGuardFailureResponse,
  requireCsrfProtection,
} from "./http/csrf";
import { readJsonBody } from "./http/request-body";
import {
  D1SearchIndexStore,
  D1SearchProvider,
  InMemorySearchCursorCodec,
  SearchApplicationService,
  SearchRequestError,
  applySearchIndexProjection,
  type SearchCandidate,
} from "./search";
import {
  WorkhubTravelSearchProjector,
} from "../reference/workhub/travel-search";

export interface WorkhubBusinessApiEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
}

const json = (value: unknown, status = 200): Response =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

const error = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status);

const requestId = (request: Request): string =>
  request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const stringField = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? body[key] as string : "";

const intField = (body: Record<string, unknown>, key: string): number =>
  typeof body[key] === "number" && Number.isSafeInteger(body[key]) ? body[key] as number : -1;

const bodyRecord = async (request: Request): Promise<Record<string, unknown> | Response> => {
  const result = await readJsonBody(request);
  if (!result.ok) return error(result.status, result.code, result.message);
  return asRecord(result.value) ?? error(400, "invalid_body", "Request body must be a JSON object");
};

const statusForTravelError = (code: TravelRequestError["code"]): number => {
  if (code === "not_found") return 404;
  if (code === "forbidden") return 403;
  if (code === "conflict") return 409;
  if (code === "invalid_state" || code === "office_unavailable") return 409;
  if (code === "workflow_failed" || code === "recovery_required") return 503;
  return 400;
};

const statusForWorkflowError = (code: WorkflowError["code"]): number => {
  if (code === "not_found") return 404;
  if (code === "forbidden") return 403;
  if (code === "conflict" || code === "invalid_state") return 409;
  return 400;
};

const searchCursorCodec = new InMemorySearchCursorCodec();

const createServices = (db: D1Database, environment: string) => {
  const workflowStore = new D1WorkflowStore(db);
  const travelStore = new D1TravelRequestStore(db);
  const masterData = new MasterDataService({
    environment,
    store: new D1MasterDataStore(db),
    definitions: new StaticMasterDefinitionRegistry([WORKHUB_OFFICE_MASTER_DEFINITION]),
  });

  const activityStore = new D1BusinessActivityStore(db);
  const activityProjector = new BusinessActivityProjector({ environment, store: activityStore });
  const workflowActivity = new WorkflowBusinessActivityProjector({ workflowStore, projector: activityProjector });

  const notificationStore = new D1TransactionalNotificationStore(db);
  const notifications = new TransactionalNotificationService({
    environment,
    store: notificationStore,
    policy: WORKHUB_TRAVEL_NOTIFICATION_POLICY,
    recipients: WORKHUB_TRAVEL_NOTIFICATION_RECIPIENTS,
  });
  const workflowNotification = new WorkflowNotificationProjector({ workflowStore, notifications });

  const workflow = new WorkflowService({
    environment,
    store: workflowStore,
    definitions: new StaticWorkflowDefinitionRegistry([WORKHUB_TRAVEL_WORKFLOW_DEFINITION]),
    assignees: WORKHUB_TRAVEL_ASSIGNEE_RESOLVER,
    eventSink: new WorkhubWorkflowProjectionFanOut([workflowActivity, workflowNotification]),
  });

  const travel = new TravelRequestService({
    environment,
    store: travelStore,
    masterData,
    workflow,
    workflowState: workflowStore,
  });

  const searchIndex = new D1SearchIndexStore(db);
  const travelSearchProjector = new WorkhubTravelSearchProjector(travelStore);

  return { db, workflowStore, travelStore, masterData, activityStore, notifications, workflow, travel, searchIndex, travelSearchProjector };
};

const canReadTravelResource = async (
  principalId: string,
  requestIdValue: string,
  services: ReturnType<typeof createServices>,
  environment: string,
): Promise<boolean> => {
  const travel = await services.travelStore.get(requestIdValue, environment);
  if (!travel) return false;
  if (travel.requesterId === principalId) return true;
  if (!travel.workflowInstanceId) return false;
  const item = await services.workflowStore.getOpenWorkItem(travel.workflowInstanceId, environment);
  return item?.assigneePrincipal === principalId;
};

const refreshTravelSearchIndex = async (
  resourceId: string,
  services: ReturnType<typeof createServices>,
  environment: string,
): Promise<void> => {
  try {
    const projection = await services.travelSearchProjector.project({
      environment,
      resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE,
      resourceId,
    });
    if (projection) {
      await applySearchIndexProjection({
        projection,
        writer: services.searchIndex,
        indexedAt: new Date().toISOString(),
      });
    }
  } catch {
    // Search index is derived data. Business mutations must remain authoritative.
  }
};

const createWorkhubSearch = (
  principalId: string,
  services: ReturnType<typeof createServices>,
  environment: string,
) => new SearchApplicationService(
  new D1SearchProvider(services.db),
  {
    async authorizeBatch(input) {
      const decisions = [];
      for (const candidate of input.candidates) {
        const allowed = candidate.resourceType === WORKHUB_TRAVEL_RESOURCE_TYPE
          && await canReadTravelResource(principalId, candidate.resourceId, services, environment);
        decisions.push({ resourceType: candidate.resourceType, resourceId: candidate.resourceId, allowed });
      }
      return decisions;
    },
  },
  {
    async hydrateBatch(input) {
      const results = [];
      for (const candidate of input.candidates) {
        if (candidate.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE) continue;
        const travel = await services.travelStore.get(candidate.resourceId, environment);
        if (!travel) continue;
        results.push({
          resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE,
          resourceId: travel.id,
          category: candidate.category,
          title: travel.purpose,
          snippet: `${travel.startDate} → ${travel.endDate}`,
          actionTarget: `resource:travel_request:${travel.id}`,
          sourceUpdatedAt: travel.updatedAt,
        });
      }
      return results;
    },
  },
  searchCursorCodec,
);

const timelineFor = (
  principalId: string,
  services: ReturnType<typeof createServices>,
  environment: string,
) => new BusinessActivityTimelineService({
  environment,
  store: services.activityStore,
  authorizer: {
    async assertCanRead(context) {
      if (context.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE) throw new Error("forbidden");
      if (!await canReadTravelResource(principalId, context.resourceId, services, environment)) {
        throw new Error("forbidden");
      }
    },
  },
});

const requireApprovalAccess = async (
  principalId: string,
  instanceId: string,
  services: ReturnType<typeof createServices>,
  environment: string,
) => {
  const instance = await services.workflowStore.getInstance(instanceId, environment);
  if (!instance || instance.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE) return null;
  const workItem = await services.workflowStore.getOpenWorkItem(instance.id, environment);
  if (!workItem || workItem.assigneePrincipal !== principalId) return null;
  const travel = await services.travelStore.get(instance.resourceId, environment);
  if (!travel) return null;
  return { instance, workItem, travel };
};

export const handleWorkhubBusinessApi = async (
  request: Request,
  env: WorkhubBusinessApiEnvironment,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/workhub/")) return null;
  if (url.pathname.startsWith("/api/workhub/login") || url.pathname === "/api/workhub/csrf") return null;

  const rid = requestId(request);
  let environment: "local" | "test" | "preview" | "production";
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return error(503, "runtime_environment_required", "Runtime environment is unavailable");
  }

  const session = await resolveApplicationSession(request, env.DB);
  if (!session) return error(401, "authentication_required", "Authentication is required");
  const principalId = session.user.id;

  const operation = await new OperationModeGuard(
    new D1OperationModeStore(env.DB, environment),
    { environment, retryAfterSeconds: 30 },
  ).check(request);
  if (!operation.allowed) return operationModeRejectionResponse(operation, rid);

  const csrf = await requireCsrfProtection(request);
  if (!csrf.allowed) return csrfGuardFailureResponse(csrf, rid);

  const services = createServices(env.DB, environment);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/workhub/search") {
      const text = url.searchParams.get("q") ?? "";
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const response = await createWorkhubSearch(principalId, services, environment).search(
        { principalId, environment },
        { text, categories: ["requests"], limit: 20, ...(cursor ? { cursor } : {}) },
      );
      return json(response);
    }

    if (request.method === "GET" && pathname === "/api/workhub/offices") {
      const offices = await services.travel.listDestinationOffices();
      return json({ items: offices.map((office) => ({
        itemId: office.item.id,
        revisionId: office.revision.id,
        code: office.item.code,
        label: office.revision.label,
      })) });
    }

    if (request.method === "POST" && pathname === "/api/workhub/travel-requests") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const created = await services.travel.createDraft({
        principalId,
        destinationOfficeItemId: stringField(body, "destinationOfficeItemId"),
        startDate: stringField(body, "startDate"),
        endDate: stringField(body, "endDate"),
        purpose: stringField(body, "purpose"),
      });
      await refreshTravelSearchIndex(created.id, services, environment);
      return json({ request: created }, 201);
    }

    const travelMatch = pathname.match(/^\/api\/workhub\/travel-requests\/([^/]+)$/u);
    if (travelMatch && request.method === "GET") {
      const record = await services.travel.get(decodeURIComponent(travelMatch[1]), principalId);
      const workflowInstance = record.workflowInstanceId
        ? await services.workflowStore.getInstance(record.workflowInstanceId, environment)
        : null;
      return json({ request: record, workflow: workflowInstance });
    }
    if (travelMatch && request.method === "PUT") {
      const id = decodeURIComponent(travelMatch[1]);
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const current = await services.travel.get(id, principalId);
      const command = {
        id,
        principalId,
        expectedVersion: intField(body, "expectedVersion"),
        destinationOfficeItemId: stringField(body, "destinationOfficeItemId"),
        startDate: stringField(body, "startDate"),
        endDate: stringField(body, "endDate"),
        purpose: stringField(body, "purpose"),
      };
      const updated = current.status === "draft"
        ? await services.travel.updateDraft(command)
        : await services.travel.updateReturned(command);
      await refreshTravelSearchIndex(updated.id, services, environment);
      return json({ request: updated });
    }

    const submitMatch = pathname.match(/^\/api\/workhub\/travel-requests\/([^/]+)\/submit$/u);
    if (submitMatch && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const submitted = await services.travel.submit({
        id: decodeURIComponent(submitMatch[1]),
        principalId,
        expectedVersion: intField(body, "expectedVersion"),
        requestId: rid,
      });
      await refreshTravelSearchIndex(submitted.id, services, environment);
      return json({ request: submitted });
    }

    const resubmitMatch = pathname.match(/^\/api\/workhub\/travel-requests\/([^/]+)\/resubmit$/u);
    if (resubmitMatch && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const result = await services.travel.resubmit({
        id: decodeURIComponent(resubmitMatch[1]),
        principalId,
        expectedRequestVersion: intField(body, "expectedRequestVersion"),
        expectedWorkflowVersion: intField(body, "expectedWorkflowVersion"),
        requestId: rid,
      });
      await refreshTravelSearchIndex(result.request.id, services, environment);
      return json(result);
    }

    if (request.method === "GET" && pathname === "/api/workhub/my-work") {
      const items = await services.workflow.listMyOpenWorkItems(principalId, 50);
      const enriched = [];
      for (const item of items) {
        const instance = await services.workflowStore.getInstance(item.workflowInstanceId, environment);
        if (!instance || instance.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE) continue;
        const travel = await services.travelStore.get(instance.resourceId, environment);
        if (!travel) continue;
        enriched.push({ workItem: item, workflow: instance, request: travel });
      }
      return json({ items: enriched });
    }

    const approvalMatch = pathname.match(/^\/api\/workhub\/my-work\/([^/]+)$/u);
    if (approvalMatch && request.method === "GET") {
      const detail = await requireApprovalAccess(
        principalId,
        decodeURIComponent(approvalMatch[1]),
        services,
        environment,
      );
      return detail ? json(detail) : error(404, "work_item_not_found", "Work item is unavailable");
    }

    const actionMatch = pathname.match(/^\/api\/workhub\/workflows\/([^/]+)\/(approve|return)$/u);
    if (actionMatch && request.method === "POST") {
      const instanceId = decodeURIComponent(actionMatch[1]);
      const detail = await requireApprovalAccess(principalId, instanceId, services, environment);
      if (!detail) return error(404, "work_item_not_found", "Work item is unavailable");
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const command = {
        instanceId,
        actorId: principalId,
        expectedInstanceVersion: intField(body, "expectedInstanceVersion"),
        expectedWorkItemVersion: intField(body, "expectedWorkItemVersion"),
        reasonCode: stringField(body, "reasonCode") || undefined,
        comment: stringField(body, "comment") || undefined,
        requestId: rid,
      };
      const result = actionMatch[2] === "approve"
        ? await services.workflow.approve(command)
        : await services.workflow.returnForCorrection(command);
      return json(result);
    }

    const timelineMatch = pathname.match(/^\/api\/workhub\/travel-requests\/([^/]+)\/timeline$/u);
    if (timelineMatch && request.method === "GET") {
      const id = decodeURIComponent(timelineMatch[1]);
      const page = await timelineFor(principalId, services, environment).list({
        principalId,
        resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE,
        resourceId: id,
        limit: 50,
      });
      return json(page);
    }

    if (request.method === "GET" && pathname === "/api/workhub/notifications") {
      return json({ items: await services.notifications.list(principalId, { limit: 50 }) });
    }
    if (request.method === "GET" && pathname === "/api/workhub/notifications/unread-count") {
      return json({ unreadCount: await services.notifications.countUnread(principalId) });
    }

    const notificationMatch = pathname.match(/^\/api\/workhub\/notifications\/([^/]+)\/(read|archive)$/u);
    if (notificationMatch && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const id = decodeURIComponent(notificationMatch[1]);
      const expectedVersion = intField(body, "expectedVersion");
      if (notificationMatch[2] === "read") {
        await services.notifications.markRead(principalId, id, expectedVersion);
      } else {
        await services.notifications.archive(principalId, id, expectedVersion);
      }
      return json({ ok: true });
    }

    return error(404, "not_found", "WORKHUB API route was not found");
  } catch (caught) {
    if (caught instanceof SearchRequestError) {
      return error(400, `search_${caught.code}`, "Search request is invalid");
    }
    if (caught instanceof TravelRequestError) {
      return error(statusForTravelError(caught.code), `travel_request_${caught.code}`, caught.message);
    }
    if (caught instanceof WorkflowError) {
      return error(statusForWorkflowError(caught.code), `workflow_${caught.code}`, caught.message);
    }
    if (caught instanceof TransactionalNotificationError) {
      const status = caught.code === "not_found" ? 404 : caught.code === "conflict" ? 409 : 400;
      return error(status, `notification_${caught.code}`, caught.message);
    }
    return error(500, "workhub_business_error", "WORKHUB business operation failed");
  }
};
