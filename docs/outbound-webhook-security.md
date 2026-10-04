# Outbound Webhook Security / Delivery Adapter Hardening

Issue: #304 Stage 3

## Purpose

Keep external webhook delivery provider-neutral while preventing a project-configured destination from becoming an unrestricted server-side HTTP client.

```text
Outbox
  -> Destination Registry
  -> URL policy
  -> DNS resolution
  -> all resolved-address validation
  -> optional Signer
  -> pinned Transport (manual redirect)
  -> response classification
```

## Inputs

- environment
- destinationKey from Outbox
- versioned Integration Event
- injected Destination Registry
- injected Address Resolver
- injected Transport
- optional injected Signer
- optional exact-host allowlist

## Stop Conditions

Reject delivery when:

- destination is missing, disabled, or does not match the requested key
- URL is not HTTPS
- URL contains username/password userinfo
- URL uses a non-standard port in the baseline policy
- hostname is malformed or localhost
- host is outside the configured exact-host allowlist
- DNS resolution fails or produces no address
- any resolved address is loopback, private, link-local, shared/special, multicast/reserved, or otherwise not accepted as public
- redirect changes the target to a destination that fails the same policy

## DNS Rebinding Boundary

Checking DNS before calling an ordinary HTTP client is not sufficient if that client performs a second independent DNS lookup.

`WebhookTransport.post()` therefore receives `resolvedAddresses` that have already passed policy. A concrete transport must connect only to one of those validated addresses while preserving the original HTTPS hostname for TLS/SNI and certificate verification.

Do not implement the transport by discarding `resolvedAddresses` and calling an unrestricted `fetch(url)` if the runtime cannot guarantee equivalent address pinning.

## Redirect Policy

- transport is always invoked with `redirect: "manual"`
- 307 / 308 may be followed because the POST method/body semantics are retained
- every redirect hop is reparsed, re-allowlisted, re-resolved, and revalidated
- redirects are bounded
- 301 / 302 / 303 are not automatically followed by the baseline adapter

This avoids silent method changes and prevents a public endpoint from redirecting delivery to a private target.

## Signing Boundary

Webhook signing is injected through `WebhookSigner`.

The Core supplies only bounded signing inputs:

- destination key
- event id
- timestamp
- serialized body bytes

The Core does not invent a cryptographic construction and does not own raw signing keys. Projects/providers should use a standard scheme appropriate to the external contract and keep key lookup/rotation behind the signer adapter.

## Response Classification

Baseline:

- 2xx -> delivered
- 408 / 425 / 429 -> retryable
- 5xx -> retryable
- other statuses -> permanent failure
- missing/invalid redirect metadata -> permanent failure

Retry scheduling / lease / max attempts remain owned by #51 Async Job and the existing Outbox relay. This adapter does not become a second retry engine.

## Security Notes

- Destination Registry is mandatory; arbitrary request URLs are not accepted by the delivery method
- exact-host allowlist is available as an additional project policy
- do not put credentials in endpoint userinfo
- do not log signing keys, Authorization headers, secret URLs, or full sensitive provider responses
- provider request ids may be retained only as bounded diagnostics through the existing delivery result contract
- destination management authorization/UI is separate from this Foundation

## Validation

Tests prove:

- HTTP/userinfo/nonstandard-port/allowlist rejection
- private, loopback, link-local and mixed DNS answer rejection
- validated addresses are forwarded to Transport for connection pinning
- redirect target policy is re-evaluated
- POST-changing redirects are not silently followed
- retryable/permanent response classification
- signer receives bounded inputs without key material entering the Core

## Do Not

- do not expose a generic `POST arbitrary URL` API from Template Core
- do not rely only on hostname string checks for SSRF prevention
- do not validate one DNS answer and ignore additional answers
- do not auto-follow redirects in the underlying HTTP client
- do not implement custom cryptography in Core
- do not register real Production endpoint/secret resources without Human Gate
