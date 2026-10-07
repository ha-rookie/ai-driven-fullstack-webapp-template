import {
  WORKHUB_DEMO_PASSWORD,
  WORKHUB_PERSONAS,
} from "../reference/workhub/personas";
import {
  isRuntimeEnvironment,
  type RuntimeEnvironment,
} from "../shared/runtime";
import {
  LocalCredentialService,
  createSessionCookie,
  issueApplicationSession,
  normalizeLocalIdentifier,
} from "./auth";
import {
  apiErrorResponse,
  readJsonBody,
} from "./http";
import {
  CredentialAttackGuard,
  D1CredentialAttackStore,
  credentialAttackRejectionResponse,
  type CredentialAttackDecision,
  type CredentialAttackPolicy,
  type CredentialAttackSubject,
} from "./security";
import type { AuditEvent } from "./audit";

const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
const WORKHUB_LOGIN_ENDPOINT_ID = "workhub_login";
const LOGIN_POLICY: CredentialAttackPolicy = Object.freeze({
  endpointId: WORKHUB_LOGIN_ENDPOINT_ID,
  failureThreshold: 5,
  windowSeconds: 15 * 60,
  lockSeconds: 15 * 60,
});

const passwordBlocklistNotUsedForLogin = {
  isBlocked: async () => false,
};

export interface WorkhubLoginEnvironment {
  readonly DB: D1Database;
  readonly RUNTIME_ENVIRONMENT?: string;
  readonly WORKHUB_DEMO_MODE?: string;
}

export type WorkhubLoginAudit = (
  event: Omit<AuditEvent, "requestId" | "method" | "path">,
) => void;

interface LoginPayload {
  readonly userId: string;
  readonly password: string;
  readonly remember: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const containsControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point !== undefined && (point < 32 || point === 127)) return true;
  }
  return false;
};

const parseLoginPayload = (value: unknown): LoginPayload | null => {
  if (!isRecord(value)) return null;
  const userId = value.userId;
  const password = value.password;
  const remember = value.remember;
  if (
    typeof userId !== "string"
    || userId.length === 0
    || Array.from(userId).length > 254
    || containsControlCharacter(userId)
    || typeof password !== "string"
    || password.length === 0
    || Array.from(password).length > 1024
    || (remember !== undefined && typeof remember !== "boolean")
  ) {
    return null;
  }
  return { userId, password, remember: remember === true };
};

const localHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export const resolveWorkhubRuntimeEnvironment = (
  request: Request,
  configured: string | undefined,
): RuntimeEnvironment => {
  if (isRuntimeEnvironment(configured)) return configured;
  if (localHostname(new URL(request.url).hostname)) return "local";
  throw new Error("workhub_runtime_environment_required");
};

export const isWorkhubDemoEnabled = (
  environment: RuntimeEnvironment,
  configured: string | undefined,
): boolean => {
  if (environment === "production") return false;
  if (environment === "preview") return configured === "true";
  return configured !== "false";
};

const genericAuthenticationFailure = (requestId: string): Response =>
  apiErrorResponse(
    {
      status: 401,
      code: "authentication_failed",
      message: "User ID or password is incorrect",
    },
    requestId,
  );

const loginInputFailure = (requestId: string): Response =>
  apiErrorResponse(
    {
      status: 400,
      code: "login_request_invalid",
      message: "Login request is invalid",
    },
    requestId,
  );

const identifierSubject = (userId: string): CredentialAttackSubject => {
  try {
    return { dimension: "identifier", value: normalizeLocalIdentifier(userId) };
  } catch {
    return { dimension: "identifier", value: "invalid-identifier" };
  }
};

const networkSubject = (request: Request): CredentialAttackSubject | null => {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (connectingIp) return { dimension: "network", value: connectingIp };
  const hostname = new URL(request.url).hostname;
  if (localHostname(hostname)) return { dimension: "network", value: "local-browser" };
  return null;
};

const firstRejection = (
  decisions: readonly CredentialAttackDecision[],
): Extract<CredentialAttackDecision, { kind: "reject" }> | null =>
  decisions.find(
    (decision): decision is Extract<CredentialAttackDecision, { kind: "reject" }> =>
      decision.kind === "reject",
  ) ?? null;

const checkSubjects = async (
  guard: CredentialAttackGuard,
  subjects: readonly CredentialAttackSubject[],
): Promise<Extract<CredentialAttackDecision, { kind: "reject" }> | null> => {
  const decisions = await Promise.all(subjects.map((subject) => guard.check(LOGIN_POLICY, subject)));
  return firstRejection(decisions);
};

const recordFailure = async (
  guard: CredentialAttackGuard,
  subjects: readonly CredentialAttackSubject[],
): Promise<Extract<CredentialAttackDecision, { kind: "reject" }> | null> => {
  const decisions = await Promise.all(
    subjects.map((subject) => guard.recordFailure(LOGIN_POLICY, subject)),
  );
  return firstRejection(decisions);
};

export const handleWorkhubDemoConfig = (
  request: Request,
  env: WorkhubLoginEnvironment,
  requestId: string,
): Response | null => {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/api/workhub/demo-config") return null;

  let environment: RuntimeEnvironment;
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    return apiErrorResponse(
      {
        status: 503,
        code: "reference_configuration_unavailable",
        message: "Reference configuration is unavailable",
      },
      requestId,
    );
  }

  const enabled = isWorkhubDemoEnabled(environment, env.WORKHUB_DEMO_MODE);
  return Response.json({
    demoEnabled: enabled,
    personas: enabled
      ? WORKHUB_PERSONAS.map(({ key, userId, displayName, roleLabel, homeHint }) => ({
          key,
          userId,
          displayName,
          roleLabel,
          homeHint,
        }))
      : [],
    ...(enabled ? { demoPassword: WORKHUB_DEMO_PASSWORD } : {}),
  });
};

export const handleWorkhubLogin = async (
  request: Request,
  env: WorkhubLoginEnvironment,
  requestId: string,
  audit: WorkhubLoginAudit,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/auth/login") return null;

  let environment: RuntimeEnvironment;
  try {
    environment = resolveWorkhubRuntimeEnvironment(request, env.RUNTIME_ENVIRONMENT);
  } catch {
    audit({
      category: "authentication",
      action: "local_login",
      outcome: "failure",
      reason: "environment_unknown",
    });
    return apiErrorResponse(
      {
        status: 503,
        code: "authentication_unavailable",
        message: "Authentication is unavailable",
      },
      requestId,
    );
  }

  const body = await readJsonBody(request, { maxBytes: LOGIN_BODY_LIMIT_BYTES });
  if (!body.ok) {
    return apiErrorResponse(
      { status: body.status, code: body.code, message: body.message },
      requestId,
    );
  }
  const payload = parseLoginPayload(body.value);
  if (!payload) return loginInputFailure(requestId);

  const identifier = identifierSubject(payload.userId);
  const network = networkSubject(request);
  const subjects = network ? [identifier, network] : [identifier];
  const guard = new CredentialAttackGuard(
    new D1CredentialAttackStore({ db: env.DB }),
    environment,
  );

  let dependencyStage = "attack_guard_check";
  try {
    const existingRejection = await checkSubjects(guard, subjects);
    if (existingRejection) {
      audit({
        category: "authentication",
        action: "local_login",
        outcome: "failure",
        reason: "temporarily_limited",
      });
      return credentialAttackRejectionResponse(existingRejection, requestId);
    }

    dependencyStage = "credential_authenticate";
    const credentials = new LocalCredentialService({
      db: env.DB,
      blocklist: passwordBlocklistNotUsedForLogin,
    });
    const authenticated = await credentials.authenticate(payload.userId, payload.password);
    if (!authenticated) {
      const rejection = await recordFailure(guard, subjects);
      audit({
        category: "authentication",
        action: "local_login",
        outcome: "failure",
        reason: rejection ? "temporarily_limited" : "credential_invalid",
      });
      return rejection
        ? credentialAttackRejectionResponse(rejection, requestId)
        : genericAuthenticationFailure(requestId);
    }

    dependencyStage = "session_issue";
    const session = await issueApplicationSession(env.DB, authenticated.userId);
    dependencyStage = "attack_guard_clear";
    await guard.recordSuccess(LOGIN_POLICY, identifier);
    audit({
      category: "authentication",
      action: "local_login",
      outcome: "success",
      actorId: authenticated.userId,
      resourceType: "application_session",
    });

    return Response.json(
      {
        authenticated: true,
        user: { id: authenticated.userId },
        remember: payload.remember,
      },
      {
        status: 200,
        headers: {
          "set-cookie": createSessionCookie(session.token),
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    audit({
      category: "authentication",
      action: "local_login",
      outcome: "failure",
      reason: `dependency_error:${dependencyStage}`,
    });
    return apiErrorResponse(
      {
        status: 503,
        code: "authentication_unavailable",
        message: "Authentication is unavailable",
      },
      requestId,
    );
  }
};
