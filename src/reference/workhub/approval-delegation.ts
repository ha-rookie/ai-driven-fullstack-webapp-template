import type { WorkflowInstanceRecord, WorkflowWorkItemRecord } from "../../worker/workflow";
import { findScopeMembership } from "../../worker/authorization";
import { WORKHUB_APP_SCOPE_ID } from "./app-catalog";
import { WORKHUB_TRAVEL_RESOURCE_TYPE } from "./travel-request/fixtures";

// WORKHUB Reference personas only; this never grants blanket business access.
const MANAGER = "workhub-demo-ren";
const DELEGATE = "workhub-demo-mei";
const STEP = "manager_approval";
const ACTION_SCOPE = "approve_return";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TravelDelegationRecord {
  readonly environment: string;
  readonly delegatorId: string;
  readonly delegateId: string;
  readonly resourceType: string;
  readonly stepKey: string;
  readonly actionScope: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly reason: string;
  readonly revokedAt: string | null;
  readonly updatedAt: string;
}

export const isTravelDelegationActive = (
  record: TravelDelegationRecord | null,
  actorId: string,
  instance: WorkflowInstanceRecord,
  workItem: WorkflowWorkItemRecord,
  action: "approve" | "return" | "reject",
  now: Date,
): boolean => !!record
  && record.revokedAt === null
  && record.environment === instance.environment
  && record.delegatorId === workItem.assigneePrincipal
  && record.delegateId === actorId
  && actorId !== instance.requesterId
  && record.resourceType === WORKHUB_TRAVEL_RESOURCE_TYPE
  && instance.resourceType === WORKHUB_TRAVEL_RESOURCE_TYPE
  && record.stepKey === STEP
  && instance.currentStepKey === STEP
  && workItem.stepKey === STEP
  && record.actionScope === ACTION_SCOPE
  && (action === "approve" || action === "return")
  && Date.parse(record.validFrom) <= now.getTime()
  && now.getTime() < Date.parse(record.validUntil);

export class WorkhubTravelDelegation {
  constructor(private readonly db: D1Database, private readonly environment: string) {}

  private async currentRole(principalId: string) {
    return (await findScopeMembership(this.db, principalId, WORKHUB_APP_SCOPE_ID))?.role ?? null;
  }

  private async getGrant(): Promise<TravelDelegationRecord | null> {
    return this.db.prepare(
      "SELECT environment, delegator_id AS delegatorId, delegate_id AS delegateId, " +
      "resource_type AS resourceType, step_key AS stepKey, action_scope AS actionScope, " +
      "valid_from AS validFrom, valid_until AS validUntil, reason, revoked_at AS revokedAt, " +
      "updated_at AS updatedAt FROM workhub_travel_delegations " +
      "WHERE environment=? AND delegator_id=? AND delegate_id=? AND resource_type=? AND step_key=?",
    ).bind(this.environment, MANAGER, DELEGATE, WORKHUB_TRAVEL_RESOURCE_TYPE, STEP)
      .first<TravelDelegationRecord>();
  }

  async status(principalId: string): Promise<TravelDelegationRecord | null> {
    const role = await this.currentRole(principalId);
    if (principalId !== MANAGER && principalId !== DELEGATE) return null;
    if (principalId === MANAGER && role !== "manager") return null;
    if (principalId === DELEGATE && role !== "accounting") return null;
    return this.getGrant();
  }

  // The signed-in manager explicitly grants/revokes a fixed narrow capability;
  // the browser supplies neither the delegate nor the effective dates.
  async setEnabled(principalId: string, enabled: boolean): Promise<TravelDelegationRecord> {
    if (principalId !== MANAGER || await this.currentRole(principalId) !== "manager"
      || await this.currentRole(DELEGATE) !== "accounting") {
      throw new Error("delegation_forbidden");
    }
    const now = new Date();
    const at = now.toISOString();
    if (enabled) {
      const until = new Date(now.getTime() + WINDOW_MS).toISOString();
      await this.db.prepare(
        "INSERT INTO workhub_travel_delegations " +
        "(environment,delegator_id,delegate_id,resource_type,step_key,action_scope," +
        "valid_from,valid_until,reason,revoked_at,updated_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,NULL,?) " +
        "ON CONFLICT (environment,delegator_id,delegate_id,resource_type,step_key) " +
        "DO UPDATE SET valid_from=excluded.valid_from,valid_until=excluded.valid_until," +
        "revoked_at=NULL,updated_at=excluded.updated_at",
      ).bind(this.environment, MANAGER, DELEGATE, WORKHUB_TRAVEL_RESOURCE_TYPE,
        STEP, ACTION_SCOPE, at, until, "出張承認を24時間代理（Reference）", at).run();
    } else {
      await this.db.prepare(
        "UPDATE workhub_travel_delegations SET revoked_at=?,updated_at=? " +
        "WHERE environment=? AND delegator_id=? AND delegate_id=? " +
        "AND resource_type=? AND step_key=? AND revoked_at IS NULL",
      ).bind(at, at, this.environment, MANAGER, DELEGATE,
        WORKHUB_TRAVEL_RESOURCE_TYPE, STEP).run();
    }
    const record = await this.getGrant();
    if (!record) throw new Error("delegation_unavailable");
    return record;
  }

  async mayAct(input: {
    readonly actorId: string;
    readonly action: "approve" | "return" | "reject";
    readonly instance: WorkflowInstanceRecord;
    readonly workItem: WorkflowWorkItemRecord;
    readonly at: Date;
  }): Promise<boolean> {
    if (input.actorId !== DELEGATE || input.workItem.assigneePrincipal !== MANAGER
      || await this.currentRole(input.actorId) !== "accounting"
      || await this.currentRole(MANAGER) !== "manager") return false;
    return isTravelDelegationActive(
      await this.getGrant(), input.actorId, input.instance, input.workItem, input.action, input.at,
    );
  }
}
