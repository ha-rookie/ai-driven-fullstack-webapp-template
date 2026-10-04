import type { MasterDataService, ResolvedMasterValue } from "../../../worker/master-data";
import type { WorkflowService } from "../../../worker/workflow";
import {
  WORKHUB_OFFICE_MASTER_KEY,
  WORKHUB_TRAVEL_RESOURCE_TYPE,
  WORKHUB_TRAVEL_WORKFLOW_KEY,
  WORKHUB_TRAVEL_WORKFLOW_VERSION,
} from "./fixtures";
import type {
  CreateTravelRequestCommand,
  ResubmitTravelRequestCommand,
  ResubmitTravelRequestResult,
  SubmitTravelRequestCommand,
  TravelRequestMutationGate,
  TravelRequestRecord,
  TravelRequestStore,
  TravelRequestWorkflowStateReader,
  UpdateReturnedTravelRequestCommand,
  UpdateTravelRequestCommand,
} from "./types";

const MAX_ID_LENGTH = 256;
const MAX_PURPOSE_LENGTH = 2_000;

export type TravelRequestErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "invalid_state"
  | "conflict"
  | "office_unavailable"
  | "workflow_failed"
  | "recovery_required";

export class TravelRequestError extends Error {
  constructor(public readonly code: TravelRequestErrorCode, message: string) {
    super(message);
    this.name = "TravelRequestError";
  }
}

export interface TravelRequestServiceOptions {
  readonly environment: string;
  readonly store: TravelRequestStore;
  readonly masterData: Pick<MasterDataService, "listSelectable" | "resolveAsOf">;
  readonly workflow: Pick<WorkflowService, "start"> & Partial<Pick<WorkflowService, "resubmit">>;
  readonly workflowState?: TravelRequestWorkflowStateReader;
  readonly mutationGate?: TravelRequestMutationGate;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

const hasDisallowedControlCharacter = (
  value: string,
  allowedCodes: ReadonlySet<number> = new Set<number>(),
): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isControl = (code >= 0 && code <= 31) || code === 127;
    if (isControl && !allowedCodes.has(code)) return true;
  }
  return false;
};

const PURPOSE_ALLOWED_CONTROL_CODES = new Set([9, 10, 13]);

const boundedId = (value: string, name: string): string => {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_ID_LENGTH
    || hasDisallowedControlCharacter(normalized)
  ) {
    throw new TravelRequestError("invalid_input", `${name} is invalid`);
  }
  return normalized;
};

const normalizePurpose = (value: string): string => {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > MAX_PURPOSE_LENGTH
    || hasDisallowedControlCharacter(normalized, PURPOSE_ALLOWED_CONTROL_CODES)
  ) {
    throw new TravelRequestError("invalid_input", "purpose is invalid");
  }
  return normalized;
};

const normalizeDate = (value: string, name: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TravelRequestError("invalid_input", `${name} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TravelRequestError("invalid_input", `${name} is not a valid calendar date`);
  }
  return value;
};

const validateTravelDates = (startDateValue: string, endDateValue: string) => {
  const startDate = normalizeDate(startDateValue, "startDate");
  const endDate = normalizeDate(endDateValue, "endDate");
  if (startDate > endDate) {
    throw new TravelRequestError("invalid_input", "startDate must not be after endDate");
  }
  return { startDate, endDate };
};

export class TravelRequestService {
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly options: TravelRequestServiceOptions) {
    boundedId(options.environment, "environment");
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
  }

  async listDestinationOffices(): Promise<readonly ResolvedMasterValue[]> {
    return this.options.masterData.listSelectable(WORKHUB_OFFICE_MASTER_KEY);
  }

  async get(id: string, principalId: string): Promise<TravelRequestRecord> {
    return this.loadOwnedDraftOrRequest(id, principalId);
  }

  async createDraft(command: CreateTravelRequestCommand): Promise<TravelRequestRecord> {
    await this.options.mutationGate?.assertMutationAllowed();
    const requesterId = boundedId(command.principalId, "principalId");
    const destinationOfficeItemId = boundedId(command.destinationOfficeItemId, "destinationOfficeItemId");
    const { startDate, endDate } = validateTravelDates(command.startDate, command.endDate);
    const purpose = normalizePurpose(command.purpose);
    const now = this.now().toISOString();
    const record: TravelRequestRecord = {
      id: this.generateId(),
      environment: this.options.environment,
      requesterId,
      destinationOfficeItemId,
      destinationOfficeRevisionId: null,
      startDate,
      endDate,
      purpose,
      status: "draft",
      submissionKey: null,
      workflowInstanceId: null,
      submittedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (!await this.options.store.create(record)) {
      throw new TravelRequestError("conflict", "travel request creation conflicted");
    }
    return record;
  }

  async updateDraft(command: UpdateTravelRequestCommand): Promise<TravelRequestRecord> {
    await this.options.mutationGate?.assertMutationAllowed();
    const current = await this.loadOwnedDraftOrRequest(command.id, command.principalId);
    if (current.status !== "draft") {
      throw new TravelRequestError("invalid_state", "only a draft travel request can be updated");
    }
    if (current.version !== command.expectedVersion) {
      throw new TravelRequestError("conflict", "travel request version is stale");
    }
    const { startDate, endDate } = validateTravelDates(command.startDate, command.endDate);
    const next: TravelRequestRecord = {
      ...current,
      destinationOfficeItemId: boundedId(command.destinationOfficeItemId, "destinationOfficeItemId"),
      startDate,
      endDate,
      purpose: normalizePurpose(command.purpose),
      version: current.version + 1,
      updatedAt: this.now().toISOString(),
    };
    if (!await this.options.store.compareAndSet(next, {
      expectedVersion: current.version,
      expectedStatus: "draft",
    })) {
      throw new TravelRequestError("conflict", "travel request changed concurrently");
    }
    return next;
  }

  async updateReturned(command: UpdateReturnedTravelRequestCommand): Promise<TravelRequestRecord> {
    await this.options.mutationGate?.assertMutationAllowed();
    const current = await this.loadOwnedDraftOrRequest(command.id, command.principalId);
    await this.assertAwaitingResubmission(current, command.principalId);
    if (current.version !== command.expectedVersion) {
      throw new TravelRequestError("conflict", "travel request version is stale");
    }
    const { startDate, endDate } = validateTravelDates(command.startDate, command.endDate);
    const next: TravelRequestRecord = {
      ...current,
      destinationOfficeItemId: boundedId(command.destinationOfficeItemId, "destinationOfficeItemId"),
      destinationOfficeRevisionId: null,
      startDate,
      endDate,
      purpose: normalizePurpose(command.purpose),
      version: current.version + 1,
      updatedAt: this.now().toISOString(),
    };
    if (!await this.options.store.compareAndSet(next, {
      expectedVersion: current.version,
      expectedStatus: "submitted",
    })) {
      throw new TravelRequestError("conflict", "travel request changed concurrently during correction");
    }
    return next;
  }

  async submit(command: SubmitTravelRequestCommand): Promise<TravelRequestRecord> {
    await this.options.mutationGate?.assertMutationAllowed();
    const current = await this.loadOwnedDraftOrRequest(command.id, command.principalId);
    if (current.status !== "draft") {
      throw new TravelRequestError("invalid_state", "travel request has already entered submission");
    }
    if (current.version !== command.expectedVersion) {
      throw new TravelRequestError("conflict", "travel request version is stale");
    }

    const referenceAt = this.now().toISOString();
    const office = await this.options.masterData.resolveAsOf(current.destinationOfficeItemId, referenceAt);
    if (!office || office.item.masterKey !== WORKHUB_OFFICE_MASTER_KEY) {
      throw new TravelRequestError("office_unavailable", "destination office is not selectable");
    }

    const submissionKey = `travel-request:${current.id}:${this.generateId()}`;
    const reservation: TravelRequestRecord = {
      ...current,
      destinationOfficeRevisionId: office.revision.id,
      status: "submitting",
      submissionKey,
      version: current.version + 1,
      updatedAt: referenceAt,
    };
    if (!await this.options.store.compareAndSet(reservation, {
      expectedVersion: current.version,
      expectedStatus: "draft",
    })) {
      throw new TravelRequestError("conflict", "travel request changed concurrently before submission");
    }

    let workflowInstanceId: string;
    try {
      const started = await this.options.workflow.start({
        submissionKey,
        resourceType: WORKHUB_TRAVEL_RESOURCE_TYPE,
        resourceId: reservation.id,
        definitionKey: WORKHUB_TRAVEL_WORKFLOW_KEY,
        definitionVersion: WORKHUB_TRAVEL_WORKFLOW_VERSION,
        requesterId: reservation.requesterId,
        requestId: command.requestId,
        correlationId: command.correlationId,
      });
      workflowInstanceId = started.instance.id;
    } catch {
      const rolledBack: TravelRequestRecord = {
        ...reservation,
        destinationOfficeRevisionId: null,
        status: "draft",
        submissionKey: null,
        version: reservation.version + 1,
        updatedAt: this.now().toISOString(),
      };
      if (!await this.options.store.compareAndSet(rolledBack, {
        expectedVersion: reservation.version,
        expectedStatus: "submitting",
      })) {
        throw new TravelRequestError(
          "recovery_required",
          "workflow start failed and the submission reservation could not be rolled back",
        );
      }
      throw new TravelRequestError("workflow_failed", "workflow could not be started");
    }

    const submittedAt = this.now().toISOString();
    const submitted: TravelRequestRecord = {
      ...reservation,
      status: "submitted",
      workflowInstanceId,
      submittedAt,
      version: reservation.version + 1,
      updatedAt: submittedAt,
    };
    if (!await this.options.store.compareAndSet(submitted, {
      expectedVersion: reservation.version,
      expectedStatus: "submitting",
    })) {
      throw new TravelRequestError(
        "recovery_required",
        "workflow started but travel request finalization conflicted; keep the request in submitting state",
      );
    }
    return submitted;
  }

  async resubmit(command: ResubmitTravelRequestCommand): Promise<ResubmitTravelRequestResult> {
    await this.options.mutationGate?.assertMutationAllowed();
    const current = await this.loadOwnedDraftOrRequest(command.id, command.principalId);
    const instance = await this.assertAwaitingResubmission(current, command.principalId);
    if (current.version !== command.expectedRequestVersion) {
      throw new TravelRequestError("conflict", "travel request version is stale");
    }
    if (instance.version !== command.expectedWorkflowVersion) {
      throw new TravelRequestError("conflict", "workflow version is stale");
    }

    const referenceAt = this.now().toISOString();
    const office = await this.options.masterData.resolveAsOf(current.destinationOfficeItemId, referenceAt);
    if (!office || office.item.masterKey !== WORKHUB_OFFICE_MASTER_KEY) {
      throw new TravelRequestError("office_unavailable", "destination office is not selectable");
    }

    let request = current;
    if (current.destinationOfficeRevisionId !== office.revision.id) {
      request = {
        ...current,
        destinationOfficeRevisionId: office.revision.id,
        version: current.version + 1,
        updatedAt: referenceAt,
      };
      if (!await this.options.store.compareAndSet(request, {
        expectedVersion: current.version,
        expectedStatus: "submitted",
      })) {
        throw new TravelRequestError("conflict", "travel request changed concurrently before resubmission");
      }
    }

    const resubmitWorkflow = this.options.workflow.resubmit;
    if (!resubmitWorkflow) {
      throw new TravelRequestError("invalid_state", "workflow resubmission is not available");
    }

    try {
      const workflow = await resubmitWorkflow.call(this.options.workflow, {
        instanceId: instance.id,
        actorId: command.principalId,
        expectedInstanceVersion: command.expectedWorkflowVersion,
        requestId: command.requestId,
        correlationId: command.correlationId,
      });
      return { request, workflow };
    } catch {
      throw new TravelRequestError("workflow_failed", "workflow could not be resubmitted");
    }
  }

  private async assertAwaitingResubmission(current: TravelRequestRecord, principalId: string) {
    if (current.status !== "submitted" || !current.workflowInstanceId || !this.options.workflowState) {
      throw new TravelRequestError("invalid_state", "travel request is not awaiting correction");
    }
    const instance = await this.options.workflowState.getInstance(
      current.workflowInstanceId,
      this.options.environment,
    );
    if (!instance) throw new TravelRequestError("invalid_state", "workflow instance is unavailable");
    if (instance.requesterId !== boundedId(principalId, "principalId")) {
      throw new TravelRequestError("forbidden", "workflow belongs to another principal");
    }
    if (instance.resourceType !== WORKHUB_TRAVEL_RESOURCE_TYPE || instance.resourceId !== current.id) {
      throw new TravelRequestError("invalid_state", "workflow resource does not match travel request");
    }
    if (instance.state !== "awaiting_resubmission") {
      throw new TravelRequestError("invalid_state", "workflow is not awaiting resubmission");
    }
    return instance;
  }

  private async loadOwnedDraftOrRequest(idValue: string, principalValue: string): Promise<TravelRequestRecord> {
    const id = boundedId(idValue, "id");
    const principalId = boundedId(principalValue, "principalId");
    const record = await this.options.store.get(id, this.options.environment);
    if (!record) throw new TravelRequestError("not_found", "travel request not found");
    if (record.requesterId !== principalId) {
      throw new TravelRequestError("forbidden", "travel request belongs to another principal");
    }
    return record;
  }
}
