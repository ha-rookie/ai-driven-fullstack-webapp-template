import type { RequestContext } from "./types";

export const REQUEST_ID_MAX_LENGTH = 128;

const requestIdPattern = /^[A-Za-z0-9._:-]+$/;

export const isSafeRequestId = (value: string | null): value is string =>
  Boolean(
    value &&
      value.length <= REQUEST_ID_MAX_LENGTH &&
      requestIdPattern.test(value),
  );

export const resolveRequestId = (
  request: Request,
  generateId: () => string = () => crypto.randomUUID(),
): string => {
  const cfRay = request.headers.get("cf-ray");
  if (isSafeRequestId(cfRay)) return cfRay;

  const requestId = request.headers.get("x-request-id");
  if (isSafeRequestId(requestId)) return requestId;

  return generateId();
};

export const createRequestContext = (
  request: Request,
  generateId?: () => string,
): RequestContext => {
  const url = new URL(request.url);
  return {
    requestId: resolveRequestId(request, generateId),
    method: request.method,
    path: url.pathname,
  };
};

export const attachRequestId = (
  response: Response,
  requestId: string,
): Response => {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
