# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend commands run from `frontend/`:

```bash
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # tsc -b && vite build (type-check + bundle)
npm run lint      # ESLint
npm run test      # run Playwright e2e suite (needs PocketBase + Vite running)
npm run test:ci   # same with CI=true (retries enabled, HTML report)
```

PocketBase:

```bash
./pb/pocketbase serve --dir=pb/pb_data              # start PocketBase (http://127.0.0.1:8090)
./pb/setup_collections.sh <email> <password>         # create/update collections via API
./pb/seed_test_users.sh <email> <password>           # create the 3 Playwright test users
```

Docker (local deployment):

```bash
cp .env.example .env                     # set PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD
docker compose up --build                # build + run (frontend served by PocketBase on :8090)
```

> **Note:** Run `npm install` from repo root (not just `frontend/`) to install husky pre-commit hooks.

## E2E Tests

Playwright tests live in `frontend/e2e/`. Tests require both PocketBase and Vite running **before** `npm run test`. The three test users (`logistics@kit.local`, `requester@kit.local`, `viewer@kit.local`, all `Pass1234!`) must exist — run `seed_test_users.sh` once.

Tests run serially (`workers: 1`) because PocketBase is shared mutable state. Each describe block seeds and tears down its own data using helpers in `e2e/helpers/api.ts` (direct PocketBase REST calls, no UI).

On CI, Playwright uses the bundled Chromium. Locally it uses `/usr/bin/google-chrome` (`executablePath` in `playwright.config.ts`).

Run a single spec file:
```bash
npx playwright test e2e/kits.spec.ts --project=chromium
```

## Architecture

Two independent processes: PocketBase (port 8090) and Vite dev server (port 5173). Frontend talks directly to PocketBase's REST API via the official JS SDK — no custom backend.

### PocketBase collections

| Collection | Key fields |
|---|---|
| `users` | `name`, `role` (select: admin/user/viewer) |
| `kits` | `serial` (unique), `notes`, `is_active` |
| `entities` | `name`, `is_active` |
| `transactions` | `kit`, `from_entity`, `to_entity`, `timestamp`, `notes`, `created_by`, `request` |
| `requests` | `requester`, `date`, `delivery_date` (required), `status` (open/approved/rejected/fulfilled/cancelled), `designated_kit`, `target_entity`, `notes`, `decision_notes`, `expected_return` (optional) |

**Current kit holder is derived, not stored.** Fetch the latest transaction sorted by `-timestamp,-created` and read `to_entity`. Never cache this on the kit record without also ensuring every `createTransaction` call updates it atomically.

**Transactions are append-only** — no update/delete rules. To correct a mistake, create a new transaction.

**Request fulfillment** (`fulfillRequest` in `services/requests.ts`) atomically creates a transaction and sets status to `fulfilled`. These two steps must stay coupled — if the transaction fails, the status must not change.

### Collection rules summary

`pb/pb_migrations/` is the source of truth — migrations auto-apply on `pocketbase serve`. `setup_collections.sh` is a secondary convenience script.

| Collection | createRule | updateRule | deleteRule |
|---|---|---|---|
| `requests` | admin or user role | admin OR (owner AND status=open) | admin OR (owner AND status=open) |
| `entities` | admin only | admin only | null (soft-delete via `is_active=false`) |
| `kits` | admin only | admin only | null (soft-delete via `is_active=false`) |
| `transactions` | auth + own created_by | null (append-only) | null (append-only) |
| `users` | (PB default) | (PB default) | (PB default) — viewRule: any authenticated user |

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

Role checks (`isAdmin`, `user.role` from `useAuth()`) hide/show UI elements. PocketBase collection rules enforce the same constraints server-side. `role` is set manually in PocketBase admin UI — not auto-assigned on signup.

### PocketBase SDK auto-cancellation (React StrictMode gotcha)

The SDK auto-cancels in-flight requests sharing the same request key. React StrictMode double-mounts cause the first mount's requests to be cancelled, leaving pages stuck at "Loading…".

**Every `load()` function must use this pattern:**
```ts
async function load() {
  setLoading(true);
  try {
    setData(await pb.collection(...).getFullList(...));
  } catch (err: any) {
    if (!err?.isAbort) console.error(err);
  } finally {
    setLoading(false);
  }
}
```

**When calling the same endpoint in parallel** (e.g. `getLatestTransaction` for N kits), pass a unique `requestKey` per call or the SDK cancels all but the last:
```ts
pb.collection("transactions").getList(1, 1, {
  filter: `kit = "${kitId}"`,
  requestKey: `latest-tx-${kitId}`,
});
```

### CSS variables / theming

`frontend/src/index.css` defines all shadcn CSS variables. Every variable referenced in `components/ui/` must be declared there — missing ones render as transparent (e.g. missing `--popover` makes Select dropdowns invisible). Current palette: indigo primary (`243 75% 58%`), off-white background (`220 16% 96%`), white cards.

### Adding a new Radix/UI component

Radix packages are installed individually (no shadcn CLI). Follow the pattern in `components/ui/` — import the Radix primitive, wrap with `cn()` and Tailwind, `forwardRef` where needed.

### Environment

`frontend/.env` (copy from `.env.example`):

```
VITE_PB_URL=http://127.0.0.1:8090
```

For Docker, `.env` at repo root sets `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` (see `.env.example`).
