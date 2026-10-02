import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { ApiClientError } from "../../src/frontend/api";
import {
  AuthProvider,
  createAuthApiLoader,
  createAuthController,
  RuntimeReauthBoundary,
  useAuth,
  useRuntimeReauth,
} from "../../src/frontend/auth";
import { createMutationState, runSafeMutation } from "../../src/frontend/mutation";
import {
  createNavigationController,
  createWindowHistoryPort,
  installBeforeUnloadGuard,
  ProtectedRoute,
  type NavigationCodec,
} from "../../src/frontend/routing";

type View = "home" | "list" | "detail";
type MutationMode = "success" | "delay" | "conflict" | "auth";

const HARNESS_PATH = "/e2e/harness/index.html";

const codec: NavigationCodec<View> = {
  encode(view) {
    return `${HARNESS_PATH}?view=${view}`;
  },
  decode(href) {
    const url = new URL(href, window.location.origin);
    if (url.pathname !== HARNESS_PATH) return null;
    const value = url.searchParams.get("view");
    return value === "home" || value === "list" || value === "detail" ? value : null;
  },
};

let dirty = false;
let confirmLeave = true;

const navigation = createNavigationController<View>({
  codec,
  history: createWindowHistoryPort(window),
  fallbackView: "home",
  canLeave: () => {
    if (!dirty) return true;
    const allowed = confirmLeave ? window.confirm("Discard unsaved changes?") : false;
    if (allowed) dirty = false;
    return allowed;
  },
});
navigation.bootstrap();
installBeforeUnloadGuard(() => dirty, window);

let authMode: "authenticated" | "unauthenticated" = "authenticated";
let authDelayMs = 20;
const authLoader = createAuthApiLoader(async () => {
  await new Promise((resolve) => setTimeout(resolve, authDelayMs));
  if (authMode === "unauthenticated") {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { "content-type": "application/json", "x-request-id": "browser-auth-401" },
    });
  }
  return new Response(JSON.stringify({
    authenticated: true,
    user: { id: "browser-user", displayName: "Browser User" },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "browser-auth-200" },
  });
});
const authController = createAuthController(authLoader);

const mutation = createMutationState("server-original");
let mutationMode: MutationMode = "success";
let mutationExecutions = 0;

const NavigationHarness = () => {
  const snapshot = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
  const [filter, setFilter] = useState("");
  const [dirtyRender, setDirtyRender] = useState(dirty);

  useEffect(() => () => navigation.dispose(), []);

  const markDirty = (next: boolean) => {
    dirty = next;
    setDirtyRender(next);
  };

  return (
    <section aria-labelledby="navigation-heading">
      <h2 id="navigation-heading">Navigation</h2>
      <p data-testid="current-view">{snapshot.view}</p>
      <p data-testid="history-index">{snapshot.index}</p>
      <nav aria-label="Reference navigation">
        <button type="button" onClick={() => void navigation.navigate("home")}>Home</button>
        <button type="button" onClick={() => void navigation.navigate("list")}>List</button>
        <button type="button" onClick={() => void navigation.navigate("detail")}>Detail</button>
        <button type="button" onClick={navigation.back}>Back</button>
      </nav>
      <label>
        Filter
        <input
          aria-label="Filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <p data-testid="filter-value">{filter}</p>
      <label>
        <input
          type="checkbox"
          checked={dirtyRender}
          onChange={(event) => markDirty(event.target.checked)}
        />
        Unsaved navigation state
      </label>
      <button type="button" onClick={() => { confirmLeave = false; }}>Block next leave</button>
      <button type="button" onClick={() => { confirmLeave = true; }}>Use browser confirmation</button>
    </section>
  );
};

const AuthHarness = () => {
  const auth = useAuth();

  const becomeAuthenticated = () => {
    authMode = "authenticated";
    void auth.synchronize();
  };

  return (
    <section aria-labelledby="auth-heading">
      <h2 id="auth-heading">Authentication</h2>
      <p data-testid="auth-status">{auth.status}</p>
      <p data-testid="auth-syncing">{String(auth.syncing)}</p>
      <button type="button" onClick={() => {
        authMode = "unauthenticated";
        auth.resetAfterLogout();
      }}>Simulate logout</button>
      <button type="button" onClick={becomeAuthenticated}>Authenticate</button>
      <button type="button" onClick={() => {
        authDelayMs = 150;
        void auth.synchronize().finally(() => { authDelayMs = 20; });
      }}>Synchronize slowly</button>
      <ProtectedRoute
        loginPath="/login"
        currentPath="/protected"
        pending={<p data-testid="protected-pending">Checking access</p>}
        renderUnauthenticated={(intent) => (
          <p data-testid="login-intent">{intent.href}</p>
        )}
        renderError={() => <p data-testid="protected-error">Authentication unavailable</p>}
      >
        <p data-testid="protected-content">Protected content</p>
      </ProtectedRoute>
    </section>
  );
};

const MutationHarness = () => {
  const snapshot = useSyncExternalStore(mutation.subscribe, mutation.getSnapshot, mutation.getSnapshot);
  const recovery = useRuntimeReauth();
  const [, rerender] = useState(0);

  const setMode = (mode: MutationMode) => {
    mutationMode = mode;
    rerender((value) => value + 1);
  };

  const save = async () => {
    await runSafeMutation(
      mutation,
      async ({ draft }) => {
        mutationExecutions += 1;
        rerender((value) => value + 1);
        if (mutationMode === "delay") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return draft;
        }
        if (mutationMode === "conflict") {
          throw new ApiClientError("http", "Conflict", {
            status: 409,
            requestId: "browser-conflict",
            apiError: { error: { code: "conflict", message: "private" }, requestId: "browser-conflict" },
          });
        }
        if (mutationMode === "auth") {
          throw new ApiClientError("http", "Authentication required", {
            status: 401,
            requestId: "browser-auth-expired",
            apiError: {
              error: { code: "authentication_required", message: "private" },
              requestId: "browser-auth-expired",
            },
          });
        }
        return draft;
      },
      {
        loadLatest: async () => "server-latest",
        onAuthenticationRequired: recovery.reportAuthenticationFailure,
      },
    );
    rerender((value) => value + 1);
  };

  return (
    <section aria-labelledby="mutation-heading">
      <h2 id="mutation-heading">Mutation safety</h2>
      <label>
        Draft
        <input
          aria-label="Draft"
          value={snapshot.draft}
          onChange={(event) => mutation.setDraft(event.target.value)}
        />
      </label>
      <p data-testid="mutation-phase">{snapshot.phase}</p>
      <p data-testid="persisted-value">{snapshot.persisted}</p>
      <p data-testid="mutation-executions">{mutationExecutions}</p>
      <p data-testid="recovery-status">{recovery.status}</p>
      <div role="group" aria-label="Mutation mode">
        {(["success", "delay", "conflict", "auth"] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={mutationMode === mode} onClick={() => setMode(mode)}>
            {mode}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => void save()}>Save</button>
    </section>
  );
};

const Harness = () => {
  const reauth = useMemo(() => async () => {
    authMode = "authenticated";
    await new Promise((resolve) => setTimeout(resolve, 40));
  }, []);

  return (
    <main>
      <h1>Full-stack Template Browser Harness</h1>
      <RuntimeReauthBoundary beginReauthentication={reauth}>
        <AuthHarness />
        <NavigationHarness />
        <MutationHarness />
      </RuntimeReauthBoundary>
    </main>
  );
};

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <AuthProvider controller={authController}>
      <Harness />
    </AuthProvider>
  </StrictMode>,
);
