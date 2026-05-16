---
name: PB filter string concatenation anti-pattern
description: Recurring use of string concatenation when building PocketBase filter expressions inside hooks; always use {:name} placeholders
type: project
---

PocketBase's `dao.findRecordsByFilter` and `dao.findFirstRecordByFilter` support `{:placeholder}` binding via a trailing `dbx.Params` argument (see pb_data/types.d.ts line 12440-12466). The frontend `services/` layer uses `pb.filter("k = {:v}", { v })` consistently. Hooks have repeatedly drifted to raw string concatenation, e.g.:

- pb/pb_hooks/last_admin_check.pb.js:28 — `"role = 'admin' && id != '" + e.record.id + "'"`
- pb/pb_hooks/components_validate.pb.js:86 — `"component = '" + componentId + "'"`

**Why:** Currently NOT exploitable because PB validates relation IDs against existing records before the before-create hook runs (so the injected value is constrained to existing 15-char IDs). But it is fragile — a single regression in PB's relation validation, or a future hook reading a non-relation user-controllable field this way, becomes a live SQL/filter injection. The frontend pattern uses placeholders consistently; hooks must do the same.

**How to apply:** When reviewing or writing PB hooks, treat any `findRecordsByFilter` or `findFirstRecordByFilter` with `+` concatenation as a P2 finding even if the input source seems "trusted". Required rewrite: pass values via the `dbx.Params` argument as `{name: value}`. Same for any future `dao.db().*` raw SQL.
