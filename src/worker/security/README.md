# Security Rejection Event

`SecurityRejectionEvent` is the common internal representation for rejected authentication, authorization, rate-limit, CSRF, and origin/CORS decisions.

## Responsibility boundary

- A guard decides whether a request is allowed or rejected.
- The HTTP boundary that owns the rejected response creates **one** `SecurityRejectionEvent` for that rejection.
- Audit and Application Log integrations consume that same event through the provided mappers.
- Do not emit one event inside the guard and another event again in the route/response layer.
- Client error responses remain separate and must not expose internal `reasonCode` detail.

## Sensitive data

The common event contract intentionally has no fields for credentials, raw tokens, cookies, passwords, request bodies, or raw IP addresses. Adapters must keep those values out of the event payload.

## Failure handling

Event or sink failure must never turn a rejected request into an allowed request. Projects may choose whether a particular Audit sink failure is fail-closed or best-effort, but the original security decision remains rejected.
