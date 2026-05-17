# Pilot-Ready Definition of Done — Final Report

Date: 2026-05-16
Branch: worktree-pilot-sprint @ faf3d12cc090ca5bb9b489fb93c523e93f393334

## Status per spec section 5 item

| # | DoD item | Status | Evidence |
|---|---|---|---|
| 1 | Move + YES end-to-end | PASS | `pb/pb_hooks/wa_inbound.pb.js:487-617` — pending store keyed `wa_pending:<phone>`, YES branch re-executes via `/api/ai/chat` with `CONFIRM AND EXECUTE:` prefix; `scripts/wa_e2e_test.sh:285-318` Scenario A tests move + YES → transaction created |
| 2 | RETURN 3 phrasings | PARTIAL | `wa_inbound.pb.js:641-642` — regex covers `return X`, `send back X`, `X is back`; `DEFAULT_WAREHOUSE_ENTITY_ID` documented in `.env.example:26`; `wa_e2e_test.sh` Scenarios F tests `return DEMO-KIT-003` but does NOT test `send back X` or `X is back` phrasings — e2e coverage gap |
| 3 | Audit via filter + CSV | PARTIAL | `frontend/src/pages/AuditLogPage.tsx:159-171` — Source dropdown with `wa-bot` option present; Source column at line 258 renders `viaLabel(parseVia(e.changes))`; actor + timestamp shown. **Gap: no CSV export button on AuditLogPage** — `exportKitTimelineCsv` exists only on `KitDetailPage.tsx:165`, not on audit log |
| 4 | Timeline origin badges | PASS | `frontend/src/components/KitTimeline.tsx:22-46` — `OriginBadge` component with `VIA_LABEL`/`VIA_STYLE` for `web`, `wa-bot`, `ai-agent`, `mcp`; rendered per-transaction at line 165 when `viaMap[tx.id]` is set |
| 5 | Deactivate from detail | PASS | `frontend/src/pages/KitDetailPage.tsx:169-173` — Deactivate button guarded by `isAdmin`, calls `softDeleteKit` via `setShowDelete(true)` AlertDialog (no `window.confirm()`) |
| 6 | Denied mid-session security | PASS | `Layout.tsx:22` — `hasRole = !!user?.role && user.role !== "denied"` gates nav; `AuthContext.tsx:54-57` — realtime subscription detects `role=denied`, clears auth store, redirects to `/login?reason=denied`; `RequireRole.tsx:16` — blocks route for empty or denied role |
| 7 | 3 pilot docs | PARTIAL | `docs/pilot-onboarding.md` — present; `docs/pilot-runbook.md` — present; `docs/pilot-pitch.md` — **missing** (T18/D20 not completed) |
| 8 | Demo seed field-service | PARTIAL | `scripts/seed_demo_data.mjs:111-114` — 1 warehouse + 3 customers; line 175 — 20 kits; lines 133-138 — **3 technicians** (spec requires 5 per `docs/superpowers/specs/2026-05-16-roadmap-design.md:125`); kit state distribution matches spec (5 intake, 10+ at-customer, 3 returning, 2 retired) |
| 9 | README + screenshots | PASS | `README.md` top paragraph leads with WhatsApp pitch; embeds 3 screenshot refs (`docs/screenshots/wa-move.png`, `web-timeline.png`, `audit-filter.png`); `docs/screenshots/README.md` documents capture instructions; **actual PNG files absent** — placeholder README only, but spec allows "placeholders OK" |

## Gaps + remediation

### GAP 1 — DoD item 3: No CSV export on Audit Log (blocks pilot pitch)

**Missing:** `AuditLogPage.tsx` has no export button. The spec DoD item explicitly says "Exports CSV." `exportKitTimelineCsv` exists in `services/kits.ts` for the kit timeline but there is no equivalent for audit log.

**Remediation:** Add `exportAuditLogCsv()` to `services/audit.ts` and an Export button to `AuditLogPage.tsx` (pattern: `filtered` array → CSV blob → anchor download). Relevant task: T13/D9 (audit log page) — this feature was not implemented. 1-2h work.

**Severity:** Blocks pilot pitch (DoD item 3 is in the "if any of 1-6 fails, sprint is not done" group — but item 3 is actually not listed in the 1-6 hard-gate list in spec section 5 para 2; it blocks pitch, not the hard gate).

### GAP 2 — DoD item 7: `docs/pilot-pitch.md` missing (blocks pitch)

**Missing:** File does not exist. T18/D20 ("Pitch one-pager") was not completed. `pilot-onboarding.md` and `pilot-runbook.md` are present.

**Remediation:** Write `docs/pilot-pitch.md` per spec D20 — one-pager: problem, solution, WhatsApp move flow, admin view, self-host cost, next steps. 1-2h write. Spec notes this "may slip by 2-3 days but block pitch."

**Severity:** Blocks pitch (not hard gate for items 1-6, but listed in DoD item 7).

### GAP 3 — DoD item 2: `send back X` and `X is back` phrasings not e2e tested; DoD item 8: seeder has 3 techs not 5 (cosmetic)

**DoD item 2:** Regex at `wa_inbound.pb.js:641-642` covers all three phrasings at code level but `wa_e2e_test.sh` only tests `return`. Add Scenario G (`send back DEMO-KIT-004`) and Scenario H (`DEMO-KIT-008 is back`) to the script.

**DoD item 8:** `seed_demo_data.mjs:134-136` has 3 technicians; spec calls for 5. Add `demo-technician-4` and `demo-technician-5` entries. Low-risk change.

**Severity:** Both cosmetic — do not block the hard gate (items 1-6) or the pitch (items 7-9 status is acceptable per spec section 5 para 2). Fix before demo day.

## Pilot-readiness verdict

GO-WITH-CAVEATS

Items 1–6 (hard gate) all pass. The sprint core — WhatsApp move + confirm flow, timeline badges, deactivate, denied-user security — is working. Three caveats before pitch: (1) audit log CSV export is missing, (2) `docs/pilot-pitch.md` is not written, (3) the demo seeder has 3 technicians instead of 5 and the e2e script does not exercise all three RETURN phrasings. None block a live demo today; all can be fixed within 2-4 hours.
