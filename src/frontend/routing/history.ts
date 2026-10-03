export type NavigationCause = "bootstrap" | "user" | "replace" | "pop";

export interface NavigationSnapshot<View> {
  readonly view: View;
  readonly href: string;
  readonly index: number;
  readonly cause: NavigationCause;
}

export interface NavigationCodec<View> {
  readonly encode: (view: View) => string;
  readonly decode: (href: string) => View | null;
}

export interface NavigationHistoryState {
  readonly __fullstackNavigation: 1;
  readonly index: number;
}

export interface HistoryLocationEntry {
  readonly href: string;
  readonly state: unknown;
}

export interface BrowserHistoryPort {
  current(): HistoryLocationEntry;
  push(state: NavigationHistoryState, href: string): void;
  replace(state: NavigationHistoryState, href: string): void;
  go(delta: number): void;
  subscribe(listener: (entry: HistoryLocationEntry) => void): () => void;
}

export interface NavigationLeaveContext<View> {
  readonly from: View;
  readonly to: View;
  readonly cause: "user" | "pop";
}

export type NavigationLeaveGuard<View> = (
  context: NavigationLeaveContext<View>,
) => boolean | Promise<boolean>;

export interface NavigationControllerOptions<View> {
  readonly codec: NavigationCodec<View>;
  readonly history: BrowserHistoryPort;
  readonly fallbackView: View;
  readonly canLeave?: NavigationLeaveGuard<View>;
}

export interface NavigationController<View> {
  getSnapshot(): NavigationSnapshot<View>;
  subscribe(listener: () => void): () => void;
  bootstrap(): NavigationSnapshot<View>;
  navigate(view: View): Promise<boolean>;
  replace(view: View): NavigationSnapshot<View>;
  back(): void;
  dispose(): void;
}

const isNavigationState = (value: unknown): value is NavigationHistoryState => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.__fullstackNavigation === 1 &&
    typeof record.index === "number" &&
    Number.isSafeInteger(record.index) &&
    record.index >= 0;
};

const makeState = (index: number): NavigationHistoryState => Object.freeze({
  __fullstackNavigation: 1,
  index,
});

export const createNavigationController = <View>(
  options: NavigationControllerOptions<View>,
): NavigationController<View> => {
  const listeners = new Set<() => void>();
  let initialized = false;
  let restoring = false;
  let currentIndex = 0;
  let snapshot: NavigationSnapshot<View> = Object.freeze({
    view: options.fallbackView,
    href: options.codec.encode(options.fallbackView),
    index: 0,
    cause: "bootstrap",
  });

  const publish = (next: NavigationSnapshot<View>) => {
    snapshot = Object.freeze(next);
    currentIndex = next.index;
    for (const listener of listeners) listener();
    return snapshot;
  };

  const applyPop = async (entry: HistoryLocationEntry) => {
    const view = options.codec.decode(entry.href);
    if (!view) return;
    const state = isNavigationState(entry.state) ? entry.state : null;
    const targetIndex = state?.index ?? currentIndex;

    if (restoring) {
      restoring = false;
      publish({ view, href: entry.href, index: targetIndex, cause: "pop" });
      return;
    }

    const allowed = await options.canLeave?.({
      from: snapshot.view,
      to: view,
      cause: "pop",
    }) ?? true;

    if (!allowed && state) {
      const delta = currentIndex - targetIndex;
      if (delta !== 0) {
        restoring = true;
        options.history.go(delta);
      }
      return;
    }

    publish({ view, href: entry.href, index: targetIndex, cause: "pop" });
  };

  const unsubscribe = options.history.subscribe((entry) => {
    void applyPop(entry);
  });

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bootstrap() {
      if (initialized) return snapshot;
      initialized = true;
      const current = options.history.current();
      const decoded = options.codec.decode(current.href) ?? options.fallbackView;
      const canonicalHref = options.codec.encode(decoded);
      const existingState = isNavigationState(current.state) ? current.state : null;
      currentIndex = existingState?.index ?? 0;
      options.history.replace(makeState(currentIndex), canonicalHref);
      return publish({
        view: decoded,
        href: canonicalHref,
        index: currentIndex,
        cause: "bootstrap",
      });
    },
    async navigate(view) {
      const allowed = await options.canLeave?.({
        from: snapshot.view,
        to: view,
        cause: "user",
      }) ?? true;
      if (!allowed) return false;
      const href = options.codec.encode(view);
      const index = currentIndex + 1;
      options.history.push(makeState(index), href);
      publish({ view, href, index, cause: "user" });
      return true;
    },
    replace(view) {
      const href = options.codec.encode(view);
      options.history.replace(makeState(currentIndex), href);
      return publish({ view, href, index: currentIndex, cause: "replace" });
    },
    back() {
      options.history.go(-1);
    },
    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
};

export const createWindowHistoryPort = (target: Window = window): BrowserHistoryPort => ({
  current: () => ({ href: target.location.href, state: target.history.state }),
  push(state, href) {
    target.history.pushState(state, "", href);
  },
  replace(state, href) {
    target.history.replaceState(state, "", href);
  },
  go(delta) {
    target.history.go(delta);
  },
  subscribe(listener) {
    const onPopState = (event: PopStateEvent) => {
      listener({ href: target.location.href, state: event.state });
    };
    target.addEventListener("popstate", onPopState);
    return () => target.removeEventListener("popstate", onPopState);
  },
});

export const installBeforeUnloadGuard = (
  isBlocked: () => boolean,
  target: Window = window,
): (() => void) => {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isBlocked()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", onBeforeUnload);
  return () => target.removeEventListener("beforeunload", onBeforeUnload);
};
