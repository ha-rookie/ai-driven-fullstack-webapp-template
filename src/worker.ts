import {
  clearSessionCookie,
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
import {
  apiErrorResponse,
  applyCorsResponseHeaders,
  applySecurityHeaders,
  buildCorsPreflightResponse,
  createCorsPolicy,
  evaluateCorsRequest,
} from "./worker/http";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CORS_ALLOWED_ORIGINS?: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const requestContext = createRequestContext(request);
    const secure = (response: Response) =>
      applySecurityHeaders(
        attachRequestId(response, requestContext.requestId),
        request,
      );

    let corsPolicy;
    try {
      corsPolicy = createCorsPolicy({
        allowedOrigins: env.CORS_ALLOWED_ORIGINS,
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

    if (request.method === "GET" && url.pathname === "/api/health") {
      return api(json({ status: "ok" }));
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/health/database"
    ) {
      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return api(
          row?.ok === 1
            ? json({ status: "ok" })
            : json({ status: "unavailable" }, { status: 503 }),
        );
      } catch {
        return api(json({ status: "unavailable" }, { status: 503 }));
      }
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      try {
        const session = await resolveApplicationSession(request, env.DB);
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

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
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
