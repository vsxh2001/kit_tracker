# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All frontend commands run from `frontend/`:

```bash
npm run dev        # start Vite dev server (http://localhost:5173)
npm run build      # tsc -b && vite build (type-check + bundle)
npm run lint       # ESLint
npm run test       # run full Playwright e2e suite (needs PocketBase + Vite running)
npm run test:smoke # ~18 @smoke-tagged tests, ~2 min (fast gate)
npm run test:full  # entire suite via chromium (explicit project flag)
npm run test:ci    # same as test with CI=true (retries enabled, HTML report)
npm run test:prod  # full e2e against dockerized stack via scripts/test-prod.sh
```

PocketBase (local dev):

```bash
bash pb/start-pb.sh                                  # start PocketBase (http://127.0.0.1:8090)
./pb/setup_collections.sh <email> <password>         # create/update collections via API (idempotent)
./pb/seed_test_users.sh <email> <password>           # create/update the 3 Playwright test users (PATCHes role on existing)
./pb/setup_oauth.sh <email> <password>               # enable Google OAuth provider; reads GOOGLE_OAUTH_CLIENT_ID/SECRET from env
./pb/setup_oauth.sh <email> <password> --disable     # disable Google OAuth provider
```

Override `start-pb.sh` defaults via env vars: `PB_HTTP`, `PB_DATA_DIR`, `PB_HOOKS_DIR`, `PB_MIGRATIONS_DIR`.

Docker (mirrors prod):

```bash
cp .env.example .env                     # set PB_SUPERUSER_*, optionally GOOGLE_OAUTH_*
docker compose up --build                # build + run (frontend served by PocketBase on :8090)
bash scripts/test-prod.sh                # clean down → up → seed → e2e → tear down (always teardown via EXIT trap)
bash scripts/test-prod.sh --keep         # leave stack running for debugging
```

> Run `npm install` from repo root (not just `frontend/`) to install husky pre-commit hooks.

## E2E Tests

Playwright tests live in `frontend/e2e/`. Tests need PocketBase + Vite running **before** `npm run test` (or use `test:prod` for fully dockerized run). Three test users (`logistics@kit.local` admin, `requester@kit.local` user, `viewer@kit.local` viewer, all `Pass1234!`) seeded by `seed_test_users.sh` — script is idempotent and PATCHes role if user exists with wrong role.

Tests run serially (`workers: 1`) — PocketBase is shared mutable state. Each describe block seeds + tears down its own data via `e2e/helpers/api.ts` (direct REST, no UI).

CI uses bundled Chromium. Locally uses `/usr/bin/google-chrome` (`executablePath` in `playwright.config.ts`). `playwright.config.ts` honors `PLAYWRIGHT_TEST_BASE_URL` so docker-mode points at :8090 (frontend served by PB) instead of :5173.

### Smoke vs Full

- `npm run test:smoke` — ~18 tests, ~2 min. Tagged with `@smoke` in test name. Runs on every push (CI + pre-push hook).
- `npm run test:full` — entire suite, ~18 min. Runs on PR with `full-e2e` label or nightly cron (6am UTC).
- `npm test` — alias for full suite locally.

### Pre-push hook

`.husky/pre-push` runs `lint && build && test:smoke` before every push. Bypass with `git push --no-verify` (don't, unless you really mean it).

Single spec:
```bash
npx playwright test e2e/kits.spec.ts --project=chromium
npx playwright test e2e/users.spec.ts --project=chromium --grep "admin sees Users"
```

Tests using OAuth provider auto-skip via `test.skip(!process.env.GOOGLE_OAUTH_CLIENT_ID)` so CI without creds stays green.

## Architecture

Two independent processes: PocketBase (port 8090) + Vite dev server (port 5173). Frontend talks directly to PocketBase's REST API via the JS SDK — no custom backend.

### Worktree port assignment

Multiple worktrees on the same host conflict on ports (PocketBase :8090, Vite :5173, MailHog :1025/:8025). To support parallel agent dispatch:

1. **Automatic detection:** Run `bash .claude/scripts/worktree-ports.sh` from any worktree. Outputs port assignments + writes to `.claude/ports.env`.
2. **Port registry:** `.claude/ports.json` maps worktree name → offset (0, 1, 2, …); auto-allocates next free offset on first call.
3. **Port formula:** offset N gets:
   - `PB_HOST_PORT = 8090 + (N * 2)`
   - `VITE_PORT = 5173 + N`
   - `MAILHOG_SMTP_PORT = 1025 + (N * 2)`
   - `MAILHOG_UI_PORT = 8025 + (N * 2)`

Example:
```bash
# main repo: offset 0
eval $(bash .claude/scripts/worktree-ports.sh)  # PB_HOST_PORT=8090, VITE_PORT=5173, ...

# worktree feat-mobile-responsive: offset 1
cd .claude/worktrees/feat-mobile-responsive
eval $(bash ../../scripts/worktree-ports.sh)  # PB_HOST_PORT=8092, VITE_PORT=5174, ...

# worktree feat-container-ci: offset 2
cd ../feat-container-ci
eval $(bash ../../scripts/worktree-ports.sh)  # PB_HOST_PORT=8094, VITE_PORT=5175, ...
```

**Using assigned ports:**
- `docker-compose.yml` interpolates `${PB_HOST_PORT}` etc — `docker compose up` picks the right ports automatically when env is sourced
- Local PB: `./pb/pocketbase serve --http=127.0.0.1:${PB_HOST_PORT:-8090} --dir=pb/pb_data`
- Vite: `cd frontend && npm run dev -- --port ${VITE_PORT:-5173}`
- Frontend env: If using non-default port, create `frontend/.env.local` with `VITE_PB_URL=http://127.0.0.1:${PB_HOST_PORT}`

When dispatching agents, the orchestrator reads assigned ports from `.claude/ports.json` and includes them in the brief.

### PocketBase collections

| Collection | Key fields |
|---|---|
| `users` | `name`, `role` (select: admin/user/viewer or empty) |
| `kits` | `serial` (unique), `notes`, `is_active` |
| `entities` | `name`, `type`, `is_active` |
| `transactions` | `kit`, `from_entity`, `to_entity`, `timestamp`, `notes`, `created_by`, `request` |
| `requests` | `requester`, `date`, `delivery_date` (required), `status` (open/approved/rejected/fulfilled/cancelled), `designated_kit`, `target_entity`, `notes`, `decision_notes`, `expected_return` (optional) |

**Current kit holder is derived, not stored.** Fetch the latest transaction sorted by `-timestamp,-created` and read `to_entity`. Never cache on the kit record without also ensuring every `createTransaction` call updates atomically.

**Transactions are append-only** — no update/delete rules. To correct a mistake, create a new transaction.

**Request fulfillment** (`fulfillRequest` in `services/requests.ts`) atomically creates a transaction and sets status to `fulfilled`. The two steps must stay coupled — if the transaction fails, status must not change.

**OAuth users land with empty `role`.** Role is set manually by an admin via the `/users` page (or PB admin UI for bootstrap). The `DashboardPage` shows an amber "awaiting approval" banner when `!user?.role`.

### Collection rules summary

`pb/pb_migrations/` is source of truth — migrations auto-apply on `pocketbase serve`. `setup_collections.sh` is a secondary convenience script that uses `jq` (not python3 — alpine container compat) and is idempotent.

| Collection | createRule | updateRule | deleteRule | listRule |
|---|---|---|---|---|
| `requests` | admin or user role | admin OR (owner AND status=open) | admin OR (owner AND status=open) | auth |
| `entities` | admin only | admin only | null (soft-delete via `is_active=false`) | auth |
| `kits` | admin only | admin only | null (soft-delete via `is_active=false`) | auth |
| `transactions` | auth + own created_by | null (append-only) | null (append-only) | auth |
| `users` | (PB default) | admin OR self | (PB default) | admin OR self |

`users.viewRule` is `@request.auth.id != ""` (any authenticated) so `expand: requester` works for non-admins reading requests.

### PocketBase JS hooks (`pb/pb_hooks/`)

PB v0.22 auto-loads `*.pb.js` files from the hooks dir on `serve` startup. Two hooks gate the `users` collection:

- **`role_change_check.pb.js`** — fires on user update; if `oldRole !== newRole` and the requester's role is not `"admin"`, throws `BadRequestError`. **Critical**: PB collection rules can't restrict which fields are written, so without this hook a non-admin could `PATCH users/<self> {"role":"admin"}` and self-promote.
- **`last_admin_check.pb.js`** — fires on user update; if old role was `"admin"` and new role is not, counts admins where `id != record.id` and rejects when count is 0. Counts via `findRecordsByFilter("users", "role = 'admin' && id != '<id>'", "", 0, 2)` — `limit=2` (not 0; `limit=0` is invalid in PB v0.22 and silently throws, leaving the hook a no-op).

Both hooks ship in the Docker image (Dockerfile COPYs `pb/`). Local dev: PB picks them up if `--hooksDir` points at `pb/pb_hooks/`.

### Frontend structure

```
src/
  types/index.ts          — shared types (Kit, Entity, Transaction, KitRequest, PBUser, RequestStatus)
  lib/pocketbase.ts       — single PocketBase client instance (reads VITE_PB_URL)
  lib/utils.ts            — cn(), formatDate(), formatDateOnly()
  services/               — one file per collection; ALL PB queries live here (page never imports pb directly)
  context/AuthContext.tsx — useAuth() hook; syncs with pb.authStore.onChange
  components/ui/          — Radix primitives wrapped with Tailwind (no shadcn CLI used)
  components/             — feature dialogs + Layout (sidebar nav)
  pages/                  — one file per route
```

### Routes + role gating

- `/login` — public; password form + Google OAuth button
- `/dashboard`, `/kits`, `/entities`, `/requests` (+ detail variants) — `<ProtectedRoute>` (any authenticated)
- `/users` — `<AdminOnly>` (redirects non-admin to `/`)

`isAdmin` derives from `useAuth().user?.role === "admin"`. PB rules + hooks enforce server-side; the UI gate is for UX.

### Auth flow

- Email/password: `pb.collection("users").authWithPassword(...)` via `services/auth.ts:login()`
- Google OAuth: `pb.collection("users").authWithOAuth2({ provider: "google" })` via `services/auth.ts:loginWithGoogle()`
- Both update `pb.authStore`; `AuthContext` subscribes via `onChange` — no special handling per provider

### PocketBase SDK version (CRITICAL)

`pocketbase` JS SDK is pinned to `^0.21.x` in `frontend/package.json`. PB server is **v0.22.22**. SDK v0.22+ rewrote the auth-methods response schema for v0.23+ servers — calls `/auth-methods?fields=mfa,otp,password,oauth2` and reads `response.oauth2.providers`. PB v0.22 returns `{authProviders: [...]}` at top level. Mismatch crashes OAuth with `TypeError: Cannot read properties of undefined (reading 'providers')`. Email/password is stable across versions, so the bug is OAuth-only.

**Don't bump pocketbase casually.** When upgrading PB server (migrator agent territory), bump SDK in lockstep.

**Vite restart gotcha:** swapping a pre-bundled dep version requires `pkill -f "vite.*<port>"` (kill all workers, not just the wrapper PID `npm run dev` printed) + `rm -rf node_modules/.vite` + `npm run dev -- --force`. The `?v=<hash>` query in served `pocketbase.js` URLs comes from the running module map, not disk content — same content = same hash = browser/Vite cache hit even after npm install.

### PocketBase SDK auto-cancellation (React StrictMode gotcha)

SDK auto-cancels in-flight requests sharing the same request key. StrictMode double-mounts cause the first mount's requests to be cancelled, leaving pages stuck at "Loading…".

**Every `load()` must use this pattern:**
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

**Parallel calls to same endpoint** (e.g. `getLatestTransaction` for N kits) must pass unique `requestKey` per call:
```ts
pb.collection("transactions").getList(1, 1, {
  filter: `kit = "${kitId}"`,
  requestKey: `latest-tx-${kitId}`,
});
```

### CSS variables / theming

`frontend/src/index.css` defines all shadcn CSS variables. Every variable referenced in `components/ui/` must be declared there — missing ones render as transparent (e.g. missing `--popover` makes Select dropdowns invisible). Palette: indigo primary (`243 75% 58%`), off-white background (`220 16% 96%`), white cards.

### Adding a new Radix/UI component

Radix packages are installed individually (no shadcn CLI). Follow the pattern in `components/ui/` — import the Radix primitive, wrap with `cn()` + Tailwind, `forwardRef` where needed.

### Environment

`frontend/.env` (copy from `.env.example`):
```
VITE_PB_URL=http://127.0.0.1:8090
```

Repo-root `.env` (Docker — copy from `.env.example`):
```
PB_SUPERUSER_EMAIL=admin@example.com
PB_SUPERUSER_PASSWORD=changeme123
GOOGLE_OAUTH_CLIENT_ID=             # optional — enables OAuth provider when set
GOOGLE_OAUTH_CLIENT_SECRET=         # optional
#GOOGLE_OAUTH_DISABLE=              # set to 1 to actively disable provider
```

Container only runs `setup_oauth.sh` when both CLIENT_ID + SECRET are set. Setting only one logs a warning and skips. `GOOGLE_OAUTH_DISABLE=1` flips `googleAuth.enabled=false` via the `--disable` flag on setup_oauth.sh.

### Docker container notes

- Alpine base — uses `jq` (not python3) for JSON parsing in shell scripts
- `docker-entrypoint.sh` is idempotent across restarts: admin create filters duplicate-error stderr, setup scripts are PATCH-not-create
- `pocketbase migrate up` runs before `serve` — migrations apply on every container start
- Container serves frontend bundle as static files via PB on :8090 (no separate Vite container in prod)
- Health: `curl -f http://localhost:8090/api/health`
- Hooks: PB serves with `--hooksDir=/app/pb/pb_hooks` so `*.pb.js` autoload

### CI (`.github/workflows/`)

- `ci.yml` — runs on PRs + push: lint + tsc + vite build + Docker image build + e2e (PB-on-host fast path; OAuth gracefully skipped via env-var guard in `oauth.spec.ts`)
- `deploy.yml` — runs on push to main: deploys to Fly.io. Requires `FLY_API_TOKEN` GitHub secret (not configured by default).

## Deployment

### First-boot identity

PB has two identity stores: `_superusers` (panel `/_/`) and `users` (app `/login`).
Without configuration these are separate.

This container auto-creates an app user matching `PB_SUPERUSER_EMAIL` with `role=admin`
on first boot via `pb/bootstrap_app_admin.sh`. You can sign in to both `/_/` (PB panel)
and `/login` (app) with the same credentials.

Test users (`logistics@kit.local` etc, password `Pass1234!`) are seeded ONLY when
`SEED_TEST_USERS=1`. CI sets it; prod does NOT — test passwords stay out of prod.

Target: Fly.io. App name: `kit-tracker` (in `fly.toml`). Region: fra (Frankfurt, closest to Israel). PocketBase + SQLite on persistent `pb_data` volume.

### Prerequisites (one-time setup)

```bash
# 1. Fly account + CLI
brew install flyctl          # macOS; see https://fly.io/docs/hands-on/install-flyctl/ for other OS
flyctl auth login

# 2. Create app + volume
flyctl apps create kit-tracker
flyctl volumes create pb_data --size 1 --region fra

# 3. Set production secrets
flyctl secrets set PB_SUPERUSER_EMAIL=<your-admin-email>
flyctl secrets set PB_SUPERUSER_PASSWORD=<strong-password>

# 4. Optional: Google OAuth (if configured)
# Get credentials from https://console.cloud.google.com/apis/credentials
# Add to Google Console first (step 5 below):
# - Authorized JS origins: https://kit-tracker.fly.dev
# - Redirect URIs: https://kit-tracker.fly.dev/api/oauth2-redirect
#
# Then set in Fly:
flyctl secrets set GOOGLE_OAUTH_CLIENT_ID=<from client_secret.json>
flyctl secrets set GOOGLE_OAUTH_CLIENT_SECRET=<from client_secret.json>

# 5. GitHub Action deploy token
flyctl auth token            # copy the token
# Then: GitHub repo → Settings → Secrets and variables → Actions → New repository secret
# Name: FLY_API_TOKEN
# Value: <paste token>

# 6. Update Google OAuth Console (when OAuth is enabled)
# https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client IDs
# Add Authorized JS origins: https://kit-tracker.fly.dev
# Add Redirect URIs: https://kit-tracker.fly.dev/api/oauth2-redirect
```

### Deploy

Auto: every push to main triggers `.github/workflows/deploy.yml` (requires `FLY_API_TOKEN` secret).

Manual:
```bash
flyctl deploy --remote-only
```

### Monitor + Logs

```bash
flyctl status                # check app status
flyctl logs -f               # tail logs (Ctrl+C to exit)
flyctl scale count 1         # ensure at least 1 machine running
```

### Rollback

```bash
flyctl releases              # list past releases with timestamps
flyctl releases rollback     # rollback to previous release
# OR revert via Git + re-deploy
```

### Backup pb_data

PocketBase data lives on the `pb_data` volume (SQLite + logs). **Always snapshot before risky migrations.**

```bash
# One-liner backup (uses scripts/backup-pb-data.sh):
bash scripts/backup-pb-data.sh

# Output: backups/pb-snapshot-YYYYMMDD-HHMMSS.tar.gz
```

To restore from a snapshot:
```bash
# List current backups
ls -lh backups/pb-snapshot-*.tar.gz

# SSH into the app machine
flyctl ssh console

# Clear old data (carefully!)
rm -rf /app/pb_data/*

# Extract backup
cd /app/pb_data
tar xzf /tmp/pb-snapshot-YYYYMMDD-HHMMSS.tar.gz

# Restart PocketBase (exit SSH, then)
flyctl restart
```

## Agent system (`.claude/agents/`)

11 specialist agents declared in `.claude/agents/*.md` with frontmatter `tools:` (capability cap) + `allowed_paths:` (lane glob). `.claude/agents/TEAM.md` is the orchestrator playbook (brief templates per agent, workflow patterns, parallelism rules).

`.claude/hooks/agent-scope-audit.sh` fires on `SubagentStop`, diffs the agent's commit against base, flags out-of-lane edits via `systemMessage` to the orchestrator. Doesn't block — agents can find legit bugs outside lane (and have); the warning surfaces to enable cherry-pick decisions.

When dispatching: tight brief beats vague brief. Match agent type to the work. Max 3 parallel agents (context overhead defeats the benefit beyond that).

## Demo / Puppet Show

Realistic demo data for local demos, load testing, and multi-agent puppet shows.

### Scripts
- `scripts/seed_demo_data.mjs` — creates DEMO- prefixed records across all core collections
- `scripts/teardown_demo_data.mjs` — removes/deactivates all DEMO- prefixed records
- `scripts/puppet_show.md` — full puppet show runbook

### Quick start
```bash
# Install script deps (one-time)
npm install --prefix scripts

# Seed
PB_URL=http://127.0.0.1:8090 \
  PB_SUPERUSER_EMAIL=<email> PB_SUPERUSER_PASSWORD=<pass> \
  node scripts/seed_demo_data.mjs

# Teardown
PB_URL=http://127.0.0.1:8090 \
  PB_SUPERUSER_EMAIL=<email> PB_SUPERUSER_PASSWORD=<pass> \
  node scripts/teardown_demo_data.mjs
```

### Demo users (all password `Pass1234!`)
| Email | Role |
|---|---|
| demo-admin-1@kit.local | admin |
| demo-technician-1@kit.local | technician |
| demo-technician-2@kit.local | technician |
| demo-user-1@kit.local | user |
| demo-user-2@kit.local | user |
| demo-viewer-1@kit.local | viewer |

### Notes
- Seeder is idempotent: exits if DEMO- entities already exist.
- Kits/entities use soft-delete (`is_active=false`) on teardown; other collections hard-deleted via superuser token.
- Optional collections (`kit_maintenance_schedules`, `on_call_shifts`) skipped with warning if not present.
