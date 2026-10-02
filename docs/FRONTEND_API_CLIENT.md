# Frontend API Client Wrapper

## Purpose

Centralize browser-to-Worker HTTP behavior so React components do not repeatedly reimplement fetch, JSON parsing, request IDs, standard error decoding, timeout handling, credentials, and CSRF proof injection.

The reference client lives under:

```text
src/frontend/api/
```

It is endpoint-neutral. Product-specific methods belong outside this core wrapper.

## Same-origin boundary

The client accepts only application paths beginning with a single `/`.

It rejects absolute URLs and protocol-relative URLs. Requests use:

```text
credentials: same-origin
```

This prevents the generic client from becoming an arbitrary credential-forwarding HTTP client.

## Shared response schema

Successful JSON requests use the #125 shared envelope and a caller-supplied DTO decoder:

```ts
const result = await api.request("/api/resources", decodeResourceDto);
```

The response body is treated as `unknown` until both the common envelope and Product DTO decoder accept it.

A TypeScript cast is not runtime validation.

## HTTP failures

Non-2xx responses never return as successful data.

When the server returns the standard shared error envelope, `ApiClientError` exposes only its common public fields:

- `kind = "http"`
- HTTP `status`
- `requestId`
- decoded `apiError`

Endpoint-specific or internal response fields are not copied into the client error object.

If an error body is malformed or non-JSON, the client falls back to a bounded generic message and may retain only the safe `x-request-id` response header.

Raw stack traces or arbitrary server response bodies are not propagated to UI code.

## Error kinds

`ApiClientError.kind` distinguishes:

- `http`: an HTTP response with non-success status
- `protocol`: response content/type/schema does not match the expected API contract
- `network`: fetch failed without a caller abort or configured timeout
- `timeout`: the configured request deadline elapsed
- `aborted`: the caller explicitly aborted the request

This separation is important for later runtime re-authentication work. A 401 HTTP result is not the same state as a network failure or timeout.

## Request IDs

For standard error envelopes, the envelope request ID is preferred.

For malformed/non-standard responses and 204 results, a bounded `x-request-id` header may be retained.

The wrapper does not generate a replacement request ID when the server did not provide one.

## JSON behavior

For requests with a body, the wrapper serializes JSON and sets:

```text
Content-Type: application/json; charset=utf-8
```

unless the caller supplied a content type explicitly.

It sends `Accept: application/json` by default.

Successful envelope requests require a JSON media type. Non-JSON success is a protocol failure, not valid typed data.

JSON response text is bounded before parsing. The default limit is 1,048,576 characters and can be replaced per client instance.

## 204 / no content

No-content operations use the explicit `requestNoContent()` path.

A 204 returned to a normal typed JSON request is a protocol mismatch. Conversely, a JSON response returned to `requestNoContent()` is not silently accepted.

## Timeout and abort

Each request receives a bounded timeout. The default is 15 seconds and is configurable.

The client combines its timeout controller with an optional caller `AbortSignal`, but reports them differently:

- deadline elapsed → `timeout`
- caller signal aborted → `aborted`

Failed mutations are not automatically retried.

That boundary is deliberate: #154 Runtime Re-authentication Recovery and #130 Frontend Mutation Safety must let the user decide when a failed write is safe to retry.

## CSRF proof

A Project may inject a `getCsrfToken()` callback when composing the client.

For methods other than GET/HEAD/OPTIONS, the wrapper adds `x-csrf-token` when a token is available and the caller has not already supplied the header.

The wrapper does not obtain credentials itself and does not persist CSRF/session values in localStorage or other frontend storage.

Server-side #89 CSRF validation remains the security boundary.

## Security and responsibility boundaries

The client does not:

- store raw auth/session tokens
- implement Authentication or Authorization
- replay failed writes automatically
- decide whether a 401 should open a login UI
- cache business responses
- hide HTTP failures as success values
- expose raw backend stack/internal details
- call arbitrary external origins

## Relationship to upcoming Frontend work

#126 Frontend Auth Context can use the client and distinguish HTTP 401 from bootstrap/protocol/network errors.

#129 Frontend Error Presentation can translate `ApiClientError` and the shared public error envelope into user-facing view models.

#130 Frontend Mutation Safety can hold pending/failed state while this client guarantees there is no implicit retry.

#154 Runtime Re-authentication Recovery can intercept runtime HTTP 401 without conflating it with timeout/network errors and without automatically replaying the failed mutation.
