import { StructuredApplicationLogger } from "./shared/logging";
import { ApplicationMetricsRecorder, toMetricsEnvironment } from "./shared/observability";
import {
  clearSessionCookie,
  createSessionPolicy,
  resolveApplicationSession,
  revokeApplicationSession,
} from "./worker/auth";
import {
  attachRequestId,
  consoleAuditLogger,
  createRequestContext,
  writeAuditSafely,
  type AuditEvent,
} from "./worker/audit";
import { handleExampleResourceApi } from "./worker/example-resource-api";
import { handleAuditLogViewerApi } from "./worker/administration";
import { handleLiveness, handleReadiness } from "./worker/health";
import {
  apiErrorResponse,
  applyCorsResponseHeaders,
  applySecurityHeaders,
  buildCorsPreflightResponse,
  createCorsPolicy,
  csrfGuardFailureResponse,
  evaluateCorsRequest,
  issueCsrfTokenForRequest,
  requireCsrfProtection,
} from "./worker/http";
import { handleWorkhubBusinessApi } from "./worker/workhub-business-api";
import {
  handleWorkhubDemoConfig,
  handleWorkhubLogin,
} from "./worker/workhub-login";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CORS_ALLOWED_ORIGINS?: string;
  SESSION_IDLE_TIMEOUT_SECONDS?: string;
  SESSION_TOUCH_INTERVAL_SECONDS?: string;
  WORKHUB_DEMO_MODE?: string;
  /** Set explicitly to local/test/preview/production for trustworthy metric environment labels. */
  RUNTIME_ENVIRONMENT?: string;
}

type RequestAuditFields = Omit<AuditEvent, "requestId" | "method" | "path">;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });

const metricRouteFor = (method: string, pathname: string): string => {
  if (method === "GET" && (pathname === "/api/health" || pathname === "/api/health/live")) {
    return "health_live";
  }
  if (method === "GET" && (pathname === "/api/health/database" || pathname === "/api/health/ready")) {
    return "health_ready";
  }
  if (method === "POST" && pathname === "/api/auth/login") return "auth_login";
  if (method === "GET" && pathname === "/api/auth/me") return "auth_me";
  if (method === "GET" && pathname === "/api/auth/csrf") return "auth_csrf";
  if (method === "POST" && pathname === "/api/auth/logout") return "auth_logout";
  if (method === "GET" && pathname === "/api/workhub/demo-config") return "workhub_demo_config";
  if (pathname.startsWith("/api/workhub/")) return "workhub_business";
  if (pathname.startsWith("/api/scopes/")) return "scoped_resource";
  return "api_other";
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const requestContext = createRequestContext(request);
    const appLogger = new StructuredApplicationLogger("worker.http").withContext({
      requestId: requestContext.requestId,
    });
    const metrics = new ApplicationMetricsRecorder({
      environment: toMetricsEnvironment(env.RUNTIME_ENVIRONMENT),
      component: "worker.http",
    });
    const requestMetric = metrics.startRequest({
      route: metricRouteFor(request.method, url.pathname),
      method: request.method,
      requestId: requestContext.requestId,
    });
    const dependencyFailure = (operation: string) =>
      metrics.recordDependencyFailure({
        dependency: "d1",
        operation,
        requestId: requestContext.requestId,
      });
    const secure = (response: Response) => {
      requestMetric.complete(response.status);
      return applySecurityHeaders(
        attachRequestId(response, requestContext.requestId),
        request,
      );
    };

    let corsPolicy;
    let sessionPolicy;
    try {
      corsPolicy = createCorsPolicy({
        allowedOrigins: env.CORS_ALLOWED_ORIGINS,
      });
      sessionPolicy = createSessionPolicy({
        idleTimeoutSeconds: env.SESSION_IDLE_TIMEOUT_SECONDS,
        touchIntervalSeconds: env.SESSION_TOUCH_INTERVAL_SECONDS,
      });
    } catch {
      return secure(
        apiErrorResponse(
          {
            status: 500,
            code: "security_configuration_invalid",
            message: "Internal server error",
          },
          requestContext.requestId,
        ),
      );
    }

    const corsDecision = evaluateCorsRequest(request, corsPolicy);
    if (corsDecision.kind === "reject") {
      return secure(
        apiErrorResponse(
          {
            status: 403,
            code: "origin_forbidden",
            message: "Access denied",
          },
          requestContext.requestId,
        ),
      );
    }

    if (corsDecision.kind === "preflight") {
      return secure(buildCorsPreflightResponse(corsDecision, corsPolicy));
    }

    const api = (response: Response) =>
      secure(applyCorsResponseHeaders(response, corsDecision));
    const audit = (event: RequestAuditFields) =>
      writeAuditSafely(consoleAuditLogger, { ...requestContext, ...event });

    if (
      request.method === "GET" &&
      (url.pathname === "/api/health" || url.pathname === "/api/health/live")
    ) {
      return api(handleLiveness());
    }

    if (
      request.method === "GET" &&
      (url.pathname === "/api/health/database" || url.pathname === "/api/health/ready")
    ) {
      return api(
        await handleReadiness(env.DB, () => {
          appLogger.warn("database_readiness_unavailable");
          dependencyFailure("health_readiness");
        }),
      );
    }

    const demoConfigResponse = handleWorkhubDemoConfig(
      request,
      env,
      requestContext.requestId,
    );
    if (demoConfigResponse) return api(demoConfigResponse);

    const loginResponse = await handleWorkhubLogin(
      request,
      env,
      requestContext.requestId,
      audit,
    );
    if (loginResponse) return api(loginResponse);

    const auditViewerResponse = await handleAuditLogViewerApi(
      request,
      env,
      requestContext.requestId,
    );
    if (auditViewerResponse) return api(auditViewerResponse);

    const workhubBusinessResponse = await handleWorkhubBusinessApi(request, env);
    if (workhubBusinessResponse) return api(workhubBusinessResponse);

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      try {
        const session = await resolveApplicationSession(
          request,
          env.DB,
          undefined,
          sessionPolicy,
        );
        if (!session) {
          audit({
            category: "authentication",
            action: "session_resolve",
            outcome: "failure",
            reason: "session_missing_or_invalid",
          });
          return api(json({ authenticated: false }, { status: 401 }));
        }

        return api(json({ authenticated: true, user: session.user }));
      } catch {
        dependencyFailure("auth_session_resolve");
        audit({
          category: "authentication",
          action: "session_resolve",
          outcome: "failure",
          reason: "dependency_error",
        });
        return api(
          apiErrorResponse(
            {
              status: 503,
              code: "authentication_unavailable",
              message: "Authentication is unavailable",
            },
            requestContext.requestId,
          ),
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/api/auth/csrf") {
      try {
        const session = await resolveApplicationSession(
          request,
          env.DB,
          undefined,
          sessionPolicy,
        );
        if (!session) {
          audit({
            category: "authentication",
            action: "csrf_token_issue",
            outcome: "failure",
            reason: "session_missing_or_invalid",
          });
          return api(
            apiErrorResponse(
              {
                status: 401,
                code: "authentication_required",
                message: "Authentication required",
              },
              requestContext.requestId,
            ),
          );
        }

        const csrfToken = await issueCsrfTokenForRequest(request);
        if (!csrfToken) {
          throw new Error("CSRF token invariant violated");
        }

        return api(json({ csrfToken }));
      } catch {
        dependencyFailure("auth_csrf_issue");
        audit({
          category: "authentication",
          action: "csrf_token_issue",
          outcome: "failure",
          reason: "dependency_error",
        });
        return api(
          apiErrorResponse(
            {
              status: 503,
              code: "authentication_unavailable",
              message: "Authentication is unavailable",
            },
            requestContext.requestId,
          ),
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const csrf = await requireCsrfProtection(request);
      if (!csrf.allowed) {
        audit({
          category: "authentication",
          action: "csrf_guard",
          outcome: "failure",
          resourceType: "application_session",
          reason: csrf.reason,
        });
        return api(csrfGuardFailureResponse(csrf, requestContext.requestId));
      }

      try {
        await revokeApplicationSession(request, env.DB);
        audit({
          category: "authentication",
          action: "logout",
          outcome: "success",
          resourceType: "application_session",
        });
        return api(
          new Response(null, {
            status: 204,
            headers: { "set-cookie": clearSessionCookie() },
          }),
        );
      } catch {
        dependencyFailure("auth_logout");
        audit({
          category: "authentication",
          action: "logout",
          outcome: "failure",
          resourceType: "application_session",
          reason: "dependency_error",
        });
        return api(
          apiErrorResponse(
            {
              status: 503,
              code: "authentication_unavailable",
              message: "Authentication is unavailable",
            },
            requestContext.requestId,
          ),
        );
      }
    }

    const exampleResourceResponse = await handleExampleResourceApi(
      request,
      env.DB,
      audit,
      requestContext.requestId,
      sessionPolicy,
    );
    if (exampleResourceResponse) {
      return api(exampleResourceResponse);
    }

    return api(
      apiErrorResponse(
        {
          status: 404,
          code: "not_found",
          message: "API route not found",
        },
        requestContext.requestId,
      ),
    );
  },
} satisfies ExportedHandler<Env>;
