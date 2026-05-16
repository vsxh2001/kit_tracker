---
name: setup_collections.sh has diverged from pb_migrations
description: setup_collections.sh missing components, component_transactions, audit_log entirely; migrations are de facto source of truth.
type: project
---

`pb/setup_collections.sh` (252 lines) is described in CLAUDE.md as a "secondary convenience script that is idempotent" — but it has not been kept in sync with newer migrations. It is missing:
- `components` collection
- `component_transactions` collection
- `audit_log` collection
- `kits.attachments` MIME whitelist update (migration 1778599044)
- `users.denied` role enum value is present in setup_collections.sh but migration 1778700000 is the canonical source

The shell script still covers users / entities / kits / requests / transactions / kit_maintenance_schedules / maintenance_records / on_call_shifts. Anyone running setup_collections.sh on a clean PB instance will get a half-built database. Migrations (`pb migrate up`) are now the only complete bootstrap path.

**Why:** Migrations were added for new features but the parallel shell-script schema wasn't updated. The script is referenced in CLAUDE.md and may be invoked by anyone trying to bootstrap PB without going through migrations.

**How to apply:**
- When user asks "how do I bootstrap PB?", recommend `pocketbase migrate up` (auto-runs on serve), not setup_collections.sh.
- When proposing fixes, two viable options: (a) delete setup_collections.sh and document migrations as the sole bootstrap path; (b) bring setup_collections.sh back in sync as a CI-checked invariant (lint script that diffs the two). Option (a) is simpler given the script is non-load-bearing now.
