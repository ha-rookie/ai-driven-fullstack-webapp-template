import type { ErrorViewModel } from "../errors";

export type MutationPhase = "clean" | "dirty" | "submitting" | "success" | "conflict" | "failed";

export interface MutationStateSnapshot<T> {
  readonly phase: MutationPhase;
  readonly persisted: T;
  readonly draft: T;
  readonly failure?: ErrorViewModel;
}

export interface MutationStateOptions<T> {
  readonly normalize?: (value: T) => unknown;
  readonly equals?: (left: unknown, right: unknown) => boolean;
  readonly expectedVersion?: (persisted: T) => string | number | undefined;
}

export interface MutationSubmission<T> {
  readonly draft: T;
  readonly expectedVersion?: string | number;
}

export interface MutationStateController<T> {
  getSnapshot(): MutationStateSnapshot<T>;
  subscribe(listener: () => void): () => void;
  setDraft(next: T): MutationStateSnapshot<T>;
  beginSubmit(): MutationSubmission<T> | null;
  succeed(persisted: T): MutationStateSnapshot<T>;
  conflict(latest: T, failure: ErrorViewModel): MutationStateSnapshot<T>;
  fail(failure: ErrorViewModel): MutationStateSnapshot<T>;
  acceptLatest(latest: T): MutationStateSnapshot<T>;
}

const defaultEquals = (left: unknown, right: unknown) => Object.is(left, right);

export const createMutationState = <T>(
  initialPersisted: T,
  options: MutationStateOptions<T> = {},
): MutationStateController<T> => {
  const normalize = options.normalize ?? ((value: T) => value);
  const equals = options.equals ?? defaultEquals;
  const valuesEqual = (left: T, right: T) => equals(normalize(left), normalize(right));

  let snapshot: MutationStateSnapshot<T> = Object.freeze({
    phase: "clean",
    persisted: initialPersisted,
    draft: initialPersisted,
  });
  let submittedDraft: T | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: MutationStateSnapshot<T>) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
    return snapshot;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDraft(next) {
      if (snapshot.phase === "submitting") {
        return publish({ ...snapshot, draft: next });
      }
      return publish({
        phase: valuesEqual(snapshot.persisted, next) ? "clean" : "dirty",
        persisted: snapshot.persisted,
        draft: next,
      });
    },
    beginSubmit() {
      if (snapshot.phase !== "dirty" && snapshot.phase !== "failed") return null;
      submittedDraft = snapshot.draft;
      publish({
        phase: "submitting",
        persisted: snapshot.persisted,
        draft: snapshot.draft,
      });
      const expectedVersion = options.expectedVersion?.(snapshot.persisted);
      return {
        draft: snapshot.draft,
        ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      };
    },
    succeed(persisted) {
      const draftChangedDuringSubmit = submittedDraft !== null && !valuesEqual(snapshot.draft, submittedDraft);
      submittedDraft = null;
      if (draftChangedDuringSubmit) {
        return publish({
          phase: "dirty",
          persisted,
          draft: snapshot.draft,
        });
      }
      return publish({
        phase: "success",
        persisted,
        draft: persisted,
      });
    },
    conflict(latest, failure) {
      submittedDraft = null;
      return publish({
        phase: "conflict",
        persisted: latest,
        draft: snapshot.draft,
        failure,
      });
    },
    fail(failure) {
      submittedDraft = null;
      return publish({
        phase: "failed",
        persisted: snapshot.persisted,
        draft: snapshot.draft,
        failure,
      });
    },
    acceptLatest(latest) {
      submittedDraft = null;
      return publish({
        phase: "clean",
        persisted: latest,
        draft: latest,
      });
    },
  };
};
