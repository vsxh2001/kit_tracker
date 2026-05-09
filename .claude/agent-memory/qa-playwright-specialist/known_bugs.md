---
name: Confirmed Bugs from Live Session
description: Bugs found during Playwright live session on 2026-05-09
type: project
---

## BUG-1 — Critical: No unique constraint on kit serial
`pb/setup_collections.sh` creates `serial` field with `required:true` but no `unique:true`.
Frontend has no duplicate-check either. Duplicate serials can be created silently.
Result: two KIT-001 records in DB after testing. Corrupts kit picker dropdowns.

## BUG-2 — Critical: Fulfill ignores local state, reads DB record
`RequestDetailPage.tsx` line 88: `handleFulfill` checks `request?.designated_kit` and `request?.target_entity`
(DB record), not local `assignKit`/`assignEntity` state. Admin must click "Save assignment" first, then "Fulfill".
The UI layout implies single-step but actually requires two steps. No indication to user.

## BUG-3 — Medium: Viewer can open "New request" dialog
`RequestsPage.tsx` has no `useAuth()` import and no role check on the "New request" button.
Button visible and functional for viewer role. PocketBase collection rules may block actual create
but frontend gives no indication — and the create rule may allow any authenticated user.

## BUG-4 — Medium: Requester name shows "—" for non-admin users
`requests` service expands `requester` relation but PocketBase users collection default viewRule
only allows users to view their own record. Non-admin users can't expand other users' records.
Affects both requests list and request detail pages.

## CONSOLE WARNINGS (non-blocking)
All Radix `DialogContent` instances missing `aria-describedby` — accessibility issue.
8 warnings across all dialogs: New Kit, Edit Entity, Move Kit, New Request, Edit Request.
Fix: add `<DialogDescription>` or pass `aria-describedby={undefined}` explicitly.
