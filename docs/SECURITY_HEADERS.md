# Security Headers Baseline

## Purpose

This document defines the Full-stack Template baseline for response security headers across the React SPA and Worker API.

The goal is to keep one security contract without forcing all static assets through the Worker runtime.

## Delivery model

The current Cloudflare Static Assets configuration runs the Worker first only for `/api/*`.

```text
/api/*
  -> Worker
  -> applySecurityHeaders(...)

SPA / static assets
  -> Cloudflare Static Assets
  -> public/_headers
```

Do not change `assets.run_worker_first` to `true` only to attach headers. Static assets should keep the asset-serving path unless another requirement justifies Worker-first routing.

`tests/security-headers.test.ts` verifies that the Worker baseline and `public/_headers` stay aligned.

## Baseline

### Content-Security-Policy

```text
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self'
```

This baseline assumes the built SPA serves its executable code and styles from the same origin.

A Project that adds an external API, CDN, analytics product, font provider, image host, or other external source must review and explicitly extend only the required CSP directive. Do not weaken the whole policy mechanically.

`unsafe-eval` is not part of the Production baseline.

### X-Content-Type-Options

```text
X-Content-Type-Options: nosniff
```

### Referrer-Policy

```text
Referrer-Policy: strict-origin-when-cross-origin
```

### Permissions-Policy

```text
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Projects may intentionally enable a capability when a real Product requirement exists.

### Strict-Transport-Security

```text
Strict-Transport-Security: max-age=31536000
```

Worker-generated responses add HSTS only for HTTPS requests. Local HTTP responses do not emit it.

Static Assets declare the same header in `public/_headers`; browsers only honor HSTS when received over HTTPS.

The Template baseline deliberately omits `includeSubDomains` and `preload`. Those settings affect domains outside the immediate application boundary and require an explicit Project-level decision.

## Response preservation

The Worker middleware creates a new response with copied headers before applying the security baseline. Existing endpoint headers must remain intact, including when present:

- `Content-Type`
- `Set-Cookie`
- `ETag`
- `x-request-id`
- cache headers

Security Headers must not change API status codes, bodies, authentication semantics, authorization semantics, or error-envelope structure.

## Responsibility boundary

Security Headers are not replacements for other controls.

They do not implement:

- Origin / CORS policy
- CSRF protection
- Authentication or Authorization
- Request Body limits
- Rate limiting
- input validation

Those controls remain separate HTTP boundaries and Issues.

## Project adaptation

When adopting this Template:

1. keep the baseline unless the application has a concrete reason to change it
2. review every external origin introduced by the Product
3. extend only the CSP directive that requires the origin
4. do not add broad wildcards to make a failing integration disappear
5. decide `includeSubDomains` / HSTS preload separately from application deployment
6. verify both API responses and static asset responses after deployment

The Example baseline is a safe starting point, not a claim that every Product has identical browser-security requirements.
