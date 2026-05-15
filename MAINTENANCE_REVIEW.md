# Maintenance feature — review + plan

Status: DISCUSSION — pending approval

## 1. The user-reported gap

**There is no way to create a maintenance schedule from the `/maintenance` page.**

`frontend/src/pages/MaintenancePage.tsx:50-191` renders only filters + table + "Record done" action. No "Add schedule" button, no kit-picker, no link to where creation lives. The `EmptyState` shown when the list is empty (`MaintenancePage.tsx:96-100`) has no `cta` prop — it just says "No active maintenance schedules found" with zero next-step guidance.

**Where creation IS done today:** exclusively from `KitDetailPage.tsx`. Specifically, the kit detail page renders a per-kit Maintenance section (`KitDetailPage.tsx:336-472`) with an "Add schedule" button at line 342-350 that opens `AddScheduleDialog`. The dialog is hardcoded to take a `kitId` prop (`AddScheduleDialog.tsx:17,23`) — there is no kit selector inside it.

**Why this surprises the user:**

1. The page is named "Maintenance" and routed at `/maintenance` — natural mental model is "this is where I manage maintenance."
2. Every other ops surface in the app (kits list, requests, transactions) has a primary action button in the header. Maintenance is the only operational page without one.
3. The current flow forces the user to: (a) know the kit serial, (b) navigate to /kits, (c) find and click into the kit, (d) scroll to the Maintenance section, (e) click "Add schedule." Five steps to do something that should be one.
4. Admins managing a fleet think in terms of "what calibration schedules do we run?" — not "let me go find the right kit." The current architecture is kit-first; the user's mental model is policy-first.

This is a P0 UX gap, not a bug — the schema and service layer (`maintenance.ts:18-24` `createSchedule`) already support direct creation; the page just doesn't expose it.

## 2. End-to-end walkthrough

Walking through the "I want a periodic 30-day battery check on kit BAT-001" workflow as an admin today:

```
1. Click "Maintenance" in sidebar           → lands at /maintenance
2. Scan table for kit BAT-001               → not there (no schedule exists yet)
3. Realize there's no "Add" button here     ← FRICTION P0
4. Navigate to /kits                        ← FRICTION (no link from maintenance page to kits)
5. Search / filter for BAT-001
6. Click into /kits/<id>
7. Scroll past kit info, components ...     ← FRICTION on mobile especially
8. Find "Maintenance" section
9. Click "Add schedule"                     → AddScheduleDialog opens
10. Fill Type, Description, Interval (days),
    Last done at (optional), Notes
11. Submit                                  → schedule created, next_due_at computed
                                              client-side as last_done_at + interval_days
                                              (or today if last_done_at blank)
                                              (AddScheduleDialog.tsx:41-50)

—— time passes ——

12. Day arrives at next_due_at - 7d
13. Daily 8am UTC cron fires                 (maintenance_reminder.pb.js:14)
14. Cron queries schedules due in 7 days     (line 34-41)
15. Cron queries admins + on-call shifts     (line 65-100)
16. HTML digest email sent per recipient     (line 122-156)
   ⚠ If SMTP unconfigured: "skipping" logged silently
     (line 150-152). No visible signal anywhere
     in the app that mail failed.            ← FRICTION P1

17. Tech sees /maintenance, filters "Overdue" (MaintenancePage.tsx:43-48)
18. Clicks "Record done" on the row          (line 165-170)
19. RecordMaintenanceDialog opens            (RecordMaintenanceDialog.tsx)
20. Picks performed_at (default today),
    adds notes, optionally uploads certificate
21. Submits → maintenance_record created
22. before-create hook computes
    next_due_snapshot = performed_at + interval_days
                                              (maintenance_update_next_due.pb.js:8-36)
23. after-create hook updates parent
    schedule.last_done_at + .next_due_at      (line 38-67)
24. Table refreshes, status pill flips to OK

—— wants to verify history later ——

25. Wants to see the audit trail of past
    maintenance for kit BAT-001               ← FRICTION P1
26. There is no UI for this. listRecordsForSchedule
    exists in maintenance.ts:35-42 but is
    NOT called anywhere in the frontend.
27. The certificate file uploaded in step 20
    is in PocketBase but has no download UI    ← FRICTION P1 (certificate trapped)
```

Friction summary: the schedule-creation entry point, the post-mail-failure feedback gap, the missing history view, and the inaccessible certificate are all on the *primary* maintenance workflow.

## 3. Findings

| #  | Area                                          | Severity | What                                                                                                                                                                                |
|----|-----------------------------------------------|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | /maintenance create                           | P0       | No "Add schedule" button or kit-picker on `/maintenance`. Creation only reachable via per-kit detail page (`MaintenancePage.tsx` vs `KitDetailPage.tsx:342-350`).                    |
| 2  | EmptyState dead-end                           | P0       | Empty-list state on `/maintenance` (`MaintenancePage.tsx:96-100`) shows no CTA. New admins hit a wall.                                                                               |
| 3  | Maintenance history not viewable              | P1       | `listRecordsForSchedule` exists (`services/maintenance.ts:35-42`) but is never invoked from any React component. Past records — including audit-grade calibration data — are dark.   |
| 4  | Certificate uploads write-only                | P1       | `mr_certificate` is uploaded in `RecordMaintenanceDialog.tsx:108-117` and stored, but there is no UI to download / preview it. Defeats the entire reason it's stored.                |
| 5  | SMTP failure is silent                        | P1       | `maintenance_reminder.pb.js:150-152` swallows SMTP errors with a console log. No surfaced signal in the app. Admins won't know reminders never sent.                                  |
| 6  | No bulk-apply schedule                        | P2       | A field-ops fleet of 50 multimeters all need the same 12-month calibration. Today: 50 manual schedule creations. No "apply template to N kits."                                      |
| 7  | No "duplicate schedule"                       | P2       | If admin built a complex schedule on one kit, only way to replicate is to retype everything for the next. No copy button.                                                            |
| 8  | No edit-in-place                              | P2       | Schedule rows offer only "Record done" + "Deactivate." Wrong interval at create time → must deactivate + re-create, losing continuity. `updateSchedule` (`maintenance.ts:26-33`) is defined but only used for `is_active` toggling. |
| 9  | Per-kit-only granularity                      | P2       | Schedules attach to a `kit`, not a component. A torque wrench moving between kits has its calibration follow the kit, not the wrench. See COMPONENT_HYPERCHARGE_IDEAS.md §4.8.       |
| 10 | Mobile schedule creation is hard              | P2       | On mobile, the kit detail page is long (info → components → maintenance → attachments). Field tech with phone: scroll-scroll-scroll to find the Add button.                          |
| 11 | "Due soon" threshold is implicit              | P3       | `maintenanceStatus` in `lib/utils.ts` (referenced `MaintenancePage.tsx:10-11`) defines due-soon — but there's no admin-configurable lead time. Hard-coded.                            |
| 12 | Type field is free-text                       | P3       | `kms_type` is `text` (`1778615063_add_maintenance.js:43-50`). Typos: "Calibration" vs "calibration" vs "Calib." The filter dropdown (`MaintenancePage.tsx:75-86`) shows each variant. |
| 13 | No "snooze" or "skip this occurrence"         | P3       | If a kit is out of service, the schedule keeps firing. Only escape valves are "Record done" (lies) or "Deactivate" (loses the schedule entirely).                                    |
| 14 | Test coverage of /maintenance create = 0      | P2       | `e2e/maintenance.spec.ts:88-107` only tests creation via the kit detail page. There is no test asserting `/maintenance` has a create entry point, because there is none.             |

## 4. Recommended fixes (in priority order)

### F1. Add "New schedule" button + kit-picker on /maintenance

- **Problem:** No way to create from `/maintenance` (Finding 1, 2).
- **Proposed change:** Header-right button "New schedule" next to the page title (`MaintenancePage.tsx:50-56`). Opens an enhanced `AddScheduleDialog` that takes an optional `kitId`; when absent, renders a kit picker at the top of the dialog (combobox: serial + name, searchable). Also add a `cta` prop to the `EmptyState` so the empty path has the same affordance. No schema change — `createSchedule` already accepts `kit` in the payload (`maintenance.ts:18-24`).
- **Effort:** S (~0.5–1 agent-day).
- **Risk:** Low. Pure UI + reuse of existing dialog. The only nuance is searching kits from inside the dialog (debounced filter against the `kits` collection).
- **Industry parallel:** Snipe-IT lets you create a maintenance log from both the Asset detail page and a top-level "Maintenance" page that opens a global picker.
- **Dependencies:** None. Existing `AddScheduleDialog` needs a minor prop extension.

### F2. Schedule detail / records-history view

- **Problem:** Certificates are uploaded but invisible; past records can't be reviewed (Findings 3, 4).
- **Proposed change:** Click a schedule row on `/maintenance` (or on the kit detail Maintenance section) → opens a side drawer or modal "Schedule history" listing past `maintenance_records` newest-first: performed_at, performed_by, notes, and (if present) a download link / inline preview of the certificate file. Use the already-defined `listRecordsForSchedule`. Reuse existing `AttachmentList` patterns for file download.
- **Effort:** S–M (~1 agent-day).
- **Risk:** Low. Read-only view, no mutations.
- **Industry parallel:** GageList — every gauge has a "Calibration history" tab with certificate downloads. This is table-stakes for audit-grade calibration.
- **Dependencies:** None.

### F3. Surface SMTP failure to admins

- **Problem:** Reminder cron silently no-ops if SMTP isn't configured (Finding 5).
- **Proposed change:** Two-part. (a) In the test route response, return `{ skipped: "smtp_unconfigured", ... }` when all sends fail with SMTP errors so an admin running `/_test/maintenance-reminder` gets a clear signal. (b) On the Settings or Admin page, show a banner "SMTP not configured — maintenance reminders are disabled" when `$app.settings().smtp.enabled` is false. Detection can be done at app boot; surface via a `settings` endpoint or a derived health field.
- **Effort:** S (~0.5 agent-day).
- **Risk:** Low. Mostly observability.
- **Industry parallel:** Sentry banner; GitHub repo "email not verified" banner.
- **Dependencies:** None.

### F4. Edit schedule inline

- **Problem:** Wrong interval at create time forces a destructive deactivate-and-recreate (Finding 8).
- **Proposed change:** Replace the row's "Deactivate" button with a menu (Edit / Deactivate). Edit reopens `AddScheduleDialog` pre-filled. `updateSchedule` is already implemented; just needs the UI hook. **Important:** changing `interval_days` should NOT retroactively change `next_due_at` — that's tied to the most recent record. Make this explicit in the dialog ("Interval applies to next maintenance forward").
- **Effort:** S (~0.5 agent-day).
- **Risk:** Low. Watch out for stale `last_done_at` confusion — document the rule.
- **Industry parallel:** Standard CRUD ergonomics.
- **Dependencies:** None.

### F5. Bulk-apply schedule (template)

- **Problem:** 50 multimeters, same annual calibration — 50 manual creates (Finding 6).
- **Proposed change:** From `/maintenance`, "New schedule" dialog gets a toggle "Apply to multiple kits." Switches the single kit picker to a multi-select (or "all kits matching product = X"). On submit, creates N schedules atomically (or as best-effort with per-row error reporting). Optional but powerful: introduce `maintenance_schedule_templates` collection later (Phase 3) — not needed for MVP.
- **Effort:** M (~1.5–2 agent-days for batch path + error handling).
- **Risk:** Medium. Partial-failure handling. PocketBase doesn't give transactional batch creates — recommend client-side loop with progress UI + a "rollback created so far?" prompt if mid-batch failure.
- **Industry parallel:** Asset Panda's "Action" macro. Limble's "Asset Type → PM template."
- **Dependencies:** None for MVP; templates collection is a Phase 3 follow-up.

### F6. Snooze / skip-once

- **Problem:** Kit out of service still pages admins (Finding 13).
- **Proposed change:** Schedule row action "Snooze 7d / 30d / custom." Implemented as a one-off update to `next_due_at` without creating a maintenance_record. Reasoning: a snooze is "I acknowledge, push the alarm out" — NOT "this was done."
- **Effort:** S (~0.5 agent-day).
- **Risk:** Low. One field update. Audit log should record the snooze.
- **Industry parallel:** PagerDuty incident snooze.
- **Dependencies:** Audit logging (already exists per project memory).

### F7. Constrain `type` to a controlled vocabulary

- **Problem:** Free-text type → "Calib" / "Calibration" / "calibration" fragmentation in filter (Finding 12).
- **Proposed change:** Two options:
  - (a) Lightweight: Make `type` a combobox in the dialog — free-typed values get auto-suggested from existing types in the system (`SELECT DISTINCT type FROM kit_maintenance_schedules`). Doesn't enforce, but nudges.
  - (b) Heavier: Add a `maintenance_types` reference collection. New types added by admins only.
- **Effort:** S for (a), M for (b).
- **Risk:** (b) is a schema change + migration of existing strings → ids. Recommend (a) for MVP.
- **Industry parallel:** Linear labels: typeahead from existing labels but you can mint new ones.
- **Dependencies:** None for (a).

### F8. Per-component maintenance (lifting granularity)

- **Problem:** Calibration follows the gauge, not the kit (Finding 9).
- **Proposed change:** Per COMPONENT_HYPERCHARGE_IDEAS.md §4.8 — a parallel `component_maintenance_schedules` collection (copy of the existing kit pattern, swap relation). Defer until there is documented demand. The open question in §4.8 is exactly this — does this team have calibration-bearing components that move between kits?
- **Effort:** M (~2–3 agent-days).
- **Risk:** Medium-high. Doubles maintenance UI surface area; needs a unified "all maintenance" view across both kit-level and component-level so admins aren't checking two pages. Risk of architectural drift if half-built.
- **Industry parallel:** GageList (per-gauge, not per-kit).
- **Dependencies:** Demand confirmation. Open Q below.

### F9. Mobile polish for schedule actions

- **Problem:** Long scroll to maintenance section on kit detail page (Finding 10).
- **Proposed change:** On `/maintenance`, ensure the "New schedule" button is sticky-top on mobile. Confirm the existing mobile-card layout (`MaintenancePage.tsx:103-131`) renders with thumb-friendly hit areas (≥44px). Already in good shape — small audit job.
- **Effort:** S (~0.5 agent-day).
- **Risk:** None.
- **Industry parallel:** Standard mobile-first action affordance.
- **Dependencies:** None.

## 5. Phased plan

### Phase 1 — Must (fixes the user-reported gap)

Addresses Findings 1, 2, 4, 3.

- **F1** Add "New schedule" button + kit-picker on `/maintenance` (~0.5–1d)
- **F2** Schedule history drawer with certificate download (~1d)
- Extend `e2e/maintenance.spec.ts` to cover the new entry point (~0.25d)

Total: ~2–2.5 agent-days. Unblocks the reported issue and closes the certificate-write-only foot-gun in the same pass.

### Phase 2 — Should (obvious quality wins)

Addresses Findings 5, 8, 13, 12.

- **F3** Surface SMTP failure (~0.5d)
- **F4** Edit schedule inline (~0.5d)
- **F6** Snooze / skip-once (~0.5d)
- **F7(a)** Type autocomplete from existing values (~0.5d)
- **F9** Mobile audit (~0.5d)

Total: ~2.5 agent-days. Polishes the page into something an admin actually wants to live in.

### Phase 3 — Optional / industry-parity

Addresses Findings 6, 9, 14 fully.

- **F5** Bulk-apply schedule with template (~1.5–2d)
- **F8** Per-component maintenance — *only after answering Open Q 1 below*. If yes, ~2–3d. If no, drop forever.
- Schedule templates collection if F5 grows (~1d).

Total: 1–5 agent-days depending on F8 decision.

### Cross-cutting recommendation

Maintenance is now the second-most-complex feature surface after the request/transaction core, and has zero unit-tested behavior. The hooks (`maintenance_update_next_due.pb.js`, `maintenance_reminder.pb.js`) contain non-trivial date arithmetic and silent error-swallow paths. Recommend a small PocketBase integration test harness for the hooks before Phase 2 lands. Not blocking, but flagging.

## 6. NOT recommended (and why)

- **Per-component maintenance shipped speculatively (full F8 without demand signal).** The pattern would double the maintenance surface area and create two near-identical UIs. The COMPONENT_HYPERCHARGE_IDEAS doc already calls this out as "Later (unclear demand)." Wait for one concrete user story like "this torque wrench moves between kits and the calibration must follow it" before building.
- **Polymorphic `target_kit | target_component` on the existing `kit_maintenance_schedules` table.** Mentioned as option (a) in §4.8 of the ideas doc. Rejected: it migrates a working production collection for a feature with unclear demand. If F8 ever ships, the parallel-collection approach is safer.
- **Maintenance request/approval workflow** (admin requests → tech accepts → tech completes). Adds a state machine on top of an already-overloaded request system. The current "Record done" model is simple and works for a small team. Revisit if the team grows past ~5 techs.
- **Real-time maintenance dashboard / live updates.** The reminder cron is daily. No latency-sensitive use case here. PocketBase realtime would add complexity without user benefit.
- **Calendar / Gantt view of upcoming maintenance.** Tempting but premature. The status-filtered table sorted by `next_due_at` already gives a perfectly good "what's coming up." Build only if Phase 2 lands and users still ask for it.
- **Auto-generate a request to move kit into a "maintenance" entity.** Conflates two domains. Maintenance records are append-only history; the entity move is a transaction. Keep them decoupled — though a "Move kit to maintenance entity" button on the schedule row may be worth a Phase 3 ergonomics improvement.

## 7. Open questions

1. **Per-component vs per-kit demand.** Are there any specific items (calibration gauges, torque wrenches, certified meters) that move between kits and need calibration to travel with them? If yes → schedule F8 in Phase 3. If no → kill F8 from the roadmap. *Single biggest decision affecting future scope.*

2. **SMTP status.** Is SMTP actually configured in production today? If no, the reminder cron is silently dead and Phase 1 should also include a one-time setup task — not just observability.

3. **Bulk-apply scope.** When admin says "apply to all multimeters," does "multimeters" mean a `product`, a `kit_type`, or an ad-hoc multi-select? Affects F5 UI complexity.

4. **Audit retention for maintenance_records.** Calibration histories often have multi-year retention requirements (ISO 17025, FDA, etc.). Is there a regulatory floor that says "must retain 7 years"? If yes, document it and add an explicit "do not delete" guard.

5. **Snooze policy.** Should a snooze be visible to non-admin techs? Should it auto-expire? Should there be a max snooze count before forcing an action?

6. **Schedule deactivation semantics.** Today "Deactivate" sets `is_active = false`. Should the past records still be reachable somehow (history view filtered to inactive)? Currently they would orphan.

7. **Who can record maintenance?** Today the create rule on `maintenance_records` allows `admin` or `technician` and requires `performed_by = @request.auth.id` (`1778615063_add_maintenance.js:219`). Is "technician" role wired everywhere in the frontend? Worth a quick audit.
