# Protected Route Guard

## Purpose

`ProtectedRoute` is a router-neutral frontend boundary built on `#126 Frontend Auth Context`. It prevents protected content from rendering while authentication is unresolved or unauthenticated, without pretending to replace server-side authorization.

## Decision contract

The guard maps Auth Context state into four explicit outcomes:

- `pending`: initial auth bootstrap is still unresolved
- `authenticated`: protected content may render
- `unauthenticated`: provide a validated login navigation intent
- `error`: authentication state could not be determined; this is not treated as logout

Permission/forbidden handling is intentionally separate. A user may be authenticated and still receive 403 from the server; that belongs to Authorization / Error Presentation, not this guard.

## Login navigation intent

The guard does not mutate `window.location` or depend on a particular router. Instead, `renderUnauthenticated` receives:

```ts
{
  loginPath: "/login",
  returnTo: "/orders/42?tab=history",
  href: "/login?returnTo=%2Forders%2F42%3Ftab%3Dhistory"
}
```

A router adapter, link, or login page may consume that intent.

Safety rules:

- `loginPath` must be a same-origin absolute path beginning with one slash
- external URLs, scheme-relative paths, backslash-based authority confusion, and control characters are rejected
- login configuration must not contain its own query/fragment state
- an unsafe `currentPath` is discarded rather than copied into `returnTo`
- when the current path is the login page itself, `returnTo` is omitted to avoid redirect loops

The final post-login destination must still be validated by the consuming router/application. Browser History is not an authentication source of truth.

## React wrapper

`ProtectedRoute` accepts:

- `children`: authenticated protected content
- `pending`: stable bootstrap placeholder
- `renderUnauthenticated(intent)`: application/router-specific login navigation UI
- `renderError(requestId?)`: authentication bootstrap failure UI

It deliberately performs no automatic redirect side effect. This keeps navigation policy outside the authentication guard and avoids duplicate redirects under React Strict Mode or repeated renders.

## Responsibility boundary

The guard does not:

- authorize roles or permissions
- interpret HTTP 403 as unauthenticated
- implement a login provider
- persist redirect state in local storage
- replay failed mutations after login
- choose a routing library

Server-side Authentication and Authorization remain authoritative.

## Follow-up

Browser Back/Forward and deep-link behavior are verified later by #152 and #49. Permission-specific UI is handled by #77. Runtime session expiry recovery without losing drafts is handled by #154.
