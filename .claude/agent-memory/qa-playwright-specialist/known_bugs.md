---
name: Confirmed Bugs from Live Session
description: Bugs found during Playwright live sessions (2026-05-09, 2026-05-12, viewer puppet 2026-05-12)
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
NOTE (2026-05-12): CLAUDE.md says `users.viewRule` is `@request.auth.id != ""` — may be fixed.
Verify in current codebase before filing as new bug.

## BUG-5 — Medium: RequireRole doesn't check auth loading state
`RequireRole.tsx` checks `!user?.role` without checking `loading`. During HMR remount,
if `user` is transiently null, redirects to `/dashboard`. Contrast: `ProtectedRoute`
correctly returns null while loading=true. Causes unexpected redirects during Vite
Fast Refresh cycles. Observable: navigating to /requests then snapshotting causes
redirect to /dashboard.

## BUG-6 — Low: Admin cannot "Cancel" their own open request
`RequestDetailPage` line 303: `isOwner && !canDecideRequests && status === "open"` shows Cancel.
Since admin has `canDecideRequests=true`, this condition is never true for admins.
Admin can only Delete. If admin creates a request as requester, they cannot cancel it via UI —
only delete. The intended UX for admin may be different but this is inconsistent.

## BUG-8 — UX: AdminOnly redirects to "/" not "/dashboard" directly
`App.tsx` line 30: `AdminOnly` returns `<Navigate to="/" replace />`. The "/" route then hits
`<Route index element={<Navigate to="/dashboard" replace />}`. Net result = /dashboard but via
two redirects. Could cause flash or race condition if future routes are added at "/".
More accurate to redirect directly to "/dashboard".

## BUG-7 — Environment: Shared browser localStorage causes session thrashing in concurrent test runs
MCP Playwright browser uses a persistent Chrome profile (`--user-data-dir` shared across sessions).
When multiple agents/test suites run concurrently against the same Vite dev server, they overwrite
each other's `pocketbase_auth` localStorage key. Every snapshot/screenshot triggers HMR which
causes React remount + localStorage re-read, picking up the latest stored token.
Mitigation: use storageState per test or inject token via page.evaluate() before each test.

## BUG-9 — Environment: API-created kits default is_active=false — hidden from UI
When creating kits via PocketBase REST API, the `is_active` field defaults to `false`.
These kits do NOT appear in the Kits list page (UI filters `is_active=true` kits).
Must PATCH `is_active: true` immediately after create to make them visible.
This caused confusion during puppet testing: kit created but "not found" in UI.
Not a bug per se — correct behavior — but a sharp edge for test data seeding.

## BUG-10 — Medium: qrcode.react package was missing from node_modules
`KitQR.tsx` imports `QRCodeSVG` from `qrcode.react` but the package was not installed.
Caused 500 Vite overlay error blocking all pages that render kit detail cards.
Fixed: `npm install qrcode.react` in `frontend/` + force Vite restart.
The feature was added to the codebase without updating package.json/node_modules.

## BUG-11 — CRITICAL SECURITY: requests.updateRule allows owner to self-approve (2026-05-12)
Confirmed via API probe during viewer puppet session.
`requests.updateRule`: `@request.auth.role = "admin" || @request.auth.role = "technician" || (@request.auth.id = requester && status = "open")`
The owner condition has no field restriction. A user (role="user") can PATCH their own open
request with `{"status": "approved", "decision_notes": "anything"}` — bypassing approval workflow.
HTTP 200 confirmed. The owner can also self-assign `designated_kit` or `target_entity` before
the window closes. Status becomes "approved" which locks out further owner updates (404 after).
Mitigation needed: restrict owner updates to non-status fields only, or remove owner update
entirely (force admin/technician to manage lifecycle). Field-level access rules require hooks
or separate API since PocketBase updateRule applies at row level.
Demo proof: requests qos0kd05hr5s1ni, a8uayczvv4cvfpt (both deleted by admin after test).

## BUG-12 — Medium: /stats route uses RequireRole but page uses canDecideRequests gate (double-gating)
`App.tsx` wraps /stats in `RequireRole` (any non-empty role). But `StatsPage.tsx` line 54
checks `canDecideRequests` and redirects if false. Net result is correct (only admin/technician
can view stats) but route wrapper and page-level gate are inconsistent.
The outer `RequireRole` is misleading — implies any user can access, but page itself blocks.
Should align: either use `CanDecideOnly` in App.tsx routing for /stats, or remove page-level check.

## CONSOLE WARNINGS (non-blocking)
All Radix `DialogContent` instances missing `aria-describedby` — accessibility issue.
8 warnings across all dialogs: New Kit, Edit Entity, Move Kit, New Request, Edit Request.
Fix: add `<DialogDescription>` or pass `aria-describedby={undefined}` explicitly.
