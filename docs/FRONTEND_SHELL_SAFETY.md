# Frontend Shell Safety

## Scope

This document defines the reusable React presentation boundaries for Operation Mode, permission-aware visibility and render/runtime exception isolation. These components improve user feedback and failure containment; they do **not** replace server-side authorization, mutation guards, audit, idempotency or operation-mode enforcement.

## Operation Mode presentation (#118)

`OperationModeProvider` requires a Project-supplied `OperationModeLoader`. The Template deliberately does not hard-code `/api/admin/operation-mode` as the global banner source: #117 is a privileged control-plane endpoint and ordinary application users may not have `operation_mode:read` administration permission.

A Project should expose or adapt an appropriate read-only status source and map its trusted server result to:

- `mode`: `normal | read-only | maintenance`
- positive `version`
- optional `updatedAt`
- optional server-derived `retryAfterSeconds`

The frontend must not invent a maintenance end time or Retry-After value. If the loader fails before any trusted state is known, the controller returns `error` and never fabricates `normal`. If a refresh fails after a known state, that state is retained only as `stale`; `OperationModeBanner` explicitly reports that the status may be out of date. The provider refreshes on browser focus by default and also exposes explicit `refresh()`.

`OperationModeIndicator` is presentation only. The server-side `OperationModeGuard` (#78) remains authoritative for whether a request may mutate data. Hiding or disabling UI must never be treated as enforcement.

## Permission-aware presentation (#77)

`PermissionProvider` connects the authenticated `AuthUser` to a Project-supplied `PermissionEvaluator`. The evaluator may close over a Project-specific role/permission context, but the Template does not define `admin`, `super-admin` or other Product role names.

`PermissionGuard` supports either hiding children or rendering a fallback. It is suitable for presentation such as a destructive-action button, but the actual request must still pass server-side Authorization (#62 / Project policy). Unauthenticated state, invalid permission keys and evaluator exceptions fail closed.

Do not serialize privileged server policy, credentials or secrets into the browser merely to make `PermissionGuard` work. Send only the minimum safe permission context a Project chooses to expose.

## Render/runtime exception isolation (#131)

`SafeErrorBoundary` is separate from API error presentation (#129). It catches React render/runtime failures below the boundary and replaces the failed subtree with a generic fallback. It never renders the caught error message or stack.

The optional `onReport` sink receives only a bounded classification payload:

- `kind: render_error`
- optional `boundaryId`
- optional correlation/reference ID supplied by the Project

The raw Error and React component stack are intentionally excluded from the shared report contract. Projects that need deeper diagnostics must introduce an explicit, privacy-reviewed adapter rather than forwarding arbitrary exceptions to a remote service.

The fallback offers two recovery paths:

- retry: reset this boundary and render its children again
- reload: reload the application (or invoke a Project-supplied reload function)

`resetKey` can reset a route/section boundary when the surrounding navigation context changes.

## Testing boundary

Unit/component tests cover state transitions, safe markup, fail-closed permission behavior and bounded reporting. Full browser behavior, focus refresh, real render-failure recovery, PWA lifecycle and accessibility traversal are verified by #49 Browser E2E / Accessibility together with #152 Navigation History Policy.
