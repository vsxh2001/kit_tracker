---
name: Goja runtime isolation is per-file, not per-callback
description: PB v0.22 Goja isolates each .pb.js file's runtime; within ONE file, named helper functions can use $app etc. fine. Cross-file sharing is what doesn't work.
type: project
---

PB v0.22 Goja runtime isolation is **per-file**, not per-callback. Several hooks (oncall_validate, maintenance_reminder, audit_log) contain comments claiming `$app` and other globals are unavailable inside named helper functions, forcing full inlining of identical logic across 6+ hook callbacks. That claim is incorrect: `overdue_return_reminder.pb.js` proves the working pattern — it defines `function fireOverdueReminder() {...}` at file scope and calls it from both `cronAdd` and `routerAdd` callbacks, with `$app.dao()`, `findRecordsByFilter`, `MailerMessage` all working from inside the named function.

**Why:** Goja runtime isolation in PB v0.22 is at the file boundary (each .pb.js gets its own runtime per goroutine), but within a single file, top-level function declarations are scoped to the same runtime as the callbacks. Earlier reviews documented the "must inline" rule and that comment was copy-propagated.

**How to apply:**
- When proposing refactors of `audit_log.pb.js` (11 near-identical callbacks, ~387 lines) or `maintenance_reminder.pb.js` (cron + route duplicated, ~327 lines), suggest extracting helpers into file-scope functions like `overdue_return_reminder.pb.js` does.
- Do NOT propose cross-file imports (no `require()` in Goja, no shared module — that part of the comment is correct).
- Update the misleading comments in `oncall_validate.pb.js`, `maintenance_reminder.pb.js`, and `audit_log.pb.js` when fixing the duplication.
