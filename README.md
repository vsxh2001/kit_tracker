# Kit Tracker

A self-hosted web app for tracking physical equipment — who holds each kit, its full movement history, and requests to borrow or transfer kits. Built on PocketBase (Go + SQLite) with a React/TypeScript frontend.

## Screenshots

_Screenshots coming soon._

## Features

- Track kits by serial number; current holder is always derived from the latest transaction
- Entities (labs, teams, people, storage locations) as named holders
- Append-only transaction log — no history is ever lost
- Request workflow: users submit requests, admins approve/reject/fulfill
- Role-based access: admin, user, viewer
- PocketBase built-in auth (email/password); admin UI at `/_/`
- Docker and Fly.io deployment support

## Quick Start (dev)

**Prerequisites:** Node 18+, PocketBase binary at `pb/pocketbase`

```bash
# Terminal 1 — backend
./pb/pocketbase serve

# Terminal 2 — frontend
cd frontend
cp .env.example .env        # default: VITE_PB_URL=http://127.0.0.1:8090
npm install
npm run dev                 # http://localhost:5173
```

## First-Time Setup

After starting PocketBase for the first time:

1. **Create collections** — run the setup script with a superuser account:
   ```bash
   ./pb/setup_collections.sh admin@example.com yourpassword
   ```
   This creates all required collections with their fields and rules.

2. **Create the first admin user** — sign up through the app or PocketBase admin UI (`http://127.0.0.1:8090/_/`), then manually set `role = admin` on that user record in the admin UI.

3. **(Optional) Seed test users:**
   ```bash
   ./pb/seed_test_users.sh admin@example.com yourpassword
   ```

> The `role` field is not auto-assigned on signup. Every new user defaults to no role and must be assigned one manually.

## Docker Deployment

```bash
# Copy and edit environment file
cp .env.example .env
# Set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD in .env

docker compose up --build   # build image and start
docker compose down         # stop
```

Data persists in the `pb_data` Docker volume. The app is available at `http://localhost:8090`.

After the first run, execute the collection setup against the running container:

```bash
./pb/setup_collections.sh admin@example.com yourpassword
```

## Fly.io Deployment

1. Install [flyctl](https://fly.io/docs/getting-started/installing-flyctl/) and log in.
2. Edit `fly.toml` — replace the `app` name with your own:
   ```toml
   app = "your-app-name"
   ```
3. Create the app and a persistent volume:
   ```bash
   fly apps create your-app-name
   fly volumes create pb_data --size 1 --region iad
   ```
4. Set secrets:
   ```bash
   fly secrets set PB_SUPERUSER_EMAIL=admin@example.com PB_SUPERUSER_PASSWORD=changeme123
   ```
5. Deploy:
   ```bash
   fly deploy
   ```
6. After the first deploy, run the collection setup against your live instance:
   ```bash
   ./pb/setup_collections.sh admin@yourapp.fly.dev yourpassword
   ```

The `fly.toml` configures auto-stop/start machines and a mounted volume for `pb_data`.

## Roles & Permissions

| Role | Capabilities |
|---|---|
| `admin` | Create/edit kits and entities, move kits, approve/reject/fulfill requests, full transaction history |
| `user` | Submit requests, view kits, entities, and transactions |
| `viewer` | Read-only access to all data |

Roles are enforced both in the UI (elements are shown/hidden) and in PocketBase collection rules server-side.

## Data Model

| Collection | Key fields |
|---|---|
| `users` | `name`, `role` (admin / user / viewer) |
| `kits` | `serial` (unique), `notes`, `is_active` |
| `entities` | `name`, `type` (person / team / lab / storage / customer / maintenance / other), `is_active` |
| `transactions` | `kit`, `from_entity`, `to_entity`, `timestamp`, `notes`, `created_by`, `request` |
| `requests` | `requester`, `date`, `status` (open / approved / rejected / fulfilled / cancelled), `designated_kit`, `target_entity`, `notes`, `decision_notes` |

**Key invariants:**

- Current kit holder = `to_entity` of the latest transaction (sorted by `-timestamp,-created`). Never stored directly on the kit record.
- Transactions are append-only. Corrections are new transactions, not edits.
- Request fulfillment atomically creates a transaction and sets status to `fulfilled`. These two steps are always coupled.

## Development Notes

### Frontend structure

```
frontend/src/
  types/index.ts          — shared TypeScript types
  lib/pocketbase.ts       — single PocketBase client instance
  lib/utils.ts            — cn(), formatDate(), formatDateOnly()
  services/               — one file per collection; all PocketBase queries
  context/AuthContext.tsx — useAuth() hook
  components/ui/          — Radix primitives wrapped with Tailwind
  components/             — feature dialogs
  pages/                  — one file per route
```

### E2E tests

Playwright tests live in `e2e_workflows.mjs`. They require both PocketBase and the Vite dev server to be running:

```bash
./pb/pocketbase serve &
cd frontend && npm run dev &
npm test                    # runs from repo root
```

### CI/CD (GitHub Actions)

- **`ci.yml`**: lint → type-check + build → Docker build → Playwright e2e on every push/PR
- **`deploy.yml`**: deploys to Fly.io on push to `main` — requires `FLY_API_TOKEN` repository secret

### PocketBase SDK + React StrictMode

The PocketBase JS SDK auto-cancels in-flight requests sharing the same key. In React StrictMode (double-mount), this can leave pages stuck at "Loading…". Every `load()` function must catch `isAbort` errors silently and pass a unique `requestKey` for parallel requests to the same endpoint.
