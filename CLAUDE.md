# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend commands run from `frontend/`:

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # tsc -b && vite build (use this to type-check + bundle)
npm run lint      # ESLint
```

PocketBase:

```bash
./pb/pocketbase serve                              # start PocketBase (http://127.0.0.1:8090)
./pb/setup_collections.sh <email> <password>       # create collections via API (run once)
```

No test suite exists yet.

## Architecture

Two independent processes: PocketBase (port 8090) and Vite dev server (port 5173). The frontend talks directly to PocketBase's REST API via the official JS SDK — no custom backend.

### PocketBase collections

| Collection | Key fields |
|---|---|
| `users` | `name`, `role` (select: admin/user/viewer) |
| `kits` | `serial` (unique), `notes`, `is_active` |
| `entities` | `name`, `type` (person/team/lab/storage/customer/maintenance/other), `is_active` |
| `transactions` | `kit`, `from_entity`, `to_entity`, `timestamp`, `notes`, `created_by`, `request` |
| `requests` | `requester`, `date`, `status` (open/approved/rejected/fulfilled/cancelled), `designated_kit`, `target_entity`, `notes`, `decision_notes` |

**Current kit holder is derived, not stored.** For any kit, fetch the latest transaction sorted by `-timestamp,-created` and read `to_entity`. Never cache this on the kit record without also ensuring every `createTransaction` call updates it atomically.

**Transactions are append-only** — no update/delete rules in PocketBase. To correct a mistake, create a new transaction.

**Request fulfillment** (`fulfillRequest` in `services/requests.ts`) atomically creates a transaction and sets status to `fulfilled`. These two steps must stay coupled — if the transaction fails, the status must not change.

### Frontend structure

```
src/
  types/index.ts          — all shared TypeScript types (Kit, Entity, Transaction, KitRequest, PBUser)
  lib/pocketbase.ts       — single PocketBase client instance (reads VITE_PB_URL)
  lib/utils.ts            — cn() (tailwind-merge + clsx), formatDate(), formatDateOnly()
  services/               — one file per collection; all PocketBase queries live here
  context/AuthContext.tsx — useAuth() hook; syncs with pb.authStore.onChange
  components/ui/          — unstyled Radix primitives wrapped with Tailwind (no shadcn CLI used)
  components/             — feature dialogs (MoveKitDialog, KitFormDialog, EntityFormDialog, RequestFormDialog)
  pages/                  — one file per route
```

### Role enforcement

Role checks (`isAdmin` from `useAuth()`) hide/show UI elements. PocketBase collection rules enforce the same constraints server-side. The `role` field lives on the `users` collection and must be set manually in the PocketBase admin UI — it is not auto-assigned on signup.

### Adding a new Radix/UI component

Radix packages are installed individually (no shadcn CLI). Follow the pattern in `components/ui/` — import the Radix primitive, wrap with `cn()` and Tailwind classes, `forwardRef` where needed.

### Environment

`frontend/.env` (copy from `.env.example`):

```
VITE_PB_URL=http://127.0.0.1:8090
```
