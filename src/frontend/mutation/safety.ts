import { ApiClientError } from "../api";
import { toErrorViewModel } from "../errors";
import type { MutationStateController } from "./state";

export type MutationRunStatus =
  | "success"
  | "skipped"
  | "cancelled"
  | "conflict"
  | "authentication_required"
  | "failed";

export interface MutationRunResult<T> {
  readonly status: MutationRunStatus;
  readonly value?: T;
  readonly reason?: "clean" | "submitting" | "conflict";
}

export interface MutationExecutionInput<T> {
  readonly draft: T;
  readonly expectedVersion?: string | number;
}

export interface SafeMutationOptions<T> {
  readonly confirmDestructive?: () => boolean | Promise<boolean>;
  readonly loadLatest?: () => Promise<T>;
  readonly onAuthenticationRequired?: (error: ApiClientError) => void | Promise<void>;
}

const skipReason = <T>(state: MutationStateController<T>): MutationRunResult<T>["reason"] => {
  switch (state.getSnapshot().phase) {
    case "submitting":
      return "submitting";
    case "conflict":
      return "conflict";
    default:
      return "clean";
  }
};

export const runSafeMutation = async <T>(
  state: MutationStateController<T>,
  execute: (input: MutationExecutionInput<T>) => Promise<T>,
  options: SafeMutationOptions<T> = {},
): Promise<MutationRunResult<T>> => {
  if (options.confirmDestructive && !(await options.confirmDestructive())) {
    return { status: "cancelled" };
  }

  const submission = state.beginSubmit();
  if (!submission) {
    return { status: "skipped", reason: skipReason(state) };
  }

  try {
    const persisted = await execute(submission);
    state.succeed(persisted);
    return { status: "success", value: persisted };
  } catch (error) {
    const view = toErrorViewModel(error);

    if (error instanceof ApiClientError && error.kind === "http" && error.status === 401) {
      state.fail(view);
      await options.onAuthenticationRequired?.(error);
      return { status: "authentication_required" };
    }

    if (error instanceof ApiClientError && error.kind === "http" && error.status === 409) {
      if (options.loadLatest) {
        try {
          const latest = await options.loadLatest();
          state.conflict(latest, view);
        } catch (refreshError) {
          state.fail(toErrorViewModel(refreshError));
          return { status: "failed" };
        }
      } else {
        state.conflict(state.getSnapshot().persisted, view);
      }
      return { status: "conflict" };
    }

    state.fail(view);
    return { status: "failed" };
  }
};
