# Kit Tracker — Pilot Runbook (Admin)

Admin-facing operations guide for shipping a pilot instance.
Tech-facing companion: `docs/pilot-onboarding.md`.

---

## 1. Pre-flight checklist

Gather these before you start:

| What | Where to get it |
|---|---|
| **Fly.io account** | https://fly.io — free tier is fine for pilot |
| **Fly CLI** | `brew install flyctl` or https://fly.io/docs/hands-on/install-flyctl/ |
| **Telegram bot token** | Create a bot via @BotFather in Telegram (`/newbot`) |
| **Gmail App Password** (optional, for email notifications) | Google account → 2FA enabled → https://myaccount.google.com/apppasswords |
| **Custom domain** (optional) | Any registrar — Fly handles TLS automatically |

---

## 2. Deploy PocketBase + frontend to Fly

### 2a. Create the app and storage volume

Replace `<pilot-name>` with a short slug (e.g. `acme`):

```bash
flyctl auth login

flyctl apps create kit-tracker-<pilot-name>

flyctl volumes create pb_data --size 1 --region fra --app kit-tracker-<pilot-name>
```

> The `fra` region (Frankfurt) is closest to Israel. Change if your pilot team is elsewhere.

### 2b. Set secrets

Required secrets — set all before the first deploy:

```bash
flyctl secrets set --app kit-tracker-<pilot-name> \
  PB_SUPERUSER_EMAIL=<admin-email> \
  PB_SUPERUSER_PASSWORD=<strong-password> \
  TELEGRAM_BOT_TOKEN=<from-botfather> \
  TELEGRAM_BOT_SECRET=<openssl rand -hex 20> \
  APP_BASE_URL=https://kit-tracker-<pilot-name>.fly.dev
```

> `APP_BASE_URL` is used in notification email links — set to your deployed origin so emails don't link to `localhost:5173`.

To generate `TELEGRAM_BOT_SECRET`:
```bash
openssl rand -hex 20
```

Optional secrets (add only if needed):

| Secret | Description |
|---|---|
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` — enables deep_link in link response |
| `SMTP_HOST` | SMTP hostname, e.g. `smtp.gmail.com` |
| `SMTP_PORT` | Usually `587` |
| `SMTP_USERNAME` | SMTP login (Gmail address) |
| `SMTP_PASSWORD` | Gmail App Password (16 chars, no spaces) |
| `SMTP_FROM` | From address shown to recipients |
| `GOOGLE_OAUTH_CLIENT_ID` | Enables Google login on `/login` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Required if Client ID is set |
| `SEED_TEST_USERS` | Set to `1` only in CI — never in prod |

### 2c. Update `fly.toml` app name

Edit `fly.toml` line 1 before deploying:

```toml
app = "kit-tracker-<pilot-name>"
```

### 2d. Deploy

```bash
flyctl deploy --remote-only --app kit-tracker-<pilot-name>
```

Build takes 2–4 minutes. Remote builder runs in Fly's cloud — no local Docker needed.

### 2e. Verify

Tail logs until "Server started at..." appears:
```bash
flyctl logs -f --app kit-tracker-<pilot-name>
```

Health check:
```bash
curl https://kit-tracker-<pilot-name>.fly.dev/api/health
```

Expected: `{"code":200,"message":"API is healthy."}` (or similar OK JSON).

---

## 3. Configure Telegram webhook

### 3a. Register the webhook with Telegram

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://kit-tracker-<pilot-name>.fly.dev/api/tg/webhook" \
  -d "secret_token=<TELEGRAM_BOT_SECRET>"
```

Both values must match the Fly secrets set in step 2b.

### 3b. Register bot commands (slash-command menu)

Run once after deploy to populate the in-chat `/` command menu:

```bash
TELEGRAM_BOT_TOKEN=<token> bash scripts/tg-set-commands.sh
```

Share the bot username with the pilot team (e.g. `@kit_tracker_bot`). Direct techs to
`docs/pilot-onboarding.md` section 2 for the linking flow.

---

## 4. Seed data — Path A: demo / evaluation

Use this if the pilot is evaluating with realistic but fake data first.

```bash
PB_URL=https://kit-tracker-<pilot-name>.fly.dev \
  PB_SUPERUSER_EMAIL=<admin-email> \
  PB_SUPERUSER_PASSWORD=<strong-password> \
  node scripts/seed_demo_data.mjs
```

To remove demo data when the pilot is ready to go live:
```bash
PB_URL=https://kit-tracker-<pilot-name>.fly.dev \
  PB_SUPERUSER_EMAIL=<admin-email> \
  PB_SUPERUSER_PASSWORD=<strong-password> \
  node scripts/teardown_demo_data.mjs
```

---

## 5. Seed data — Path B: production (clean start)

Use this if you're going straight to real data.

### 5a. Create entities

1. Open `https://kit-tracker-<pilot-name>.fly.dev` and log in with the superuser credentials.
2. Go to **Entities** → **New entity**.
3. Create 1 warehouse entity: name = `Warehouse` (or your name), category = `storage`.
4. Create N customer-site entities: category = `field`.
5. Click the warehouse entity to open it — copy the ID from the URL (`/entities/<id>`).

### 5b. Create technician users

1. Go to **Users** page (admin only).
2. Click **New user** — enter name, email, set role = `technician`.
3. The user will receive an email to set a password (if SMTP is configured) or you set it manually via PB admin at `/_/`.
4. Direct the user to `docs/pilot-onboarding.md` — they link their Telegram account themselves via Profile → Link Telegram.

### 5c. Import kits

Go to **Kits** → **Import CSV** — upload your kit list. Required columns: `serial`. Optional: `notes`.

---

## 6. Onboard the pilot team

1. Email or message each tech a link to `docs/pilot-onboarding.md` (or copy-paste its contents).
2. Share the bot username (e.g. `@kit_tracker_bot`) so techs can find it in Telegram.
3. Schedule a 30-minute kickoff call:
   - Walk through the Profile → Link Telegram flow live.
   - Walk through one `/move` live (tech sends from their phone, bot confirms, admin sees it in web audit log).
   - Walk through one `/kit` query live.
   - Show the admin the PB panel `audit_log` collection filtered by `changes ~ "tg-command"` (Telegram-originated events).
4. Confirm each tech has linked their Telegram account before the call so they can participate.

---

## 7. Monitor during pilot

### Live log tail
```bash
flyctl logs -f --app kit-tracker-<pilot-name>
```

Look for `[tg_webhook]` lines — each inbound Telegram command logs intent + result. Repeated errors (e.g. `[tg_webhook] ERROR`) warrant investigation.

### PocketBase admin panel

`https://kit-tracker-<pilot-name>.fly.dev/_/` — log in with superuser credentials.

- **audit_log** collection — every write action; filter `changes ~ "tg-command"` in the PB admin UI to isolate Telegram-originated moves (Telegram-originated changes are stored with `changes.via = "tg-command"`; the web `/audit` Source dropdown now includes `tg-command` (Telegram) and `tg-link` (Telegram link) entries for direct filtering).
- **transactions** collection — full move history.
- **users** collection — check/fix `telegram_chat_id` if a tech can't connect.

### Web audit log

`https://kit-tracker-<pilot-name>.fly.dev/audit` — exportable to CSV. The Source dropdown includes `web`, `wa-bot`, `ai-agent`, `mcp`, `tg-command` (Telegram), and `tg-link` (Telegram link). Use the Source filter to isolate Telegram-initiated moves directly from the web UI.

### Daily check

Each day during the pilot:
1. Tail logs for the previous 24h — scan for repeated errors.
2. Confirm the daily backup workflow succeeded (`.github/workflows/backup.yml` runs at 04:23 UTC). Spot-check the latest `backup-*` release on the repo; if missing or failed, run the workflow manually via `workflow_dispatch` or fall back to `bash scripts/backup-pb-data.sh` (see section 10).

---

## 8. Known limitations

These are accepted risks for the pilot period. Be transparent with the pilot team.

| Limitation | Impact | Plan |
|---|---|---|
| **No Sentry / APM** | Low visibility into silent frontend errors | Check logs daily; UptimeRobot covers reachability per `docs/uptime-monitor-setup.md` — add Sentry post-pilot |
| **PB JS SDK pinned to `^0.21.x`** | Bumping can break OAuth | See `CLAUDE.md` "PocketBase SDK version" before any upgrade |
| **OAuth `client_secret_*.json` must never be committed** | Security leak | Verify `.gitignore` before any commit touching OAuth config |

---

## 9. Escalation

| Situation | Action |
|---|---|
| **Bug or outage** | Contact hadassi — include `flyctl logs` output and the time of the incident |
| **Tech can't connect (bot silent after linking)** | Check their `telegram_chat_id` field in the Users page via PB admin — must be non-empty; have them re-link via Profile → Link Telegram |
| **Add a new tech mid-pilot** | Admin creates user via `/users` page; set role = `technician`; tech links Telegram via Profile → Link Telegram |
| **Incorrect move logged (outside undo window)** | Log a corrective move in the opposite direction. Transactions are append-only — no delete. |

---

## 10. Rollback / disaster recovery

### Application rollback

List past releases and rollback to previous:
```bash
flyctl releases --app kit-tracker-<pilot-name>
flyctl releases rollback --app kit-tracker-<pilot-name>
```

### Database backup

Daily backups run automatically via `.github/workflows/backup.yml` (04:23 UTC cron). Snapshots are GPG-encrypted and uploaded as GitHub release artifacts; the prune step keeps a rolling window per `scripts/prune-backup-releases.sh`. Required secrets: `FLY_API_TOKEN`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`, `APP_BASE_URL`, `BACKUP_ENCRYPTION_KEY`.

For an ad-hoc snapshot (e.g. before a risky migration), run locally:

```bash
bash scripts/backup-pb-data.sh
# Output: backups/pb-snapshot-YYYYMMDD-HHMMSS.tar.gz
```

### Restore from backup

Follow the full restore procedure in `CLAUDE.md` → "Backup pb_data" section. Summary:
1. SSH into app machine: `flyctl ssh console --app kit-tracker-<pilot-name>`
2. Clear `pb_data`, extract the snapshot tarball.
3. Exit SSH, then `flyctl restart --app kit-tracker-<pilot-name>`.

Do not attempt to restore while the app is actively receiving traffic if possible — schedule during off-hours.
