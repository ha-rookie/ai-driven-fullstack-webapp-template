export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

export const HSTS_HEADER_VALUE = "max-age=31536000";

export const BASE_SECURITY_HEADERS = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

export const isHttpsRequest = (request: Request): boolean =>
  new URL(request.url).protocol === "https:";

export const applySecurityHeaders = (
  response: Response,
  request: Request,
): Response => {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  if (isHttpsRequest(request)) {
    headers.set("strict-transport-security", HSTS_HEADER_VALUE);
  } else {
    headers.delete("strict-transport-security");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
