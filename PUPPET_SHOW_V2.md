# Puppet Show v2 — user stories + stress matrix

Status: READY-TO-PLAY · 2026-05-15

## How to use
- Each story has: persona, preconditions, steps, expected outcome, what counts as a bug.
- Playwright agents execute against local PB on :8090 with demo data seeded (`scripts/seed_demo_data.mjs`).
- Bugs go in `PUPPET_SHOW_V2_FINDINGS.md` (one row per failure; reference story id e.g. `C3`).
- All demo passwords are `Pass1234!`. Personas are seeded by `scripts/seed_demo_data.mjs:130-168`.
- Routes are declared in `frontend/src/App.tsx:51-81`. Role gates: `RequireRole` (any non-empty role), `AdminOnly` (admin), `CanDecideOnly` (admin OR technician).

## Pre-existing bugs / gaps surfaced while drafting (do NOT write a story; raise as known-broken)

| # | Where | What | Source |
|---|-------|------|--------|
| K5 | Components page bulk vs serial UX | One dialog conditionally toggles fields rather than two distinct paths. Easy to mis-fill. | `COMPONENT_HYPERCHARGE_IDEAS.md` §4.9 |
| K6 | Mobile schedule creation | Kit detail page is long; mobile requires deep scroll to find "Add schedule" (workaround: use the `/maintenance` page's "New schedule" CTA instead). | `MAINTENANCE_REVIEW.md` finding 10 |

> Stories below assume these gaps remain. Where a story would be "pre-doomed," it is omitted and the gap above is referenced.

---

## Story groups

### A. Onboarding & auth

#### A1: Pending user lands with awaiting-approval banner @smoke
**Persona:** new sign-up (create a fresh user via PB REST with empty role; no admin promotion)
**Preconditions:** Demo data seeded. New user `puppet-pending@kit.local` created with empty `role`.
**Steps:**
1. Navigate to `/login`.
2. Sign in as `puppet-pending@kit.local` / `Pass1234!`.
3. Land on `/dashboard`.
**Expected:** Amber banner visible (text contains "approval" or matches `DashboardPage.tsx:77`). Sidebar nav shows only Dashboard + Profile (no kits/entities/requests links — gated by `RequireRole`).
**Bug if:** Banner missing, kit/entity nav visible, or page errors. Also bug if `Layout.tsx:262` "On call" widget renders for pending user (`hasRole` should be false).
**Stress angle:** While pending user is on `/dashboard`, admin grants `role=user`. After ≤60s (Layout interval) or page reload, banner must disappear and nav fills in.

#### A2: Denied user sees a clear denial message at login @smoke
**Persona:** new user with `role=denied` + `denial_notes` set
**Preconditions:** Create user `puppet-denied@kit.local`, role `denied`, denial_notes "Account closed".
**Steps:**
1. Navigate to `/login`.
2. Enter credentials, submit.
**Expected:** Login form shows "Your account has been denied. Contact administrator." (`LoginPage.tsx:46`). No auth token persists; reloading `/dashboard` redirects to `/login`.
**Bug if:** Error message is generic ("invalid credentials") or login succeeds.

#### A3: Admin creates a user with role pre-assigned (no banner)
**Persona:** demo-admin-1
**Preconditions:** Logged in as admin; `/users` accessible.
**Steps:**
1. Navigate to `/users`.
2. Click "Add user" (or equivalent).
3. Fill email `puppet-tech-3@kit.local`, name "Puppet Tech 3", role `technician`, password `Pass1234!`.
4. Submit.
**Expected:** New row appears with role chip "technician." A subsequent login as that user lands on `/dashboard` with NO awaiting-approval banner.
**Bug if:** User created with empty role despite admin selecting one; audit log row missing for the create.

#### A4: Last-admin demotion is rejected
**Persona:** demo-admin-1 (only admin)
**Preconditions:** Seed creates exactly one admin (`demo-admin-1`). Confirm via `/users` list filter.
**Steps:**
1. As demo-admin-1, navigate to `/users`.
2. Edit own row → change role from `admin` to `user`.
3. Save.
**Expected:** PocketBase rejects with `BadRequestError` ("cannot demote last admin", per `last_admin_check.pb.js`). UI surfaces a toast/error; row remains admin.
**Bug if:** Demotion succeeds, or UI shows success toast while DB rejects (state mismatch).

#### A5: Admin signup notification audit-row check (proxy for email)
**Persona:** demo-admin-1
**Preconditions:** SMTP not configured locally; `user_signup_notify.pb.js` still runs.
**Steps:**
1. Create new user via `/login → Sign up` (if UI exists) or via PB REST `/api/collections/users/records` with empty role.
2. As demo-admin-1, navigate to `/audit` (CanDecideOnly).
**Expected:** An audit row exists for `users` create. (Email itself can't be verified without MailHog — see hook `user_signup_notify.pb.js:6`.) PB server log shows hook fired.
**Bug if:** No audit row for user create; hook throws and breaks the HTTP response from POST users.

---

### B. Kit lifecycle

#### B1: Admin creates a new kit @smoke
**Persona:** demo-admin-1
**Preconditions:** Logged in as admin.
**Steps:**
1. Navigate to `/kits`.
2. Click "New kit" header button.
3. Fill serial `PUPPET-KIT-001`, notes "Demo kit", tags "laptop,ssd".
4. Submit.
**Expected:** New row visible in kit table. Detail page reachable via row click. `is_active=true` (defensive default in `services/kits.ts:createKit`). Audit log row for `kits` create with the actor = demo-admin-1.
**Bug if:** Kit invisible after create (is_active=false would mean PB defaults overrode), audit row missing, or serial uniqueness not enforced (try creating a second with same serial — see B2).

#### B2: Duplicate serial rejected
**Persona:** demo-admin-1
**Preconditions:** B1 succeeded.
**Steps:**
1. Navigate to `/kits`. Click "New kit".
2. Enter serial `PUPPET-KIT-001` (already exists).
3. Submit.
**Expected:** Dialog shows error referencing unique constraint; no new row created.
**Bug if:** Dialog closes silently, or PB returns success despite collision.

#### B3: Technician moves a kit between entities @smoke
**Persona:** demo-technician-1
**Preconditions:** Kit `DEMO-KIT-01` exists with a current holder (latest transaction → `DEMO-Entity-XX`).
**Steps:**
1. Navigate to `/kits`.
2. Open `DEMO-KIT-01` detail.
3. Click "Move kit" → choose target `DEMO-Entity-04` → notes "Puppet B3 move".
4. Submit.
**Expected:** Kit detail page header refreshes: current holder = `DEMO-Entity-04`. New transaction row in timeline. Old entity's `/entities/<id>` no longer lists this kit; new entity's detail does.
**Bug if:** Holder doesn't update on the page (cache issue), entity detail counts mismatch, or transaction row appears with `created_by != demo-technician-1` (`transactions.createRule` requires owner-as-creator).

#### B4: User (non-technician) cannot move a kit
**Persona:** demo-user-1
**Preconditions:** Logged in.
**Steps:**
1. Navigate to `/kits/<id>` for any kit.
**Expected:** "Move kit" button is not rendered (`canTransferKits` is false — `AuthContext.tsx:70`). If user manually POSTs to `/api/collections/transactions/records`, PB rejects (createRule fail).
**Bug if:** Button rendered, or REST call succeeds without admin/technician role.

#### B5: Correcting a wrong move via a reverse transaction
**Persona:** demo-technician-2
**Preconditions:** B3 left kit at `DEMO-Entity-04` (wrong destination).
**Steps:**
1. Open `DEMO-KIT-01`.
2. Click "Move kit" → target `DEMO-Entity-02` (correct) → notes "Correction of B3".
3. Submit.
**Expected:** Two transactions in timeline (the bad one then the correction). Current holder = `DEMO-Entity-02`. Original transaction is NOT edited or deleted (append-only).
**Bug if:** Original transaction is overwritten or vanishes from the timeline.

#### B6: Soft-deleting (deactivating) a kit hides it from default lists
**Persona:** demo-admin-1
**Preconditions:** Kit `PUPPET-KIT-001` exists, `is_active=true`.
**Steps:**
1. Navigate to `/kits/<PUPPET-KIT-001 id>`.
2. Click "Deactivate" (or equivalent).
3. Return to `/kits` (default view).
**Expected:** Kit no longer in default list. Toggling "Show inactive" filter brings it back. Audit row recorded.
**Bug if:** Hard-delete occurred (PB has `deleteRule: null` for kits — should be impossible), or kit still in default list after deactivation.

---

### C. Request flow + notifications

#### C1: User files a kit request @smoke
**Persona:** demo-user-1
**Preconditions:** Logged in as user.
**Steps:**
1. Navigate to `/requests`.
2. Click "New request".
3. Pick `designated_kit = DEMO-KIT-15`, `target_entity = DEMO-Entity-01`, `delivery_date = today + 7d`, notes "Need for field op".
4. Submit.
**Expected:** Row appears in `/requests` with status `open`. Audit log row for `requests` create. PB hook `request_created_notify.pb.js` fired (verify by PB server log or audit row presence — SMTP not asserted).
**Bug if:** `delivery_date` accepts empty value (it is required, per CLAUDE.md collection table), request created without requester defaulting to current user, or notify hook throws.

#### C2: Admin approves a request
**Persona:** demo-admin-1
**Preconditions:** C1 left an `open` request.
**Steps:**
1. Navigate to `/requests` (or `/requests/<id>`).
2. Click "Approve" (or status change) → decision_notes "Approved for B-team".
3. Submit.
**Expected:** Status flips to `approved`. Decision notes saved. Request remains visible to original requester.
**Bug if:** A non-admin/non-technician could trigger Approve (only `canDecideRequests` should see the action), or status flips without decision_notes when required.

#### C3: Admin fulfills request → kit auto-moves to target_entity
**Persona:** demo-admin-1
**Preconditions:** C2 left request in `approved` state with `designated_kit` and `target_entity` set.
**Steps:**
1. Open request detail.
2. Click "Fulfill".
3. Confirm.
**Expected:** Status flips to `fulfilled`. A new transaction is created atomically (`fulfillRequest` in `services/requests.ts:63`) linking the kit to `target_entity`. Kit detail page now shows that entity as current holder. The `transaction.request` field references this request.
**Bug if:** Status flips but no transaction created (atomicity broken), or transaction created without `request` link.

#### C4: Requester cancels their own open request
**Persona:** demo-user-1
**Preconditions:** New `open` request owned by demo-user-1.
**Steps:**
1. Navigate to `/requests/<id>`.
2. Click "Cancel".
**Expected:** Status flips to `cancelled`. Audit row added.
**Bug if:** Non-owner could click Cancel, or cancel succeeded on `approved` status (rule: owner-can-cancel only when `status=open`).

#### C5: Requester CANNOT edit/cancel a non-open request
**Persona:** demo-user-2
**Preconditions:** A request owned by demo-user-2 in `approved` status (rare in seed; promote one or create + approve as admin first).
**Steps:**
1. Navigate to `/requests/<id>`.
**Expected:** "Cancel"/"Edit" actions are NOT rendered for the requester (per updateRule `admin OR (owner AND status=open)`).
**Bug if:** Edit action rendered and the PATCH fails 4xx (UI/PB mismatch), or edit succeeds (rule misconfigured).

#### C6: Overdue return reminder fires for fulfilled-past-expected-return @stress
**Persona:** demo-admin-1
**Preconditions:** A fulfilled request where `expected_return` < today.
**Steps:**
1. Manually POST to the overdue cron test route if exposed (or set system clock; both are heavy — easier: directly query `/api/collections/audit_logs` to confirm cron fired). Otherwise verify hook code path manually: `overdue_return_reminder.pb.js:22`.
**Expected:** Audit log entry for the reminder action OR an admin-visible toast/banner.
**Bug if:** Hook throws; or "overdue" badge missing on `/requests` row when `expected_return < today` and `status=fulfilled`.

---

### D. Components + products (heavy on the new required-FK flow)

> Per `services/components.ts` + `AddComponentDialog.tsx:101`, **product is now required** for every component.

#### D1: Admin creates a Product from /products @smoke
**Persona:** demo-admin-1
**Preconditions:** None.
**Steps:**
1. Navigate to `/products`.
2. Click "New product".
3. Fill name "Puppet Battery Pack", category "Battery", manufacturer "Acme", model "AB-9000", description "Demo battery", specs `{"voltage":"12V"}`.
4. Submit.
**Expected:** Row in products table. Detail page accessible. Audit log row exists.
**Bug if:** specs accepted as malformed JSON without warning; product created with empty name.

#### D2: Admin creates a serialized Component bound to a Product
**Persona:** demo-admin-1
**Preconditions:** D1 succeeded; product "Puppet Battery Pack" exists.
**Steps:**
1. Navigate to `/components`.
2. Click "New component".
3. Pick product = "Puppet Battery Pack". Fill serial `PUPPET-COMP-001`, notes "Initial unit".
4. Submit.
**Expected:** Row visible with product name + serial. Component detail shows the product link.
**Bug if:** Submit succeeds with product unselected (FK guard `AddComponentDialog.tsx:101` not enforced).

#### D3: Admin creates a bulk Component (no serial, quantity > 1)
**Persona:** demo-admin-1
**Preconditions:** D1 succeeded.
**Steps:**
1. Navigate to `/components` → New component.
2. Pick product "Puppet Battery Pack". Toggle "Bulk". Quantity 25. Serial left blank.
3. Submit.
**Expected:** Row created with `is_bulk=true`, `quantity=25`, blank serial. Components list distinguishes bulk vs serialized visually.
**Bug if:** Serial uniqueness check trips on empty serial (multiple bulk components with empty serial must coexist); or quantity accepts 0/negative.

#### D4: Component creation without a product is rejected (FK enforcement)
**Persona:** demo-admin-1
**Preconditions:** Logged in.
**Steps:**
1. Navigate to `/components` → New component.
2. Leave product unselected; fill serial `PUPPET-COMP-NOPROD`.
3. Submit.
**Expected:** Inline error "Product is required" (`ComponentsPage.tsx:101` or `AddComponentDialog.tsx`). Submit button disabled or click no-ops.
**Bug if:** Component created with `product=""` (would corrupt the catalog invariant).

#### D5: Move a serialized Component between kits
**Persona:** demo-technician-1
**Preconditions:** D2 succeeded; component `PUPPET-COMP-001` currently at `DEMO-Entity-XX` or a kit.
**Steps:**
1. Open component detail.
2. Click "Move component" → target kit `DEMO-KIT-02`.
3. Submit.
**Expected:** Component now reports current location = `DEMO-KIT-02`. A new `component_transaction` exists.
**Bug if:** Component holder doesn't update, or split/merge logic fires when it shouldn't (this is a transfer, not a split).

#### D6: User cannot create products/components
**Persona:** demo-user-1
**Preconditions:** Logged in as user.
**Steps:**
1. Navigate to `/products` and `/components`.
**Expected:** "New product" / "New component" buttons not rendered (admin-only create). PB rejects direct POST.
**Bug if:** Buttons rendered, or PB accepts the POST.

---

### E. Maintenance

> See pre-existing bugs K4–K6 above for the remaining friction surface. Stories here cover what currently works.

#### E1: Admin creates a maintenance schedule from a kit detail page @smoke
**Persona:** demo-admin-1
**Preconditions:** Kit `DEMO-KIT-02` is active.
**Steps:**
1. Navigate to `/kits/<DEMO-KIT-02 id>`.
2. Scroll to "Maintenance" section (`KitDetailPage.tsx:336-472`).
3. Click "Add schedule".
4. Fill type "calibration", description "Quarterly cal", interval 90, last_done_at today − 30d, notes "Puppet E1".
5. Submit.
**Expected:** Schedule appears on `/maintenance` and on the kit detail Maintenance section. `next_due_at` = (last_done_at + 90d).
**Bug if:** next_due_at math is wrong (`AddScheduleDialog.tsx:41-50`), or schedule missing from `/maintenance` table after refresh.

#### E2: Admin creates a maintenance schedule directly from /maintenance @smoke
**Persona:** demo-admin-1
**Preconditions:** Logged in.
**Steps:**
1. Navigate to `/maintenance`.
2. Click the header "New schedule" button (`MaintenancePage.tsx:69`) — also reachable via the EmptyState CTA when the list is empty (`MaintenancePage.tsx:119`).
3. Pick kit `DEMO-KIT-03`, type "inspection", interval 30, last_done_at today − 5d, notes "Puppet E2".
4. Submit.
**Expected:** Schedule appears in the `/maintenance` table without navigating away. `next_due_at` = last_done_at + 30d.
**Bug if:** "New schedule" button missing for admin, dialog doesn't open, or submit fails to refresh the list.

#### E3: Technician records maintenance completion
**Persona:** demo-technician-1
**Preconditions:** E1 succeeded — a schedule exists for DEMO-KIT-02.
**Steps:**
1. Navigate to `/maintenance`.
2. Filter by "Overdue" or "Due soon".
3. Find DEMO-KIT-02's schedule. Click "Record done".
4. Fill performed_at today, notes "Cal complete", certificate file upload (any PDF).
5. Submit.
**Expected:** A `maintenance_record` row exists. Schedule's `last_done_at` updates to today; `next_due_at = today + interval_days` (per `maintenance_update_next_due.pb.js`). Schedule status pill flips off "Overdue".
**Bug if:** next_due_at not updated (hook didn't fire), certificate file uploaded but record has empty `certificate` field, or `performed_by != demo-technician-1` (`createRule` requires it).

#### E4: Viewer cannot record maintenance
**Persona:** demo-viewer-1
**Preconditions:** Schedule from E1 exists.
**Steps:**
1. Navigate to `/maintenance`.
**Expected:** `/maintenance` blocked at route gate (`CanDecideOnly`, `App.tsx:75`). Redirect to `/dashboard`.
**Bug if:** Viewer reaches /maintenance UI even read-only, or "Record done" button is rendered for viewer if a leak occurs.

#### E5: Admin downloads a recorded maintenance certificate
**Persona:** demo-admin-1
**Preconditions:** E3 succeeded with a certificate uploaded for a schedule of DEMO-KIT-02.
**Steps:**
1. Navigate to `/maintenance/<schedule id>` (or click into the schedule from `/maintenance`).
2. Locate the recent record in the history list (`ScheduleDetailPage.tsx:172-218`).
3. Click the certificate download link.
**Expected:** Link href is `${baseUrl()}/api/files/maintenance_records/<rec id>/<filename>` and resolves 200 with the original file bytes.
**Bug if:** Link missing for a record with a certificate, or the href returns 404/403.

---

### F. On-call rotation

#### F1: Admin views on-call schedule @smoke
**Persona:** demo-admin-1
**Preconditions:** Seed creates 3 shifts (Tech 1 = current, Tech 2 = past, Admin = future) — `seed_demo_data.mjs:322-340`.
**Steps:**
1. Navigate to `/oncall`.
**Expected:** Table shows 3 shifts. Status pills "Active" (Tech 1), "Past" (Tech 2), "Upcoming" (Admin). Tech 1 row has a `tel:` link if phone is set (`OnCallPage.tsx:158`).
**Bug if:** Status math wrong, table empty (`getCurrentOnCallUsers` filter broken), or actions column rendered for non-admin/non-tech viewer.

#### F2: User without canDecide can view, but cannot Add/Edit/Delete a shift
**Persona:** demo-user-1
**Preconditions:** Logged in.
**Steps:**
1. Navigate to `/oncall`.
**Expected:** Page renders read-only. No "Add shift", "Edit", or "Delete" buttons (`OnCallPage.tsx:108,141,165` — all behind `canDecideRequests`).
**Bug if:** Action buttons render.

#### F3: User in the field calls the on-call technician via sidebar tel: link @smoke
**Persona:** demo-user-2
**Preconditions:** Tech 1's user record has a phone number set (verify `/users` row). If empty, set one as admin first.
**Steps:**
1. Sign in as demo-user-2.
2. Any authenticated page (e.g. `/dashboard`).
3. Inspect sidebar (`Layout.tsx:262-291`).
4. Click the on-call name (or phone).
**Expected:** Sidebar shows "On call: Demo Tech 1" in emerald, with a `tel:` href present on the name span. Clicking it triggers a `tel:` navigation (Playwright should assert the `href` attribute, since the dialer can't be launched in the browser).
**Bug if:** Sidebar shows "No on-call" despite an active shift, or the link is missing the `tel:` href when phone is set.

#### F4: Admin adds a new on-call shift (overlapping current)
**Persona:** demo-admin-1
**Preconditions:** Tech 1 has an active shift covering today.
**Steps:**
1. Navigate to `/oncall`.
2. Click "Add shift". User = Tech 2. Start = today − 12h. End = today + 12h.
3. Submit.
**Expected:** Two overlapping active shifts. Sidebar widget should pick the first one (`onCallUsers[0]` per `Layout.tsx:264`) — current behavior is "first wins, no UI ambiguity surfaced." Note: this is worth probing — if both should be shown, that's a feature gap.
**Bug if:** `oncall_validate.pb.js` rejects overlap when it should be allowed (or accepts when it shouldn't — depends on intended policy. Check the hook).

#### F5: Admin deletes a past shift
**Persona:** demo-admin-1
**Preconditions:** Tech 2 has a past shift.
**Steps:**
1. Navigate to `/oncall`.
2. Click Delete on Tech 2's past shift → confirm.
**Expected:** Row removed. Toast confirms.
**Bug if:** Active shifts can also be deleted without warning (a P2 affordance concern, may be intended — note for product).

---

### H. MCP from Claude Code (orchestrator-level)

> Driven by JSON-RPC POST to `/api/mcp` (`ai_mcp.pb.js`). Auth header: `Authorization: <PB token>` (NOT `Bearer`).

#### H1: orchestrator lists tools via MCP
**Persona:** demo-admin-1 (token authenticated outside the browser, set in Claude Code MCP config)
**Steps:**
1. From the Claude Code session with kit-tracker MCP server registered:
2. Invoke MCP tool listing.
**Expected:** Returns the tools advertised in `ai_mcp.pb.js` (see CLAUDE.md "AI / MCP server" for the current count).
**Bug if:** Auth fails (token header format mismatch — must be raw token, not Bearer); or a write tool documented in CLAUDE.md is missing from the advertised tool list.

#### H2: orchestrator creates an entity via MCP @smoke
**Persona:** demo-admin-1
**Steps:**
1. Invoke `create_entity` via MCP with `{ name: "PUPPET-MCP-Entity-01", type: "lab" }`.
**Expected:** Entity exists in DB. Audit log row has `changes.via="mcp"`. Returned record has the new id.
**Bug if:** Audit row missing the `via=mcp` marker, or entity name duplicates an existing record silently.

#### H3: orchestrator moves a kit via MCP
**Persona:** demo-admin-1
**Steps:**
1. Invoke `move_kit` with kit_id + target_entity_id (both resolved via `resolve_*` first).
**Expected:** New transaction with `created_by` = the demo-admin-1 token holder, `request=""`, and an audit log row with `changes.via="mcp"`. Undo NOT provided via MCP v1 (per CLAUDE.md "Undo is not provided via MCP v1 — issue a reverse operation from the client.").
**Bug if:** Move succeeds for a viewer's token (write tools must reject viewer/user).

#### H4: orchestrator uses MCP token of a viewer → write rejected
**Persona:** demo-viewer-1 (whose token is in the MCP config)
**Steps:** Invoke `create_kit` with any payload.
**Expected:** JSON-RPC error: "forbidden" or similar. No record created.
**Bug if:** Record is created (P0 security bug).

---

### I. Permission boundaries (viewer + role gates)

#### I1: Viewer sees a read-only sidebar @smoke
**Persona:** demo-viewer-1
**Preconditions:** Logged in.
**Steps:**
1. Inspect sidebar links visible.
**Expected:** Dashboard, Kits, Entities, Components, Requests, Profile visible. **Not** visible: /users, /maintenance, /stats, /audit (gated by `AdminOnly` / `CanDecideOnly`).
**Bug if:** Any gated link is rendered, or clicking still navigates (the route gate must redirect to /dashboard, per `App.tsx:31-41`).

#### I2: Viewer cannot create kits/entities/products/components
**Persona:** demo-viewer-1
**Steps:**
1. Navigate to /kits, /entities, /products, /components in turn.
**Expected:** On each page, "New ..." button is not rendered. Direct PB REST POST returns 403.
**Bug if:** Button rendered or REST POST accepted.

#### I3: Viewer can read request details but cannot create
**Persona:** demo-viewer-1
**Steps:**
1. Navigate to /requests; click a row to open detail.
**Expected:** Detail page renders. "New request" button NOT rendered (createRule = admin or user; viewer excluded). No Approve/Reject/Fulfill actions.
**Bug if:** Viewer sees Approve action (mismatch with `canDecideRequests` gate at `AuthContext.tsx:71`).

#### I4: User cannot view /users page
**Persona:** demo-user-1
**Steps:** Navigate to `/users`.
**Expected:** Redirect to `/dashboard` (AdminOnly gate, `App.tsx:70`).
**Bug if:** Page renders even briefly (flicker).

#### I5: User cannot self-promote via PATCH
**Persona:** demo-user-1
**Steps:**
1. Open browser devtools; issue `PATCH /api/collections/users/records/<self-id>` with `{"role":"admin"}`.
**Expected:** PB returns 400 (rejected by `role_change_check.pb.js`). User remains role=user.
**Bug if:** Promotion succeeds.

#### I6: Technician can decide requests + move kits, cannot manage users
**Persona:** demo-technician-1
**Steps:**
1. Navigate to /users.
2. Navigate to /maintenance and confirm access.
3. Navigate to a request and confirm Approve action available.
**Expected:** /users redirects to /dashboard. /maintenance renders. Approve action visible.
**Bug if:** Technician can reach /users, or cannot Approve a request.

---

### J. Cross-persona interactions (concurrency-light)

#### J1: Admin approves while requester is viewing the open request @stress
**Personas:** demo-admin-1 (window A) and demo-user-1 (window B; requester of the open request)
**Preconditions:** A request owned by demo-user-1 in `open` status.
**Steps:**
1. user-1 opens `/requests/<id>` (status visible: open).
2. admin-1 in another browser approves the request.
3. user-1 stays on the page (no manual reload).
**Expected:** Within ~5s OR on next interaction, user-1's page reflects status=approved. If realtime is wired, immediate; otherwise visible on next click/refresh.
**Bug if:** user-1 attempts a Cancel after admin approves and Cancel "succeeds" client-side but PB rejects (creates a confusing zombie state).

#### J2: Admin grants role to pending user; pending user's banner clears
**Personas:** demo-admin-1, fresh pending user (see A1)
**Steps:**
1. Pending user signs in, sees banner.
2. Admin sets role to `user` in `/users`.
3. Pending user reloads or waits ≤60s.
**Expected:** Banner clears; nav links appear.
**Bug if:** Banner persists after reload (user cache stale), or pending user lands on a 404 trying to navigate before refresh.

#### J3: Two technicians edit the same kit at the same time @stress
**Personas:** demo-technician-1 + demo-technician-2
**Steps:**
1. Both open `/kits/<DEMO-KIT-09 id>` simultaneously.
2. Both fill different "Move kit" target entities.
3. Both click Submit within 1s of each other.
**Expected:** Both transactions append (no last-writer-wins on the kit record — transactions are independent and append-only). Current holder = whichever transaction has the later `created` timestamp. Timeline shows both.
**Bug if:** One submit fails with conflict error (we don't expect optimistic-lock failures on transactions), or the kit detail page shows an inconsistent holder until reload.

#### J4: Admin deactivates a kit while another user is mid-request for it
**Personas:** demo-admin-1 + demo-user-2
**Steps:**
1. demo-user-2 opens `/requests` → New request → selects kit `DEMO-KIT-22`.
2. demo-admin-1 navigates to `/kits/<DEMO-KIT-22 id>` and clicks Deactivate.
3. demo-user-2 then submits the request.
**Expected:** Submit fails OR succeeds with a warning (depending on whether the requests collection enforces `designated_kit.is_active=true`). Document whichever the current behavior is — this is a known UX edge.
**Bug if:** Request created against an inactive kit with no warning AND the admin's audit row shows no activation status (would create stale references).

#### J5: Fulfill collides with cancel @stress
**Personas:** demo-admin-1 (about to Fulfill), demo-user-1 (about to Cancel)
**Preconditions:** A request owned by user-1 in `approved` status (note: user-1 may not be able to Cancel from approved per the rules — verify; if so this story becomes "Admin tries to Fulfill while another admin Rejects").
**Steps:**
1. Both load the request page.
2. user-1 attempts Cancel; admin-1 attempts Fulfill within 1s.
**Expected:** Exactly one action succeeds; the other returns a 4xx that the UI surfaces clearly. NO half-state where status=cancelled but a transaction was also created (`fulfillRequest` atomicity).
**Bug if:** Both succeed (transaction without a fulfilled request, OR cancelled request with a transaction attached).

---

### K. Mobile viewport

> Set viewport 390×844 (iPhone 13). Most pages have explicit mobile blocks (`md:hidden` / `md:block`).

#### K1: Mobile sidebar drawer opens and shows on-call link
**Persona:** demo-user-2
**Steps:**
1. Resize to 390×844. Navigate to /dashboard.
2. Tap the menu button (top-left).
**Expected:** Drawer slides in. On-call name + tel link visible (`Layout.tsx:330-358`).
**Bug if:** Drawer overflows viewport, menu button not ≥44px tap target, or on-call tel: href missing.

#### K2: On-call tel link works on mobile @smoke
**Persona:** demo-user-1 (mobile viewport)
**Steps:**
1. Open mobile drawer.
2. Tap the underlined on-call name.
**Expected:** Anchor's href starts with `tel:` and matches `formatTelHref(...)`. Drawer can intercept the click without navigating away (the inner `<a>` uses `stopPropagation` — `Layout.tsx:276`).
**Bug if:** Tap closes the drawer without firing the tel: link, or href is missing.

#### K3: Mobile kit detail "Move kit" reachable without horizontal scroll
**Persona:** demo-technician-1 (mobile viewport)
**Steps:**
1. Navigate to `/kits/<DEMO-KIT-03 id>`.
2. Scroll to find "Move kit" button.
**Expected:** Button visible without horizontal scroll; ≥44px hit area; opens dialog.
**Bug if:** Button cut off, dialog larger than viewport, or input fields not focusable on tap.

#### K4: Mobile /requests list — row tap navigates to detail
**Persona:** demo-user-1 (mobile viewport)
**Steps:**
1. Navigate to /requests.
2. Tap any row.
**Expected:** Navigates to /requests/<id>. (Per recent merge `242eb6a Merge: tables — whole-row click to detail, drop arrow column`.)
**Bug if:** Nothing happens, or row tap triggers a different (form) action.

#### K5: Mobile /maintenance — list renders as cards (KNOWN GAP K6 for create)
**Persona:** demo-admin-1 (mobile viewport)
**Steps:**
1. Navigate to /maintenance.
**Expected:** Existing schedules render as mobile cards (`MaintenancePage.tsx:103-131`). Filters accessible.
**Bug if:** Desktop table leaks into mobile view, or filter dropdowns clip outside viewport.

---

### L. Error states + edge cases

#### L1: Network failure during kit create
**Persona:** demo-admin-1
**Preconditions:** Block PB at the network layer (Playwright route interception, or kill PB after page load).
**Steps:**
1. Navigate to /kits → New kit → fill → Submit.
**Expected:** Error toast appears. Dialog stays open with entered values preserved (so user can retry without retyping).
**Bug if:** Dialog closes silently, or page goes blank / errors uncaught.

#### L2: Bad input — negative quantity on bulk component
**Persona:** demo-admin-1
**Steps:**
1. /components → New component → Bulk → quantity = -5.
2. Submit.
**Expected:** Inline validation refuses (or PB rejects). No record created.
**Bug if:** Negative qty saved (would corrupt stock math everywhere).

#### L3: Re-submitting the same request twice (double-click) creates only one
**Persona:** demo-user-1
**Steps:**
1. /requests → New → fill → click Submit twice in <500ms (Playwright `.click({ clickCount: 2 })`).
**Expected:** One row created. Submit button disables on first click.
**Bug if:** Two duplicate open requests created.

#### L4: Auth token expiry mid-session
**Persona:** demo-user-1
**Steps:**
1. Sign in. Manipulate `pb.authStore` to clear token (DevTools `localStorage.clear()`).
2. Click any nav link.
**Expected:** Redirected to /login. No uncaught console errors. (`AuthContext.tsx` subscribes to `pb.authStore.onChange`.)
**Bug if:** Page errors, blank screen, or 401 spew without a redirect.

#### L5: PB SDK auto-cancellation visible as "stuck Loading…" on rapid nav
**Persona:** demo-admin-1
**Preconditions:** Reproduce React StrictMode double-mount (dev build only).
**Steps:**
1. Click /kits → immediately click /entities before /kits finishes loading.
2. Click back to /kits.
**Expected:** /kits eventually loads (per pattern in CLAUDE.md: `if (!err?.isAbort) console.error(err)`).
**Bug if:** /kits remains stuck at "Loading…" — would mean a `load()` call missed the `isAbort` guard.

#### L6: Concurrent edit on the same Schedule
**Persona:** demo-admin-1 (window A) + demo-technician-1 (window B)
**Steps:**
1. Both open a schedule (either via `/maintenance/<id>` or `/kits/<id>` → maintenance section).
2. Tech 1 hits Record done; Admin-1 hits Deactivate; both within 1s.
**Expected:** Both update paths succeed independently (one writes maintenance_records, the other patches is_active). Final schedule row: is_active=false, last_done_at updated.
**Bug if:** Deactivate races and one update is lost.

---

## Stretch goals — concurrency stress

Specific multi-persona scenarios where the Playwright agents MUST run side-by-side (in separate browser contexts):

1. **J3 expanded** — Tech 1 and Tech 2 each issue 5 moves to the same kit over 10s. Final timeline shows 10 transactions; current holder = the last `created` row. No PB 5xx.
2. **J5 expanded** — Admin-1 fulfills 10 distinct approved requests in a loop while user-1 cancels each open request in parallel. Validate atomicity: every fulfilled request has a transaction; every cancelled request has none.
3. **Last-admin race** — Admin-1 (only admin) edits own role to `user` in two tabs simultaneously. Both submits → exactly one rejection from `last_admin_check.pb.js`; admin role preserved.
4. **OAuth pending-user storm** — Create 20 empty-role users in quick succession. Admin lands on /users and bulk-promotes them. Audit log shows 20 promote rows; sidebar nav appears in all 20 user sessions on reload.
5. **Component split during transfer** — Tech 1 splits a bulk component (qty 25 → 10 to kit A, 15 to kit B). At the same time, Tech 2 transfers the same bulk component. One operation should fail clearly; quantity invariants hold (total = 25 across all locations).
6. **Maintenance reminder cron + schedule deactivate** — Trigger the daily reminder route while admin deactivates a "due soon" schedule. The deactivated schedule must NOT show up in the email digest.

---

## Story counts per group

| Group | Count |
|---|---:|
| A. Onboarding & auth | 5 |
| B. Kit lifecycle | 6 |
| C. Request flow | 6 |
| D. Components + products | 6 |
| E. Maintenance | 5 |
| F. On-call rotation | 5 |
| H. MCP from Claude Code | 4 |
| I. Permission boundaries | 6 |
| J. Cross-persona interactions | 5 |
| K. Mobile viewport | 5 |
| L. Error states + edge cases | 6 |
| **Total** | **59** |

K4–K6 are documentation markers (not playable stories); the 59-count above only covers playable stories distributed across the 11 active groups (the original group G "AI chat" was retired when the AI chat sidebar was replaced by deterministic slash commands).

## Highest-ROI starting points (if forced to pick 3)

1. **B3** — kit-move smoke. Touches the most-foundational write path (transactions + derived holder + audit). Failure here invalidates 80% of the rest.
2. **C3** — request fulfillment atomicity. If the transaction-status coupling is broken, the request system is silently corrupt; high blast radius, hard to debug post-hoc.
3. **H4** — MCP write rejected for a viewer's token. Cheap to run, and a hit here is a P0 security bug (privilege escalation via the MCP write tools).
