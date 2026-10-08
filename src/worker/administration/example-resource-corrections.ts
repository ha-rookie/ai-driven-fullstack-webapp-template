import {
  loadExampleResource,
  restoreExampleResource,
} from "../../infrastructure/d1-example-resource-store";
import type {
  DataCorrectionAdapter,
  DataCorrectionExecutionResult,
  DataCorrectionProjection,
} from "./data-correction";

export const RESTORE_SOFT_DELETED_RESOURCE = "RESTORE_SOFT_DELETED_RESOURCE";

const project = (resource: Awaited<ReturnType<typeof loadExampleResource>>): DataCorrectionProjection | undefined => {
  if (!resource) return undefined;
  return {
    resourceType: "example_resource",
    resourceId: resource.id,
    version: resource.version,
    state: {
      status: resource.status,
      deleted: resource.deletedAt !== null,
    },
  };
};

export const createRestoreSoftDeletedExampleResourceAdapter = (
  db: D1Database,
): DataCorrectionAdapter => ({
  definition: {
    key: RESTORE_SOFT_DELETED_RESOURCE,
    version: 1,
    capability: "data_correction:restore",
    risk: "CONTROLLED_CHANGE",
    reversible: true,
    idempotent: false,
    requiresReason: true,
    supportsPreview: true,
    requiresVerification: true,
  },
  async inspect(input) {
    const current = await loadExampleResource(db, input.targetId, { includeDeleted: true });
    if (!current) return { available: false, reasonCode: "not_found" };
    if (current.version !== input.expectedVersion) {
      return { available: false, before: project(current), reasonCode: "stale_version" };
    }
    if (current.deletedAt === null) {
      return { available: false, before: project(current), reasonCode: "already_active" };
    }
    return { available: true, before: project(current) };
  },
  async execute(input): Promise<DataCorrectionExecutionResult> {
    const before = await loadExampleResource(db, input.targetId, { includeDeleted: true });
    if (!before) return { result: "FAILED", reasonCode: "not_found" };
    if (before.version !== input.expectedVersion) {
      return {
        result: "CONFLICT",
        before: project(before),
        reasonCode: "stale_version",
      };
    }
    if (before.deletedAt === null) {
      return {
        result: "CONFLICT",
        before: project(before),
        reasonCode: "already_active",
      };
    }

    const restored = await restoreExampleResource(db, {
      id: input.targetId,
      expectedVersion: input.expectedVersion,
      changedAt: new Date().toISOString(),
      actorId: input.actorId,
    });

    if (!restored.ok) {
      return {
        result: restored.reason === "stale" || restored.reason === "state_changed"
          ? "CONFLICT"
          : "FAILED",
        before: project(restored.current),
        reasonCode: restored.reason,
      };
    }

    return {
      result: "SUCCESS",
      before: project(before),
      after: project(restored.resource),
    };
  },
  async verify(input) {
    const current = await loadExampleResource(db, input.targetId, { includeDeleted: true });
    if (!current) {
      return { passed: false, summary: "Resource disappeared after restore" };
    }
    if (current.version !== input.expectedVersion || current.deletedAt !== null) {
      return { passed: false, summary: "Restored state does not match expected version/state" };
    }
    return { passed: true, summary: "Resource is active at the expected post-correction version" };
  },
});
