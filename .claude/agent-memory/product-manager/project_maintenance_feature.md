---
name: Maintenance feature state (as of 2026-05-15 review)
description: Known gaps + decisions on the maintenance feature surface — what's deferred, why, and the demand signal still needed
type: project
---

The maintenance feature ships as: /maintenance hub (list + filter only, no create), per-kit AddSchedule on KitDetailPage, RecordMaintenance dialog with certificate upload, daily 8am UTC reminder cron + manual test route.

**Top gaps documented in MAINTENANCE_REVIEW.md (branch: review/maintenance-feature, SHA 284d13c):**

- P0: /maintenance has no Add Schedule entry point — creation only via per-kit page
- P1: certificate uploads are write-only (no download UI)
- P1: listRecordsForSchedule defined but never called from any component (history view missing)
- P1: SMTP reminder failure is silent (logs only)

**Decisions made:**
- Phase 1 = F1 (Add button + kit-picker) + F2 (history drawer with cert download). ~2-2.5d total.
- Per-component maintenance (COMPONENT_HYPERCHARGE_IDEAS §4.8) is DEFERRED pending demand signal — Open Q 1 in review.
- Polymorphic target on existing schedules collection is REJECTED — if F8 ever ships, use a parallel collection.
- Maintenance request/approval workflow REJECTED — current "Record done" is sufficient for small team.

**Why:** the user reported they couldn't create a schedule from /maintenance — review confirmed this is real UX gap and identified the certificate-write-only foot-gun in the same area. F1+F2 close both in one pass.

**How to apply:** If user revisits maintenance work, default to Phase 1 scope. Don't propose F8 (per-component) without the demand-signal answer to Open Q 1. The PB JS hooks contain non-trivial date arithmetic with silent error swallow — flag for testing if any work touches them.
