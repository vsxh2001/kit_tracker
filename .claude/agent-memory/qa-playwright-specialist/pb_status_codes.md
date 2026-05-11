---
name: PocketBase v0.22 HTTP Status Codes
description: Actual HTTP status codes returned by PocketBase v0.22 — differ from REST conventions; critical for REST-level security tests
type: project
---

PocketBase v0.22 does NOT follow standard REST HTTP status codes:

| Operation | Result | PB v0.22 Status |
|---|---|---|
| POST (create) | Success | 200 (not 201) |
| POST (create) | createRule violation | 400 (not 403) |
| PATCH (update) | Success | 200 (not 204) |
| PATCH (update) | updateRule violation | 404 (not 403) |
| GET | viewRule/listRule violation | 403 |
| Hook rejection (`BadRequestError`) | Any | 400 |

**Why:** PocketBase treats rule violations as "record not found" for update/delete (404) and "validation failed" for create (400). This is by design in PB v0.22 and differs from v0.23+.

**How to apply:** In any REST-level security test asserting a blocked operation, use 400 for blocked creates and 404 for blocked updates/deletes. Never assert 403 for rule violations in PB v0.22.
