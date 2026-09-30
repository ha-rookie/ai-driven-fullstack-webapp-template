# Rate Limiting Boundary

## Purpose

`RateLimitGuard` is a reusable fixed-window boundary for authentication, re-authentication and other sensitive API operations. It deliberately separates **rate-limit policy** from the **shared counter store** so the Full-stack Template does not pretend that Worker isolate-local memory is a production security boundary.

The baseline provides:

- stable endpoint policy (`endpointId`, `limit`, `windowSeconds`)
- actor or IP subject dimensions
- opaque, versioned storage keys
- allow / reject decisions
- HTTP `429` + `Retry-After` mapping
- safe Audit fields for rejections
- a local-only test store

It does **not** select a production distributed provider.

## Policy and subject

A caller defines a project-specific threshold:

```ts
const policy = {
  endpointId: "auth_login",
  limit: 5,
  windowSeconds: 60,
};
```

`endpointId` is a stable developer-authored identifier, not a raw URL. Do not put path parameters, query strings, user-generated text, tokens or cookies into it.

Each check uses exactly one subject dimension:

```ts
{ kind: "actor", id: userId }
{ kind: "ip", id: trustedClientIp }
```

If a project needs both actor and network controls, evaluate the same Guard twice with the two dimensions and reject if either rejects. This avoids a single `actor+ip` composite bucket that could be bypassed simply by changing one dimension.

Subject IDs must be bounded safe identifiers. The Guard hashes the subject dimension and ID with SHA-256 before building the storage key, so a raw actor ID or IP address is not persisted in the counter key.

## Trusted network identity

The Guard does **not** read `x-forwarded-for`, `CF-Connecting-IP`, Cookie or other request headers itself.

Network identity is a deployment trust-boundary decision. A Cloudflare deployment may decide that a platform-provided client IP header is trusted, while a local/dev environment may inject a synthetic subject. Resolve and validate that identity before calling the Guard.

This prevents the shared primitive from accidentally treating a spoofable application header as security identity.

## Store contract

`RateLimitStore.increment(...)` receives an opaque versioned key plus current/reset timestamps and must return a **positive integer count**.

A production implementation must provide an atomic increment for one storage key. Possible project choices include a Cloudflare-specific binding, Durable Object, external shared datastore, or another design justified by the product and threat model. The generic template intentionally does not select one.

Store failures are propagated. The baseline does not silently choose fail-open or fail-closed because that decision differs by endpoint:

- a login/credential attack boundary may prefer fail-closed
- a lower-risk business endpoint may prefer availability
- some projects may map limiter dependency failure to `503`

Make that decision explicitly at the endpoint composition layer.

## LocalRateLimitStore is not production security

`LocalRateLimitStore` exists for unit/local tests only. It uses an in-process `Map` and opportunistically removes expired buckets.

Do **not** wire it into production Cloudflare Workers. Requests can run in different isolates and regions, so process-local state does not provide a globally consistent rate limit and can create a false sense of protection.

## Fixed-window behavior

The baseline uses fixed windows. A request increments a bucket identified by:

```text
rate-limit:v1:<endpointId>:<subject-kind>:<sha256(subject)>:<window-start-ms>
```

The decision includes:

- `limit`
- `remaining`
- `resetAtEpochSeconds`
- `retryAfterSeconds` on rejection

The project can replace the store implementation later without changing the HTTP/Audit contracts.

## HTTP mapping

`rateLimitRejectionResponse(...)` maps a reject decision to the existing API error envelope:

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests"
  },
  "requestId": "request-123"
}
```

The response status is `429` and includes a positive integer `Retry-After` header in seconds. Request correlation remains the existing `x-request-id` contract.

## Audit mapping

`rateLimitRejectionAuditFields(...)` returns fields compatible with the existing Audit helper:

- category: `system`
- action: `rate_limit_guard`
- outcome: `failure`
- resourceType: `http_endpoint`
- resourceId: stable `endpointId`
- reason: `actor_rate_limited` or `ip_rate_limited`

For actor subjects, the actor ID may be included for accountability. For IP subjects, the raw IP and storage key are deliberately excluded from Audit. Issue #91 may later connect these fields to a unified Security Rejection Event adapter without changing this Guard's core decision contract.

## Integration example

```ts
const decision = await limiter.check({
  policy: { endpointId: "auth_login", limit: 5, windowSeconds: 60 },
  subject: { kind: "ip", id: trustedClientIp },
});

if (decision.kind === "reject") {
  audit(rateLimitRejectionAuditFields({
    policy: { endpointId: "auth_login", limit: 5, windowSeconds: 60 },
    subject: { kind: "ip", id: trustedClientIp },
  }));
  return rateLimitRejectionResponse(decision, requestId);
}
```

The example assumes `limiter` has a production-safe shared store. The template does not instantiate one by default.

## Out of scope

- Cloudflare WAF/rate limiting rules
- choosing a distributed rate-limit provider
- product-specific thresholds
- CAPTCHA / bot scoring / credential stuffing policy
- complete Security Rejection Event unification
- persistent rate-limit analytics or retention

## Tests

Tests verify actor/IP and endpoint bucket separation, limit/reject behavior, fixed-window reset, local-store expiry cleanup, opaque storage keys, `429 + Retry-After`, safe Audit fields, invalid configuration rejection and store failure propagation. Existing local validation, lint, build and protected-boundary CI remain the integration gate.
