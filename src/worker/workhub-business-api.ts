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
import { D1WorkhubAnnouncementStore, WorkhubAnnouncementError } from "../reference/workhub/announcements";
import { D1WorkhubExpenseStore, WorkhubExpenseError } from "../reference/workhub/expenses";
import { WORKHUB_EXPENSE_EMPLOYEE_ID } from "../reference/workhub/expenses";
import { projectWorkhubMyRequests } from "../reference/workhub/my-requests";
import { WorkhubSecondaryJourneyService } from "../reference/workhub/secondary-journeys";
import { resolveApplicationSession } from "./auth";
import { findScopeMembership } from "./authorization";
import { listWorkhubApps, searchWorkhubApps, WORKHUB_APP_SCOPE_ID } from "../reference/workhub/app-catalog";
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
    if (pathname === "/api/workhub/apps") {
      if (request.method !== "GET") return error(405, "method_not_allowed", "Only GET is available");
      // The caller's current DB membership, never a client-provided role/scope,
      // decides which Reference applications may even be discovered.
      const membership = await findScopeMembership(env.DB, principalId, WORKHUB_APP_SCOPE_ID);
      if (!membership) return error(403, "apps_forbidden", "Access denied");
      return json({ items: listWorkhubApps(membership.role), secondaryJourneyRole: ["employee", "corporate"].includes(membership.role) ? membership.role : null });
    }

    // Stage 2 Reference-only mock lifecycle: existing WorkflowStore owns
    // persistence, concurrency and assignee checks. No HR/asset data changes.
    if (pathname === "/api/workhub/secondary-journeys"
      || /^\/api\/workhub\/secondary-journeys\/[0-9a-f-]{36}\/advance$/u.test(pathname)) {
      const membership = await findScopeMembership(env.DB, principalId, WORKHUB_APP_SCOPE_ID);
      if (!membership || !["employee", "corporate"].includes(membership.role)) {
        return error(403, "secondary_journey_forbidden", "This reference journey is unavailable");
      }
      const journey = new WorkhubSecondaryJourneyService(env.DB, environment);
      if (pathname === "/api/workhub/secondary-journeys" && request.method === "GET") {
        return json({ items: await journey.list(principalId, membership.role) });
      }
      if (pathname === "/api/workhub/secondary-journeys" && request.method === "POST") {
        const body = await bodyRecord(request);
        if (body instanceof Response) return body;
        const result = await journey.start(
          principalId, membership.role, stringField(body, "intent"), stringField(body, "key"),
        );
        return json({ item: result }, 201);
      }
      const actionMatch = pathname.match(/^\/api\/workhub\/secondary-journeys\/([0-9a-f-]{36})\/advance$/u);
      if (actionMatch && request.method === "POST") {
        const body = await bodyRecord(request);
        if (body instanceof Response) return body;
        const result = await journey.advance(
          principalId, membership.role, decodeURIComponent(actionMatch[1]),
          intField(body, "expectedVersion"), intField(body, "expectedWorkItemVersion"),
        );
        return json({ item: result });
      }
      return error(405, "method_not_allowed", "Method is not supported");
    }

    if (pathname === "/api/workhub/my-requests" && request.method === "GET") {
      // Reference MVP: Aoi owns both request types. Check this before accessing
      // sources; Accounting can review expenses but must not see others' MY REQUESTS.
      if (principalId !== WORKHUB_EXPENSE_EMPLOYEE_ID) {
        return error(403, "my_requests_forbidden", "Personal requests are unavailable");
      }
      // Each authoritative source filters by session principal AND environment
      // in D1; never materialize cross-employee lists before projecting.
      // Fail the entire view if one source fails: a partial list looks like 0 items.
      const expenseStore = new D1WorkhubExpenseStore(env.DB, environment);
      const [travels, expenses] = await Promise.all([
        services.travel.listMine(principalId),
        expenseStore.list(principalId),
      ]);
      // Aggregate ALL linked settlements for up to 20 owner-scoped trips in
      // one D1 query. The latest-20 expense feed alone is not exhaustive.
      const linkedSummaries = await expenseStore.listLinkedSummaries(
        principalId, travels.map(travel => travel.id),
      );
      return json({ items: projectWorkhubMyRequests(travels, expenses, 20, linkedSummaries) });
    }

    if (pathname === "/api/workhub/expenses" && request.method === "GET") {
      const expenses = new D1WorkhubExpenseStore(env.DB, environment);
      return json({ items: await expenses.list(principalId) });
    }

    if (pathname === "/api/workhub/expenses" && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const expenses = new D1WorkhubExpenseStore(env.DB, environment);
      return json({ item: await expenses.submit(principalId, body) }, 201);
    }

    const expenseMatch = pathname.match(/^\/api\/workhub\/expenses\/([^/]+)$/u);
    if (expenseMatch && request.method === "GET") {
      const expenses = new D1WorkhubExpenseStore(env.DB, environment);
      return json({ item: await expenses.get(principalId, decodeURIComponent(expenseMatch[1])) });
    }

    if (expenseMatch && request.method === "PUT") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const expenses = new D1WorkhubExpenseStore(env.DB, environment);
      return json({ item: await expenses.resubmit(
        principalId, decodeURIComponent(expenseMatch[1]), body, intField(body, "expectedVersion"),
      ) });
    }

    const expenseDecisionMatch = pathname.match(/^\/api\/workhub\/expenses\/([^/]+)\/decision$/u);
    if (expenseDecisionMatch && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const expenses = new D1WorkhubExpenseStore(env.DB, environment);
      return json({ item: await expenses.decide(
        principalId, decodeURIComponent(expenseDecisionMatch[1]),
        intField(body, "expectedVersion"), body.action, body.reason,
      ) });
    }

    if (pathname === "/api/workhub/announcements" && request.method === "GET") {
      const announcements = new D1WorkhubAnnouncementStore(env.DB, environment);
      return json({ items: await announcements.list() });
    }

    if (pathname === "/api/workhub/announcements" && request.method === "POST") {
      const body = await bodyRecord(request);
      if (body instanceof Response) return body;
      const announcements = new D1WorkhubAnnouncementStore(env.DB, environment);
      const item = await announcements.publish(principalId, body.title, body.body);
      return json({ item }, 201);
    }

    if (request.method === "GET" && pathname === "/api/workhub/search") {
      const text = url.searchParams.get("q") ?? "";
      const cursor = url.searchParams.get("cursor") ?? undefined;
      const response = await createWorkhubSearch(principalId, services, environment).search(
        { principalId, environment },
        { text, categories: ["requests"], limit: 20, ...(cursor ? { cursor } : {}) },
      );
      // Resolve Apps from the SAME server-owned catalog as /api/workhub/apps.
      // Missing membership does not grant catalog discovery; the existing
      // requester-scoped travel search keeps its own resource authorization.
      const membership = await findScopeMembership(env.DB, principalId, WORKHUB_APP_SCOPE_ID);
      const appResults = membership && !cursor ? searchWorkhubApps(membership.role, text) : [];
      return json({ ...response, results: [...appResults, ...response.results] });
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

    if (request.method === "GET" && pathname === "/api/workhub/travel-requests") {
      // The requesterId is derived exclusively from the authenticated session.
      // Caller-supplied identity or query filters must never widen visibility.
      const items = await services.travel.listMine(principalId);
      return json({ items });
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
      // The requester was authorized by travel.get above. Never surface
      // another workflow's comments or a historical reason after resubmission.
      const returnComment = workflowInstance?.state === "awaiting_resubmission"
        && workflowInstance.resourceType === WORKHUB_TRAVEL_RESOURCE_TYPE
        && workflowInstance.resourceId === record.id
        && workflowInstance.requesterId === principalId
        ? await services.travelStore.getReturnComment(environment, workflowInstance.id)
        : null;
      return json({ request: record, workflow: workflowInstance, returnComment });
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
    if (caught instanceof WorkhubExpenseError) {
      const status = caught.code === "forbidden" ? 403
        : caught.code === "not_found" ? 404
          : caught.code === "conflict" ? 409
            : caught.code === "invalid_input" ? 400 : 503;
      return error(status, `expense_${caught.code}`, caught.message);
    }
    if (caught instanceof WorkhubAnnouncementError) {
      const status = caught.code === "forbidden" ? 403 : caught.code === "invalid_input" ? 400 : 503;
      return error(status, `announcement_${caught.code}`, caught.message);
    }
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
