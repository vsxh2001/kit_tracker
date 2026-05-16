# Maintenance Schedule — Controlled Type Vocabulary

Status: **APPROVED — ready for implementation**
Date: 2026-05-17
Owner: hadassi
Context: MAINTENANCE_REVIEW.md F7 + puppet finding B-E1-1.

## 1. Goal

Replace the free-text `type` field on `kit_maintenance_schedules` with a `select` of controlled values. Closes the inconsistent-typing problem ("Battery check" vs "battry chk" vs "calibration" all entered for the same intent) and surfaces a proper dropdown in UI.

## 2. Scope

### In scope

- Migration: change `kit_maintenance_schedules.type` from text → select with values `["calibration", "inspection", "service", "replacement", "certification", "other"]`. Backfill existing rows: lowercase trim → match into known values; unmatched → `"other"`.
- `AddScheduleDialog.tsx`: replace text input with Radix Select dropdown.
- `MaintenancePage.tsx`: ensure the "Type" column renders the value as a label (already does — verify).
- `KitDetailPage.tsx` maintenance section: same — verify.
- Type definition for the schedule type enum in `frontend/src/types/index.ts`.
- E2E: update maintenance.spec.ts to use the Select pattern instead of typing text.

### Out of scope

- Per-team custom vocabulary (not pilot scope).
- Migration of historical maintenance_records (records reference type via schedule FK, not directly).
- F2 (schedule detail view), F3 (SMTP failure), F4 (edit inline) — separate sprints.

## 3. Implementation

### Single task — MTV-T1

1. **New migration** `pb/pb_migrations/<ts>_maintenance_type_select.js`:
   - `findCollectionByNameOrId("kit_maintenance_schedules")`
   - Backfill `type` to one of the known values (run UPDATE statements per known prefix match)
   - Change field type from `text` to `select` with the 6 values
   - DOWN: revert to text

2. **Frontend type**: `frontend/src/types/index.ts`:
   ```typescript
   export type MaintenanceType = "calibration" | "inspection" | "service" | "replacement" | "certification" | "other";
   ```

3. **AddScheduleDialog.tsx**: replace `<Input value={type} onChange={...}>` with `<Select value={type} onValueChange={...}>`. Default empty + require selection before submit (existing validation handles this).

4. **EditScheduleDialog.tsx** (if exists; else add edit-in-MaintenancePage row): same Select pattern.

5. **E2E `frontend/e2e/maintenance.spec.ts`**: replace `await page.getByLabel("Type").fill("Calibration")` with `await page.getByLabel("Type").click(); await page.getByRole("option", { name: /calibration/i }).click();`

6. Verify locally: `npm run lint && npm run build && npx playwright test e2e/maintenance.spec.ts --project=chromium -g "@smoke"`

7. Commit `feat(maintenance): controlled type vocab (calibration/inspection/service/replacement/certification/other)` + push.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Existing rows have free-text values that don't match the 6 enum entries | Backfill in migration uses prefix-match fallback to `"other"`; no data loss |
| External integrations (AI chat tools etc.) hardcode a specific type string | `ai_chat.pb.js` tool list includes `create_maintenance_schedule`? — verify in lane. If it pre-validates, update to the enum |
| Pilot users mid-flight when migration runs | Pilot is small + migration is non-destructive (text → select with backfill); explicit "deploy during low-traffic window" note in pilot-runbook is sufficient |

## 5. Done

- [ ] Migration up + down both work on a fresh DB AND on a DB with existing free-text rows
- [ ] AddScheduleDialog Type field is a dropdown
- [ ] Build clean, lint clean
- [ ] @smoke test for maintenance passes
- [ ] PR opened
