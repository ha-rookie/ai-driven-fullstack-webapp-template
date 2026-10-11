import type { WorkflowInstanceState, WorkflowMutationResult, WorkflowStore } from "../../../worker/workflow";

export type TravelRequestStatus = "draft" | "submitting" | "submitted";

export interface TravelRequestRecord {
  readonly id: string;
  readonly environment: string;
  readonly requesterId: string;
  readonly destinationOfficeItemId: string;
  readonly destinationOfficeRevisionId: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly purpose: string;
  readonly status: TravelRequestStatus;
  readonly submissionKey: string | null;
  readonly workflowInstanceId: string | null;
  readonly submittedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Read model for MY REQUESTS. Workflow, not TravelRequest.status, owns approval status. */
export interface TravelRequestListItem extends TravelRequestRecord {
  readonly workflowState: WorkflowInstanceState | null;
  /** Latest return comment only while correction is currently required. */
  readonly returnComment: string | null;
}

export interface TravelRequestCompareAndSetOptions {
  readonly expectedVersion: number;
  readonly expectedStatus: TravelRequestStatus;
}

export interface TravelRequestStore {
  create(record: TravelRequestRecord): Promise<boolean>;
  get(id: string, environment: string): Promise<TravelRequestRecord | null>;
  // Bounded, server-filtered list; never load every employee's requests then filter in UI.
  listOwned(environment: string, requesterId: string, limit: number): Promise<readonly TravelRequestListItem[]>;
  compareAndSet(
    record: TravelRequestRecord,
    options: TravelRequestCompareAndSetOptions,
  ): Promise<boolean>;
}

export interface CreateTravelRequestCommand {
  readonly principalId: string;
  readonly destinationOfficeItemId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly purpose: string;
}

export interface UpdateTravelRequestCommand {
  readonly id: string;
  readonly principalId: string;
  readonly expectedVersion: number;
  readonly destinationOfficeItemId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly purpose: string;
}

export interface SubmitTravelRequestCommand {
  readonly id: string;
  readonly principalId: string;
  readonly expectedVersion: number;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export type UpdateReturnedTravelRequestCommand = UpdateTravelRequestCommand;

export interface ResubmitTravelRequestCommand {
  readonly id: string;
  readonly principalId: string;
  readonly expectedRequestVersion: number;
  readonly expectedWorkflowVersion: number;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export interface ResubmitTravelRequestResult {
  readonly request: TravelRequestRecord;
  readonly workflow: WorkflowMutationResult;
}

export type TravelRequestWorkflowStateReader = Pick<WorkflowStore, "getInstance">;

export interface TravelRequestMutationGate {
  assertMutationAllowed(): Promise<void> | void;
}
