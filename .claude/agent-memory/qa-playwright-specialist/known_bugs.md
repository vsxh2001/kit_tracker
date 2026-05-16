---
name: Confirmed Bugs from Live Session
description: Bugs found during Playwright live sessions (2026-05-09, 2026-05-12, viewer puppet 2026-05-12, tech puppet 2026-05-16)
type: project
---

## BUG-1 — RESOLVED BY DESIGN: No unique constraint on kit serial
Migration `1778880000_kit_serial_not_unique.js` intentionally drops the UNIQUE constraint to allow
re-issuing serials after a kit is retired (soft-deleted). Duplicate active serials are now allowed.
Risk: AI `resolve_kit` returns ambiguous results; kit picker shows two entries. Story B2 in
PUPPET_SHOW_V2 is now outdated — needs rewrite to document the re-issue flow instead.

## BUG-2 — Critical: Fulfill ignores local state, reads DB record
`RequestDetailPage.tsx` line 88: `handleFulfill` checks `request?.designated_kit` and `request?.target_entity`
(DB record), not local `assignKit`/`assignEntity` state. Admin must click "Save assignment" first, then "Fulfill".
The UI layout implies single-step but actually requires two steps. No indication to user.

## BUG-3 — FIXED (2026-05-16): Viewer cannot create requests
`RequestsPage.tsx` now imports `useAuth()` and sets `canCreate = isAdmin || role="user" || role="technician"`.
Viewer (role="viewer") is excluded. Button not rendered for viewers. Confirmed in tech session.

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

## BUG-11 — FIXED (2026-05-16): requests self-approve blocked by hook
`request_field_guard.pb.js` hook now fires `onRecordBeforeUpdateRequest` for requests.
Blocks any non-admin/non-tech from changing `status` field. ONLY exception: owner can cancel
own open request (status=open → cancelled). Self-approve attempt returns 400
"Only admin or technician can change request status."
Confirmed fixed in technician puppet session 2026-05-16.

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

## BUG-U01 — Medium: `denied` role bypasses RequireRole and listRule (found 2026-05-16 user puppet)
`RequireRole.tsx:16` checks `!user?.role` — truthy check, `"denied"` passes.
`Layout.tsx:22` `hasRole = !!user?.role` — `"denied"` is truthy → full nav visible.
PB listRules use `@request.auth.role != ""` — `"denied"` passes.
Fresh login blocked (PB returns 400), but if admin denies mid-session (realtime fires →
authRefresh → role="denied"), user retains full read access and nav with no warning banner.
`DashboardPage.tsx:27` `pendingApproval = !user?.role` → `!"denied"` = false → NO banner shown.
Fix: add `role !== "denied"` checks to RequireRole, hasRole, listRules — or force logout on denied role change.

## BUG-U02 — Low: `getCurrentOnCallUsers` has no sort — non-deterministic sidebar on-call order (found 2026-05-16)
`services/oncall.ts:getCurrentOnCallUsers` calls `getFullList` with no `sort` parameter.
When multiple users are simultaneously on-call, PB returns rows in internal/row-id order.
The sidebar always shows `onCallUsers[0]` — which user appears first is unpredictable.
Fix: add `sort: "-start_at"` (most recently started = current) or `sort: "start_at"` (longest running = primary).
