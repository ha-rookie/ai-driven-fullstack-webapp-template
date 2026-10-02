# Frontend Auth Context

## Purpose

`AuthProvider` bootstraps `/api/auth/me` and exposes one application-wide authentication snapshot without copying the session cookie or any raw credential into React state.

The server remains the authentication source of truth. The frontend context is a presentation/runtime coordination layer only.

## State contract

The public state is deliberately small:

- `loading`: initial authentication bootstrap has not converged yet
- `authenticated`: a bounded public user identity is available
- `unauthenticated`: `/api/auth/me` returned HTTP 401
- `error`: authentication state could not be determined because of network, dependency, protocol, or unexpected HTTP failure
- `syncing`: a background re-check is running while the last stable state remains visible

Only `id` and `displayName` are retained for the current user. Cookie/session material is never copied into React state.

## Stable bootstrap behavior

The initial provider mount calls `bootstrap()` once. Concurrent calls collapse onto the same in-flight request.

After an initial stable state exists, `synchronize()` does not switch the UI back to `loading`. It keeps the previous authenticated/unauthenticated state and sets `syncing: true` until the new result converges. This is the reference behavior for login callback completion and later session re-checks, so internal `checking -> authenticated` transitions do not need to become separate visible screens.

`resetAfterLogout()` immediately clears the frontend user snapshot after a successful server logout. It does not revoke the server session itself; the logout endpoint remains responsible for that mutation.

## `/api/auth/me` adapter

The endpoint currently returns the established wire contract:

```json
{
  "authenticated": true,
  "user": {
    "id": "user-id",
    "displayName": "Display name"
  }
}
```

HTTP 401 means `unauthenticated`. Other failures are not converted to unauthenticated because doing so would misrepresent an infrastructure or protocol failure as a logged-out state.

The loader uses a same-origin GET with browser-managed credentials. It does not read, expose, duplicate, or persist the cookie value.

## Integration

`src/main.tsx` wraps the application in `AuthProvider`, making `useAuth()` available to later frontend foundation issues.

Expected follow-up consumers include:

- Protected Route Guard (#127)
- Frontend Error Presentation (#129)
- Runtime Re-authentication Recovery (#154)
- Frontend Permission Guard (#77)
- Browser E2E / Accessibility (#49)

## Responsibility boundary

This context does not provide authorization, route protection, provider-specific login UI, automatic mutation replay, or persistent credential storage. Server-side authentication and authorization remain authoritative.
