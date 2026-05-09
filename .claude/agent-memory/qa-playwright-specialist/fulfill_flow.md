---
name: Request Fulfill Flow
description: Two-step fulfill requirement — Save assignment must precede Fulfill button
type: project
---

To fulfill a request, admin must:
1. Select kit in "Assign kit" combobox
2. Select entity in "Target entity" combobox
3. Click "Save assignment" — persists to DB
4. THEN click "Fulfill"

`handleFulfill` reads `request.designated_kit` and `request.target_entity` from the loaded record object,
not from local React state. Skipping "Save assignment" causes "Assign a kit before fulfilling." or
"Request must have designated kit and target entity to fulfill." errors even if dropdowns are set.

**Why:** `fulfillRequest` service creates a transaction using the kit's current holder from DB.
It needs the DB record to be current.

**How to apply:** E2E tests for fulfill must include the Save assignment step before Fulfill.
