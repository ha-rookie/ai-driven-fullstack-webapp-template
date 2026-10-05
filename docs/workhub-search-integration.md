# WORKHUB Search Integration

Tracking: #378 / parent #305

## Request path

```text
Authenticated browser
  -> GET /api/workhub/search?q=...
  -> server-side Application Session principal
  -> D1 Search Provider candidate discovery
  -> current WORKHUB resource authorization
  -> current resource hydration
  -> SearchResult response
```

The browser cannot supply a principal override. Search index membership is never sufficient authorization.

## Reference resources

Stage 3 proves at least two resource types through the same Search Application Service:

- `travel_request`: hydrated from current TravelRequest state and authorized for the requester or current approver
- `app`: Reference Application navigation resource available to authenticated WORKHUB users

Index title/text are candidate-discovery data. Final presentation is generated only after current authorization and hydration.

## Browser evidence

Playwright must prove:

- Aoi can find her permitted TravelRequest and the shared app resource
- Ren can find a TravelRequest only while current approval access permits it
- a candidate that exists in the index but is not currently authorized is absent from both API response and DOM
- malformed cursor/query is rejected rather than weakened
- Production / Remote resources are not changed
