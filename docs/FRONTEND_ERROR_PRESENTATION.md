# Frontend Error Presentation

## Purpose

Frontend error handling converts transport/API failures into a bounded presentation model before rendering them. Backend messages, stack details, response bodies, and implementation-specific diagnostics are not displayed directly.

## Classification

`toErrorViewModel()` keeps important failure classes distinct:

- validation
- authentication required (401)
- forbidden (403)
- not found (404)
- conflict/stale data (409)
- rate limited (429)
- service unavailable (5xx)
- network failure
- timeout
- protocol/schema failure
- caller-aborted request
- unknown failure

This prevents session expiry from being confused with authorization failure and prevents optimistic-concurrency conflict from being flattened into a generic server error.

## Recovery contract

The view model exposes a recovery hint rather than automatically retrying:

- `reauthenticate`: authentication must be restored
- `refresh`: fetch current state before another mutation
- `retry`: a user-triggered retry may be appropriate
- `correct_input`: validation fields need correction
- `none`: no generic recovery action is recommended

Mutation replay is never automatic. Runtime re-authentication behavior is handled separately by #154.

## Field validation

Validation issues are reduced to bounded `path` and `code` data. Backend issue messages are not promoted to user-visible strings by default. Unsafe or malformed field paths are dropped.

Project-specific copy can be supplied through `ErrorCopyResolver` without changing classification/recovery semantics.

## Request IDs

A bounded request ID may be shown to users to support incident/helpdesk correlation. It is treated as correlation metadata, not as authorization or secret material.

## React presentation adapter

`ErrorPresentation` is a minimal semantic renderer with `inline`, `page`, and `toast` variants. It uses `role="alert"`, exposes safe request ID and field messages, and accepts explicit callbacks for retry/refresh/re-authentication.

The component intentionally does not:

- show backend error strings verbatim
- make HTTP requests
- retry mutations automatically
- decide authentication or authorization
- choose a toast/page UI library
- act as a React Error Boundary

Render/runtime exceptions remain #131.
