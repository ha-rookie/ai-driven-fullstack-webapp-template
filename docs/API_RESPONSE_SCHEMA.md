# Shared API Response Schema

## Purpose

Define a small Worker/React response boundary that can be shared without exposing Domain Entity or Infrastructure types as public API contracts.

The shared module lives under:

```text
src/shared/api/
```

It contains response-envelope DTO types and dependency-free runtime decoders. It does not contain business entities, D1 row shapes, repository types, or Product-specific fields.

## Success envelope

Reference shape:

```json
{
  "data": {},
  "requestId": "request-123",
  "meta": {
    "pagination": {
      "nextCursor": null,
      "limit": 50,
      "hasMore": false
    },
    "concurrency": {
      "version": 7,
      "etag": "\"v7\""
    },
    "extensions": {}
  }
}
```

`data` is always a Project/API-specific DTO. A Domain Entity must be explicitly projected to that DTO before it crosses the HTTP boundary.

`requestId` is part of both success and error contracts so frontend error handling and support flows can correlate responses with server-side evidence.

`meta` is optional.

### Pagination metadata

The shared layer defines only the response shape:

- `nextCursor`
- `limit`
- `hasMore`

Cursor generation, filtering, sort semantics, maximum limits, and stable ordering belong to #122 Collection Query Contract. This Issue does not pre-empt those policies.

### Concurrency metadata

The shared layer provides optional `version` / `etag` fields so API DTOs can expose concurrency information without leaking persistence objects.

Validation and HTTP precondition semantics remain owned by #124 HTTP Concurrency Precondition.

### Project extensions

Project-specific metadata belongs under `meta.extensions`.

Unknown first-class keys inside `meta` are rejected by the shared runtime decoder. This makes accidental schema drift visible while keeping an explicit extension point.

## Error envelope

The existing #63 API Error Mapper contract becomes the shared error DTO:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Validation failed",
    "issues": []
  },
  "requestId": "request-123"
}
```

The Worker implementation imports this shared type; its wire behavior does not change.

Existing endpoints may still add bounded root-level fields through `ApiErrorDescriptor.extra`. The shared error decoder validates and projects only the common `error` and `requestId` fields, preserving backward compatibility without promoting every endpoint-specific field into the common schema.

## Runtime validation boundary

TypeScript types do not validate JSON received at runtime.

Consumers must treat parsed JSON as `unknown` and use a decoder before relying on it:

```ts
const envelope = decodeApiSuccessEnvelope(payload, decodeProjectDto);
if (!envelope) {
  // protocol/schema failure
}
```

The data decoder is supplied by the caller because Product DTO semantics do not belong in the Template core.

The shared decoder validates:

- bounded non-empty request ID
- common error code/message/issues structure
- pagination shape
- concurrency shape
- explicit metadata extension boundary
- caller-defined success DTO decoder result

Malformed common fields fail closed by returning `null`.

## DTO separation

Do not export these objects directly as response DTOs:

- Domain Entities
- D1 result/row objects
- repository records
- authorization/session persistence objects
- provider-specific SDK payloads

Instead map them into small API DTOs containing only values the client contract needs.

This prevents a persistence change from silently becoming a public API change and keeps internal fields from being exposed accidentally.

## No code generation requirement

This baseline deliberately does not require OpenAPI code generation or a schema library.

Projects may add those tools later, but Worker and React can already share:

- DTO envelope types
- runtime envelope decoders
- common metadata types

without adding a dependency.

## Relationship to later Frontend work

#128 Frontend API Client Wrapper should parse JSON as `unknown` and use these decoders before returning typed values to React.

#126 Frontend Auth Context can provide its own `/api/auth/me` DTO decoder and receive a validated shared envelope.

#129 Frontend Error Presentation can consume the shared `ApiErrorEnvelope` rather than reinterpreting arbitrary backend response bodies.

## Out of scope

This contract does not implement:

- Product-specific DTO definitions
- request-body schemas
- query parsing / cursor generation (#122)
- API versioning policy (#123)
- OpenAPI/client generation
- GraphQL
- backend Authorization
