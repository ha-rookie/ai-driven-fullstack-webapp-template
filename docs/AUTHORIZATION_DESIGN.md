# Authorization Design

## Purpose

Define the technology-specific authorization baseline for this Full-stack Template.

Authentication establishes **who the caller is**. Authorization decides **what an authenticated caller may do within a resource scope**. These responsibilities remain separate.

## Boundary

```text
Authenticated User
        ↓
Scope Membership
        ↓
Role-based Policy
        ↓
Resource Scope Guard
        ↓
Authorization Decision
```

The authorization foundation does not choose product-specific role names or permissions.

## Persistence

`migrations/0003_authorization_foundation.sql` adds:

```text
resource_scopes
  id
  name
  created_at
  updated_at

scope_memberships
  scope_id
  user_id
  role
  created_at
  updated_at
```

A membership is unique per `(scope_id, user_id)`.

`role` is a non-empty string. The database deliberately does not constrain it to names such as `admin`, `member`, or any product-specific vocabulary. Projects define their own role names and policy mapping.

Deleting a user or resource scope cascades its memberships.

## Pure policy

Authorization policy is independent of D1 and HTTP.

A project provides an Action → allowed roles mapping, for example:

```text
resource:read  → reader, editor
resource:write → editor
```

Those names are examples only. They are not built into the authorization core.

`authorizeScopedAction(...)` fails closed when:

- no membership exists
- membership belongs to another scope
- the resource belongs to another scope
- the action has no configured policy
- the membership role is not allowed for the action

Only an explicit matching policy returns `allowed: true`.

## Resource scope guard

Authorization must verify both:

1. the caller has membership for the requested scope
2. the target resource actually belongs to that same scope

This prevents a valid membership in one scope from being reused against a resource owned by another scope.

The baseline passes `requestedScopeId` and `resourceScopeId` separately so that this check cannot disappear inside UI assumptions.

## D1 adapter

`findScopeMembership(...)` is the persistence adapter. It loads only:

```text
scopeId
userId
role
```

It contains no role semantics. The pure policy decides whether that role is sufficient for the requested action.

## HTTP boundary

This Issue does not add a concrete protected CRUD endpoint.

When HTTP integration is added later:

- missing or invalid application session → `401 Unauthorized`
- authenticated caller denied by authorization policy → `403 Forbidden`

The authorization core itself returns structured decisions rather than creating `Response` objects.

## Deliberate exclusions

The baseline does not include:

- system-wide super-admin bypass
- fixed application roles
- dynamic permission tables
- an RBAC administration UI
- ABAC or a policy engine
- invitation flows
- audit events
- product-specific resource types

Those capabilities should be added only when a real application requires them.
