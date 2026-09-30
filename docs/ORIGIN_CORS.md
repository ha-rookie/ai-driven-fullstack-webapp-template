# Origin / CORS Boundary

## Purpose

Issue #67 adds a reusable Origin / CORS boundary for the Worker API without turning CORS into an Authentication, Authorization, or CSRF mechanism.

The baseline is deliberately conservative:

```text
same-origin
  -> allowed

no Origin header
  -> treated as non-CORS client and allowed

cross-origin
  -> exact allowlist only

wildcard / null / malformed Origin
  -> rejected
```

## Request order

Origin / CORS evaluation happens before session resolution and protected API routing:

```text
HTTP Request
   ↓
Origin / CORS Guard
   ├─ reject disallowed cross-origin
   └─ answer valid preflight
   ↓
Authentication / Authorization
   ↓
Request Body / Domain / Integrity
```

A rejected Origin therefore does not reach D1-backed session resolution or Domain mutation code.

CORS preflight is also handled before Authentication. Browsers do not attach the application session as a requirement for the preflight decision itself.

## Configuration contract

The runtime reads the optional environment binding:

```text
CORS_ALLOWED_ORIGINS
```

Its value is a comma-separated list of exact canonical origins:

```text
https://app.example.com,https://admin.example.com
```

The Template does not ship real Project origins. Projects bind this value independently for Preview and Production.

For example, a Project may conceptually use:

```text
Preview    -> https://preview-app.example.test
Production -> https://app.example.com
```

Those are deployment settings, not values to copy into Template source.

If the binding is missing or empty, the baseline becomes **same-origin only**.

### Accepted configured origin

Each configured value must be:

- absolute `http:` or `https:` origin
- canonical origin only
- no path
- no query
- no fragment
- no embedded credentials
- no wildcard
- not the special `null` Origin

Invalid configuration fails closed. It is not ignored and it does not broaden access.

Issue #86 may later centralize broader Security Configuration validation, but this Guard already prevents an invalid CORS value from silently weakening the boundary.

## Same-origin and no-Origin requests

A request whose `Origin` exactly equals the request URL origin is allowed without adding CORS response headers.

Requests with no `Origin` header are also allowed. This preserves non-browser clients such as CLI tools, server-to-server calls, health checks, and the Local boundary fixture.

`Origin` absence is **not** treated as evidence that a request is safe from CSRF. CSRF protection is a separate Issue (#89).

## Allowed cross-origin responses

When a cross-origin request matches the exact allowlist, the response receives:

```http
Access-Control-Allow-Origin: <exact request Origin>
Access-Control-Allow-Credentials: true
Vary: Origin
```

The configured Origin is never replaced by `*`.

`Access-Control-Allow-Credentials: true` keeps the CORS contract compatible with the Template's Cookie-based Application Session for trusted origins. It does not change browser cookie policy by itself.

The current session cookie remains `Secure; SameSite=Lax`. A Project that intentionally separates frontend and API across sites must evaluate its cookie policy separately; Issue #67 does not weaken `SameSite` or other session attributes.

## Preflight

A cross-origin request with:

```http
OPTIONS
Origin: https://allowed.example
Access-Control-Request-Method: PATCH
```

is handled before Authentication.

The baseline allowed methods are:

```text
GET, HEAD, POST, PATCH, DELETE, OPTIONS
```

The baseline request headers are:

```text
Content-Type
If-Match
X-Request-Id
```

A valid preflight returns `204` with:

```http
Access-Control-Allow-Origin: <exact request Origin>
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: ...
Access-Control-Allow-Headers: ...
Access-Control-Max-Age: 600
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

Requested methods or headers outside the baseline fail closed with the same generic `403 origin_forbidden` contract.

Issue #89 may later add the chosen CSRF proof header to this preflight allowlist when that contract exists. This Issue does not guess that header in advance.

## Rejection contract

Malformed, `null`, unlisted, or otherwise disallowed cross-origin requests return:

```text
403 origin_forbidden
```

The response does not reveal which Origins are configured or why a particular allowlist lookup failed.

Security Rejection Event handling is tracked separately by Issue #91.

## Exact-match rule

The Guard compares canonical Origin strings exactly.

It must not use:

- substring matching
- suffix matching
- `endsWith("example.com")`
- wildcard subdomain matching hidden inside the baseline

For example:

```text
allowed: https://app.example.com
reject:  https://app.example.com.evil.test
```

Projects that intentionally require wildcard subdomain policy should design and test that policy explicitly rather than weakening the Template baseline.

## Responsibility boundary

Origin / CORS does not replace:

- Authentication
- Authorization
- CSRF proof
- Security Headers
- Rate limiting
- OAuth/OIDC `state` / `nonce`
- SAML replay protection

The Worker still applies the existing Security Headers middleware to CORS success, preflight, and rejection responses.

## What Projects should preserve

When adapting this boundary, preserve:

- same-origin default
- exact allowlist for cross-origin access
- fail-closed invalid configuration
- preflight before Authentication
- no wildcard with credentials
- `Vary: Origin` on dynamic ACAO responses
- separation from CSRF/Auth/Authz
- environment-specific Preview / Production values
- negative tests for suffix/subdomain bypass

Concrete origins, methods beyond the baseline, and additional allowed headers remain Project decisions.
