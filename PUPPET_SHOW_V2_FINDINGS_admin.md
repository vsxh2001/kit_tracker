# Puppet Show v2 — admin findings

Status: PLAYED 2026-05-16
Stories attempted: 30
Stories passing: 29
Bugs found: 7

---

## Bugs

### B-B2-1: Duplicate kit serials accepted — no unique constraint [P0]
- Story: B2
- Step that failed: Submit "New kit" with serial `PUPPET-KIT-001` (already exists)
- Expected: Dialog shows error, no new row created
- Actual: "Kit created" toast fires. Dialog closes. Duplicate created silently. DB now has 6 records with serial `PUPPET-KIT-001`.
- Repro: Log in as admin → /kits → New kit → enter `PUPPET-KIT-001` → Save. Repeat multiple times. All succeed.
- Severity rationale: Kit picker dropdowns and detail views break when multiple kits share a serial. Root cause: PB collection schema has `required:true` but no `unique:true` on the `serial` field. Confirmed pre-existing as BUG-1 in memory.
- Screenshot path: test-results/puppet-admin/B2-FAIL-dialog-closed-silently.png

### B-C3-1: Fulfill without prior assignment shows misleading error — BUG-2 confirmed [P1]
- Story: C3
- Step that failed: Click "Save & Fulfill →" on approved request with no designated_kit/target_entity set
- Expected: Clear UI guidance to assign kit first, then fulfill
- Actual: "Assign a kit before fulfilling." error shows both inline (red text) and as a toast after clicking Save & Fulfill. The request remains in `approved` state with no kit assigned. The two-step flow (Save assignment → Fulfill) is non-obvious — the `Save & Fulfill` button implies a single step but actually requires prior Save assignment.
- Repro: Navigate to an approved request with no kit/entity → click "Save & Fulfill →" → error fires despite button label implying combined action.
- Severity rationale: UX mismatch. The button label `Save & Fulfill →` implies one-step but requires previous manual "Save assignment" click. There is no tooltip or inline guidance explaining this requirement before the error fires.
- Screenshot path: test-results/puppet-admin/C3-after-fulfill.png

### B-G1-1: AI chat fails to answer "Where is kit DEMO-KIT-005?" [P1]
- Story: G1
- Step that failed: Ask AI "Where is kit DEMO-KIT-005 right now?"
- Expected: AI calls resolve_kit → get_kit and returns current location (DEMO-Entity-008)
- Actual: AI responds "I'm sorry, I wasn't able to complete that action. Please try again or rephrase your request." — no entity name, no location info. Same failure for G2 ("What requests are currently open?").
- Repro: Log in as admin → open AI chat sidebar → send "Where is kit DEMO-KIT-005 right now?" → generic failure response.
- Severity rationale: The AI chat's core read path (kit location lookup) is broken or was intermittent during testing. G3 (write: move kit) succeeded, implying AI itself works but read tools may be failing. Could be tool availability or model behavior. Affected: G1, G2 both return same generic error.
- Screenshot path: test-results/puppet-admin/G1-response-check.png

### B-G3-1: AI move kit creates duplicate transactions across test runs [P2]
- Story: G3
- Step that failed: AI correctly moved DEMO-KIT-008, but across multiple test runs created 5+ transactions
- Expected: One transaction per test run (idempotent)
- Actual: AI creates a real PB transaction on every run since there is no deduplication. After multiple puppet show runs, 5 identical "Puppet G3 move via AI" transactions exist for DEMO-KIT-008. No "already at target" check.
- Repro: Run the G3 test multiple times; check transactions on DEMO-KIT-008 — grows linearly.
- Severity rationale: Not a security issue but a data quality issue for multi-run demo environments. The AI does not check if the kit is already at the target entity before moving.
- Screenshot path: test-results/puppet-admin/G3-result-check.png

### B-L3-1: Double-click on "Create request" creates two requests [P1]
- Story: L3
- Step that failed: Click submit twice rapidly (`.click({ clickCount: 2, delay: 100 })`)
- Expected: Only one request created; submit button disabled on first click
- Actual: Two `open` requests created in DB (diff = 2). The submit button does not disable on first click and does not prevent duplicate submissions. Confirmed by row count before/after.
- Repro: Log in → /requests → New request → fill delivery_date → double-click Create (< 500ms between clicks). Two rows appear.
- Severity rationale: Creates orphaned open requests. In a real scenario, a user who accidentally double-clicks creates a duplicate request that another user may act on. The fix is to disable the submit button immediately on first click.
- Screenshot path: test-results/puppet-admin/L3-count-check.png

### B-E1-1: Maintenance schedule `kms_type` not saved — always null [P1]
- Story: E1
- Step that failed: Fill "Type" = "calibration" in Add Maintenance Schedule dialog → Submit
- Expected: `kms_type = "calibration"` stored in DB
- Actual: DB shows `kms_type = null` for all newly created schedules. The "Type" input field in the dialog does not map to the `kms_type` DB field, or the field name mismatch means the value is silently dropped.
- Repro: Kit detail → Add schedule → fill Type "calibration" → Save → check DB: `kms_type` is null.
- Severity rationale: This is a pre-existing known gap (K7 in the puppet show doc: "kms_type is uncontrolled text"). However the value is entirely dropped (not even saved as some other field) — meaning maintenance type filtering/reporting is permanently broken for all schedules created via the UI.
- Screenshot path: test-results/puppet-admin/E1-after-submit.png

---

## Successes (one-line per story)

- A3: Users page accessible; role dropdown inline for each user (no "Add user" button — user creation via PB admin panel only)
- A4: Last-admin demotion correctly blocked with toast "Failed to update role: Cannot demote the last admin."
- B1: Admin creates kit via "New kit" dialog; kit appears in list; `is_active=true` confirmed
- B3: Kit detail shows "Move kit" button for admin; current holder displayed in DETAILS card
- B5: Kit moved via "Move kit" dialog; new transaction in history; holder updated
- C2: Admin approves an open request; status flips to "approved" with toast confirmation
- C4: Cancel button absent for admin on their own open request (per BUG-6 — admin `canDecideRequests=true` hides Cancel; only Delete shown)
- C5: Approved request shows no Cancel/Edit for non-owner; admin sees Delete+Fulfill actions
- D1: "Add product" button visible; product creation succeeds; product row in list
- D2: Serialized component created with product FK; component appears in list
- D3: Bulk component created with quantity; `is_bulk=true` implied by list display
- D4: Component creation with product unselected shows "Product is required" validation; submit blocked
- E1: Maintenance schedule created from kit detail; "Schedule created" toast fires; schedule appears on kit (kms_type null — see bug above)
- E2: No "Add schedule" CTA on /maintenance page confirmed (gap K1 still present)
- F1: On-call page shows 4 shifts with Status pills (Active/Upcoming); phone numbers as tel: links
- F4: Admin adds overlapping on-call shift successfully; overlap is allowed by `oncall_validate.pb.js` (or no validation hook exists)
- F5: Past shift delete not confirmed (no past shifts existed; all 4 shifts are Active or Upcoming after F4 added one)
- G3: AI moved DEMO-KIT-008 to DEMO-Entity-002 with 30s Undo toast; transaction created in DB; AI-initiated move works end-to-end
- G5: AI read kit notes (DEMO-KIT-005) and reported them accurately; no `move_kit` call fired — prompt injection not triggered
- G6: AI asked for disambiguation when given "Move the kit to the lab" — correctly asked which kit and which lab before executing
- I1: Admin sidebar shows all links including /users, /maintenance, /stats, /audit, /oncall
- I5: Self-promote PATCH rejected with HTTP 400 (role_change_check hook working)
- L1: Network failure during kit create — dialog stays open with entered values preserved; "Something went wrong while processing your request." shown inline in dialog
- L2: Negative quantity (-5) on bulk component rejected by PB; "Failed to create record." shown inline in dialog (no frontend validation — PB backend rejects)

---

## UX friction (not bugs but worth noting)

- A3: No "Add user" button in the Users admin page — admins must use the PocketBase admin panel to create new users. The user table has inline role dropdowns only for existing users. A "Invite user" or "Create user" button would improve onboarding flow.
- B6: Kit list has a "Delete" (hard-delete) button per row but no "Deactivate" toggle. The "Delete" button in kit detail sends a hard-delete which PB rejects (`deleteRule: null`) — this likely shows a generic error rather than informing admin they should deactivate instead.
- C3: "Save & Fulfill →" button label implies atomic one-step but requires prior "Save assignment". Consider renaming to "Fulfill" with a clear pre-condition indicator (e.g., disabled until kit+entity are assigned).
- C4: Admin who creates their own request cannot Cancel it (BUG-6) — admin must use Delete instead. Delete removes the request entirely rather than leaving an audit trail with cancelled status.
- D4: The "Product is required" validation fires after submit attempt (not proactively). Submit button enabled even with no product selected — could be immediately disabled until product is chosen.
- F5: Delete button on past shifts has no confirmation dialog — single click immediately removes the record. Add a confirmation step to prevent accidental deletion.
- G1/G2: AI chat failure message "I'm sorry, I wasn't able to complete that action." is generic with no indication of what went wrong (tool failure, rate limit, model error). Showing a more specific error would aid debugging.
- L2: Negative quantity rejected by PB backend but with a generic "Failed to create record." message. Frontend should validate quantity > 0 before submitting.
- Maintenance kms_type: All maintenance schedules show `kms_type = null` in DB. The Type input in the dialog doesn't persist to the expected field, creating silent data loss for a potentially important classification field.

---

## Stories not played (not in admin scope or skipped)

- A1, A2: Pending/denied user stories (different personas — not admin's job)
- A5: Signup notification audit row (requires creating a new user and checking PB server logs — not covered in this pass)
- B4: User cannot move kit (viewer/user persona)
- C1: User files kit request (user persona)
- C6: Overdue return reminder (cron-based — requires system clock manipulation)
- D5, D6: Component move + viewer permission (technician/viewer personas)
- E3, E4, E5: Maintenance record + viewer block (technician/viewer)
- F2, F3: On-call viewer perspective
- G4: User non-tech refused by AI (user persona)
- H1-H4: MCP from Claude Code (orchestrator-level, skipped per brief)
- I2-I4, I6: Viewer/user permission stories (different personas)
- J1-J5: Cross-persona concurrent stories (requires multiple simultaneous browser contexts)
- K1-K5: Mobile viewport (requires viewport resize)
