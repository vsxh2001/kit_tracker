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

## Hook tests

PB JS hook tests live in `tests/hooks/*.test.js` (vitest, run from repo root via `npm run test:hooks`). The harness (`tests/hooks/_helper.js`) boots an ephemeral PB on a random port with the real `pb/pb_hooks` + `pb/pb_migrations`, seeds a superuser + app admin (`admin@hook-test.local`/`Adminpass1!`), and tears down its data dir. CI runs them in the `hook-tests` job (downloads the PB binary, `npm ci` at root, `npm run test:hooks`).

**Gotchas when adding a hook test:**
- Hooks that gate fields by caller role (e.g. `components_validate.pb.js`'s REST field guard) reject the **superuser panel token** — it has no `users.role`. Authenticate as the seeded app admin via `authUser(...)` instead of using `pb.suToken`.
- `components.serial` uniqueness is scoped to `is_active = 1` (migration `1780100000`), matching `kits`/`entities` behavior — soft-deleted component serials can be reused by new active records.
- `_smoke.test.js` syntax-checks every `pb/pb_hooks/*.pb.js` and asserts PB boots the full hooks dir with no load failure. PB starts even when a hook throws at load (it logs `Failed to execute <file>:` + the JS error), so the smoke test scans boot output for those markers. Add a real test alongside any new hook; the smoke test only catches load/parse failures, not logic bugs.

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

**`kits.is_active` defaults to `false` in PocketBase schema.** `createKit()` in `services/kits.ts` always sets `is_active: true` as a defensive default. When creating kits via raw REST (e.g. seed scripts), set `is_active: true` explicitly or kits will be invisible in the UI until activated.

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

**`findRecordsByFilter` arg order:** signature is `findRecordsByFilter(collection, filter, sort, limit, offset, params)` — `limit` is the 4th arg, `offset` is the 5th. Swapping them (`limit=0, offset=N`) silently returns `[]` in PB v0.22 with no visible error, making the hook a no-op. Only literal `0` at position 4 paired with a positive integer at position 5 is the anti-pattern — variable references at position 4 are allowed. `scripts/audit-find-records.mjs` scans all `pb/pb_hooks/*.pb.js` for this pattern and runs in the `hook-tests` CI job as a mechanical guard.

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

### PocketBase SDK version (CRITICAL — DO NOT BUMP WITHOUT SERVER UPGRADE)

`pocketbase` JS SDK is pinned to `^0.21.5` (the latest v0.21.x patch) in `frontend/package.json`. PB server is **v0.22.22**.

**Why we can't bump the SDK alone:** SDK `v0.22.0+` is explicitly documented as "works only with PocketBase v0.23.0+" (see [js-sdk CHANGELOG](https://github.com/pocketbase/js-sdk/blob/master/CHANGELOG.md)). The v0.22 SDK rewrote `listAuthMethods()` to read `response.oauth2.providers`. PB server v0.22 returns the old shape `{authProviders: [...]}`, so SDK v0.22+ gets `oauth2: undefined`. Critically, `authWithOAuth2()` calls `listAuthMethods()` INTERNALLY, so OAuth crashes with `TypeError: Cannot read properties of undefined (reading 'providers')` the moment a user clicks the Google button. Empirically verified 2026-05-17 with SDK v0.22.1 against server v0.22.22. Email/password still works because it bypasses the auth-methods discovery path.

The defensive-reader fix at the call site does NOT help — the crash is inside the SDK's pre-flight discovery call, not in user code.

**Upgrade path:** SDK and server MUST be bumped together. v0.23+ requires a server migration (admins → `_superusers` collection, schema → fields rename, etc.). Treat as a single migrator-agent sprint — never bump the SDK alone.

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

### Email notifications setup

PocketBase v0.22 stores mail settings in the DB (not env). `pb/bootstrap_smtp.sh` reads the
following Fly secrets and PATCHes `/api/settings` on every boot. If `SMTP_HOST` is not set the
script exits silently (local dev without SMTP stays unaffected).

```bash
flyctl secrets set -a kit-tracker \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=587 \
  SMTP_USERNAME=your@gmail.com \
  SMTP_PASSWORD=<gmail-app-password> \
  SMTP_FROM=your@gmail.com
```

> **Gmail App Password:** requires 2FA enabled on the Google account.
> Generate one at <https://myaccount.google.com/apppasswords> (16-char password, no spaces).
> Do NOT use the Google account's main password — it won't work with SMTP AUTH.

`SMTP_TLS` defaults to `true` (correct for port 587 STARTTLS). Set `SMTP_TLS=false` only for
unauthenticated relay (e.g. MailHog on port 1025 in local dev).

### WhatsApp Meta Cloud API setup

Hook: `pb/pb_hooks/wa_meta_webhook.pb.js` (Phase 1 — side-by-side with Twilio).

**Fly secrets required:**

```bash
flyctl secrets set -a kit-tracker \
  WHATSAPP_VERIFY_TOKEN=<random-string>        \
  WHATSAPP_PHONE_NUMBER_ID=1059995567204667    \
  WHATSAPP_TOKEN=<bearer-token-from-meta>      \
  WHATSAPP_WABA_ID=1012217101334902            \
  WHATSAPP_APP_SECRET=<app-secret-from-meta>
```

- `WHATSAPP_VERIFY_TOKEN` — arbitrary random string; must match what you enter in the Meta
  Developer Console webhook configuration. Generate with `openssl rand -hex 20`.
- `WHATSAPP_PHONE_NUMBER_ID` — found in Meta Business Suite → WhatsApp → API Setup
  (e.g. `1059995567204667`).
- `WHATSAPP_TOKEN` — permanent system-user access token from Meta Business Suite.
- `WHATSAPP_WABA_ID` — WhatsApp Business Account ID, found in Meta Business Suite → Business settings
  (e.g. `1012217101334902`). Used by `/api/wa/admin/status` to list subscribed apps.
- `WHATSAPP_APP_SECRET` — Meta App Secret for `X-Hub-Signature-256` POST verification.
  Found in Meta Developer Console → App Settings → Basic → App Secret. Set in prod to
  reject spoofed webhook POSTs. If not set, signature check is skipped with a warning.
  For local dev without this secret, set `WA_SKIP_SIGNATURE_CHECK=1` in PocketBase env.

**Admin settings page** (`/settings/whatsapp`):
- Admin-only route — non-admins redirect to `/dashboard`.
- Displays: phone number + quality rating, token type + expiry countdown, webhook URL + last inbound, WABA subscribed apps.
- Hook: `pb/pb_hooks/wa_meta_status.pb.js` — endpoint `GET /api/wa/admin/status`.

**Webhook URL** (register in Meta Developer Console → WhatsApp → Configuration):
```
https://kit-tracker.fly.dev/api/wa/meta/webhook
```
Subscribe to the `messages` field. Verification uses the GET handler that echoes `hub.challenge`.

### Local webhook testing

Replay a Meta-shaped POST against the webhook without needing a real WhatsApp message:

```bash
# Against local PB (default):
bash scripts/wa-meta-replay.sh --body "where is kit 1"

# Against prod:
bash scripts/wa-meta-replay.sh --url https://kit-tracker.fly.dev/api/wa/meta/webhook --body "where is kit 1"
```

The script POSTs a Meta-spec-compliant payload. Hook logs (`fly logs`) will show `[wa_meta] inbound` etc, then the response (or token-expired errors). Faster iteration than waiting for real WhatsApp delivery.

**Phases:**
- Phase 1 (this PR): Meta path added side-by-side; Twilio (`wa_inbound.pb.js`) unchanged.
- Phase 4: Twilio deprecated, `wa_inbound.pb.js` removed.

Read tokens at runtime via `$os.getenv("WHATSAPP_*")` — never hardcoded.

### Telegram group digest

Hook: `pb/pb_hooks/tg_group_digest.pb.js` — posts a daily HTML digest to a Telegram group chat.

**Fly secrets required:**

```bash
flyctl secrets set -a kit-tracker \
  TELEGRAM_BOT_TOKEN=<token-from-BotFather>    \
  TELEGRAM_GROUP_CHAT_ID=<negative-number>
```

- `TELEGRAM_BOT_TOKEN` — create a bot via [@BotFather](https://t.me/BotFather) (`/newbot`); copy the token it returns.
- `TELEGRAM_GROUP_CHAT_ID` — add the bot to the target group, then call `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id` (a negative integer for groups).
- `TG_DIGEST_CRON` — optional cron expression for the scheduled job (default `0 8 * * *` — daily 08:00 UTC).

**Digest content:** open requests, overdue returns, maintenance due in the next 7 days. If all three are empty the message is "✅ All clear — no open requests, overdue returns, or maintenance due."

**Manual trigger** (admin only):

```bash
curl -X POST https://kit-tracker.fly.dev/api/tg/digest/run \
  -H "Authorization: <admin-PB-token>"
# Returns: { "sent": true, "chars": <n> }
```

**Dry-run preview** — build and return the digest text without sending to Telegram. Works without Telegram secrets (useful for local dev and content preview):

```bash
curl -X POST "https://kit-tracker.fly.dev/api/tg/digest/run?dry=1" \
  -H "Authorization: <admin-PB-token>"
# Returns: { "dry": true, "chars": <n>, "text": "<digest HTML>" }
```

Alternatively pass `{ "dry": true }` in the JSON body. The admin gate still applies — non-admins get 403 even in dry-run mode.

**Skip-silently behavior:** if either `TELEGRAM_BOT_TOKEN` or `TELEGRAM_GROUP_CHAT_ID` is unset, both the cron and the non-dry manual trigger skip/return 500 without crashing — so local dev and CI without secrets stay green.

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

## AI / MCP server

### Endpoint

`POST /api/mcp` — Streamable HTTP MCP server (JSON-RPC 2.0 over HTTP body).
Protocol version: `2024-11-05`. Server: `kit-tracker-mcp v0.1.0`.

### Auth

`Authorization: <PB user token>` header. Same token from `/api/collections/users/auth-with-password`.
Read tools (list_*, get_*, resolve_*) — any authenticated user.
Write tools (create_*, move_*) — admin/technician only.

### 27 tools (chat + MCP in sync)

Read (14): `list_kits`, `get_kit`, `list_entities`, `get_entity`, `list_requests`,
`list_components`, `resolve_kit`, `resolve_entity`, `resolve_product`,
`report_kits_by_entity`, `report_maintenance_due`, `report_open_requests`,
`report_overdue_returns`, `report_recent_activity`.

Write (13): `create_entity`, `create_kit`, `move_kit`, `create_product`,
`create_component`, `move_component`, `decide_request`,
`link_component_to_product`, `update_entity`, `update_kit`, `update_product`,
`update_user_phone`, `update_user_telegram_chat_id`.

`ai_chat.pb.js` writes get a 30s undo token in the response; MCP does not (issue
a reverse op from the client). Both audit-log with `changes.via = "ai-agent"` or
`"mcp"`.

### Claude Code / Desktop config

Add to `~/.claude/settings.json` (or Claude Desktop `claude_desktop_config.json`):

```json
"mcpServers": {
  "kit-tracker": {
    "type": "http",
    "url": "https://kit-tracker.fly.dev/api/mcp",
    "headers": { "Authorization": "<your-PB-token>" }
  }
}
```

For local dev replace the URL with `http://127.0.0.1:8090/api/mcp`.

### Hook source

`pb/pb_hooks/ai_mcp.pb.js` — single `routerAdd` with inlined tool definitions
(PB v0.22 Goja isolation; no cross-file imports possible).
Write calls are audit-logged with `changes.via = "mcp"`.
Undo is not provided via MCP v1 — issue a reverse operation from the client.

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
