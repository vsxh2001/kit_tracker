# Puppet Show — multi-agent demo

## What
Spins a local PB instance, seeds realistic demo data, then dispatches 4 Claude agents playing roles (admin, tech, user, viewer) to interact with the app via Playwright MCP.

## Prereqs
- Local PB binary: `./pb/pocketbase` (already in repo)
- Demo data seeded: `node scripts/seed_demo_data.mjs`
- Vite dev server running

## Quick start
```bash
# Terminal 1 — PB
PB_HTTP=127.0.0.1:8090 bash pb/start-pb.sh

# Terminal 2 — seed
./pb/pocketbase superuser create demo-admin@kit.local Pass1234!
PB_SUPERUSER_EMAIL=demo-admin@kit.local PB_SUPERUSER_PASSWORD=Pass1234! \
  node scripts/seed_demo_data.mjs

# Terminal 3 — Vite
cd frontend && echo "VITE_PB_URL=http://127.0.0.1:8090" > .env.local && npm run dev
```

## Roles (used by puppet agents)
- demo-admin-1@kit.local — admin
- demo-technician-1@kit.local + demo-technician-2@kit.local — technician
- demo-user-1@kit.local + demo-user-2@kit.local — user
- demo-viewer-1@kit.local — viewer

All passwords: `Pass1234!`

## Cleanup
```bash
PB_SUPERUSER_EMAIL=demo-admin@kit.local PB_SUPERUSER_PASSWORD=Pass1234! \
  node scripts/teardown_demo_data.mjs
```

## Notes
- Seeder is idempotent: if DEMO- records already exist, it exits without changes.
- Run teardown first to re-seed fresh data.
- Kits and entities use soft-delete (deactivated via `is_active=false`) on teardown because their PB collections have no `deleteRule`. Transactions and requests are hard-deleted using the superuser token which bypasses collection rules.
- Optional collections (`kit_maintenance_schedules`, `on_call_shifts`) are skipped with a warning if not yet created.
