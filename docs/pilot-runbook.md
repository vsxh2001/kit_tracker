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
| **Twilio account** | https://console.twilio.com — free trial covers sandbox |
| **Anthropic API key** | https://console.anthropic.com/settings/api-keys |
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
  ANTHROPIC_API_KEY=<key> \
  TWILIO_ACCOUNT_SID=<from-twilio-console> \
  TWILIO_AUTH_TOKEN=<from-twilio-console> \
  TWILIO_AUTH_BASIC=<base64 of "SID:AUTH_TOKEN"> \
  DEFAULT_WAREHOUSE_ENTITY_ID=placeholder
```

> `DEFAULT_WAREHOUSE_ENTITY_ID` must be set before the first deploy (placeholder is fine); update it with the real ID after seeding (step 4 or 5).

To compute `TWILIO_AUTH_BASIC`:
```bash
echo -n "<SID>:<AUTH_TOKEN>" | base64
```

Optional secrets (add only if needed):

| Secret | Description |
|---|---|
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

## 3. Configure Twilio sandbox webhook

1. Go to [Twilio Console](https://console.twilio.com) → **Messaging** → **Try it out** → **Send a WhatsApp message**
2. Follow the sandbox setup — you'll get a join code like `join <word-word>`
3. Under **Sandbox settings**, set:

   | Field | Value |
   |---|---|
   | **WHEN A MESSAGE COMES IN** | `https://kit-tracker-<pilot-name>.fly.dev/api/wa/webhook` |
   | **Method** | `POST` |

4. Save.

Share the sandbox join code with the pilot team privately (not in a shared channel — it authenticates all inbound messages). Direct techs to `docs/pilot-onboarding.md` section 1.

> The sandbox number is **+1 415 523 8886** (shared Twilio number). Sandbox connections expire after 3 days of inactivity — techs must re-send the join code to reconnect.

---

## 4. Seed data — Path A: demo / evaluation

Use this if the pilot is evaluating with realistic but fake data first.

```bash
PB_URL=https://kit-tracker-<pilot-name>.fly.dev \
  PB_SUPERUSER_EMAIL=<admin-email> \
  PB_SUPERUSER_PASSWORD=<strong-password> \
  node scripts/seed_demo_data.mjs
```

Watch the output for this line:
```
DEMO-Warehouse entity ID: <id>
```

Copy that `<id>` and set the Fly secret (takes effect immediately, no redeploy needed):
```bash
flyctl secrets set --app kit-tracker-<pilot-name> DEFAULT_WAREHOUSE_ENTITY_ID=<id>
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

Set the warehouse ID as a Fly secret:
```bash
flyctl secrets set --app kit-tracker-<pilot-name> DEFAULT_WAREHOUSE_ENTITY_ID=<warehouse-id>
```

### 5b. Create technician users

1. Go to **Users** page (admin only).
2. Click **New user** — enter name, email, set role = `technician`.
3. Set the user's WhatsApp number in the `phone` field — full international format, e.g. `+972501234567`. The bot uses this to match inbound messages to accounts.
4. The user will receive an email to set a password (if SMTP is configured) or you set it manually via PB admin at `/_/`.

### 5c. Import kits

Go to **Kits** → **Import CSV** — upload your kit list. Required columns: `serial`. Optional: `notes`.

---

## 6. Onboard the pilot team

1. Email or message each tech a link to `docs/pilot-onboarding.md` (or copy-paste its contents).
2. Share the Twilio sandbox join code **privately** — one-on-one message, not a group chat.
3. Schedule a 30-minute kickoff call:
   - Walk through one `move` live (tech sends from their phone, bot confirms, admin sees it in web audit log).
   - Walk through one `return` live.
   - Show the admin the `/audit` page filtered by `via=wa-bot`.
4. Confirm each tech's WhatsApp number is set on their user record before the call so they can participate.

---

## 7. Monitor during pilot

### Live log tail
```bash
flyctl logs -f --app kit-tracker-<pilot-name>
```

Look for `[wa_inbound]` lines — each inbound WhatsApp message logs intent + result. Repeated errors (e.g. `[wa_inbound] ERROR`) warrant investigation.

### PocketBase admin panel

`https://kit-tracker-<pilot-name>.fly.dev/_/` — log in with superuser credentials.

- **audit_log** collection — every write action; filter `changes.via = "wa-bot"` for WhatsApp-originated moves.
- **transactions** collection — full move history.
- **users** collection — check/fix phone numbers if a tech can't connect.

### Web audit log

`https://kit-tracker-<pilot-name>.fly.dev/audit` — filter by **Source: wa-bot** to see all WhatsApp-initiated moves. Exportable to CSV.

### Daily check (manual, while ops hardening is deferred)

Each day during the pilot:
1. Tail logs for the previous 24h — scan for repeated errors.
2. Run a manual backup (see section 10).

---

## 8. Known limitations

These are accepted risks for the pilot period. Be transparent with the pilot team.

| Limitation | Impact | Plan |
|---|---|---|
| **Twilio sandbox uses a shared number** — looks like a generic Twilio bot, not your brand | Low — team knows it's a pilot | Production number + template approval is post-commit work (~1-2 weeks) |
| **Sandbox join-code expires after 3 days of inactivity** | Medium — techs may need to re-join | Document in onboarding (section 1); tech reconnects in <30 seconds |
| **No automated daily backup** | Critical if data loss occurs | Run `bash scripts/backup-pb-data.sh` manually each day during pilot; add cron post-commit |
| **No uptime monitoring or Sentry** | Low visibility into silent failures | Check logs daily; add UptimeRobot + Sentry post-commit |
| **PB JS SDK pinned to `^0.21.x`** | Bumping can break OAuth | See `CLAUDE.md` "PocketBase SDK version" before any upgrade |
| **OAuth `client_secret_*.json` must never be committed** | Security leak | Verify `.gitignore` before any commit touching OAuth config |

---

## 9. Escalation

| Situation | Action |
|---|---|
| **Bug or outage** | Contact hadassi — include `flyctl logs` output and the time of the incident |
| **WhatsApp sandbox expired** | Tech re-sends join code to +1 415 523 8886 — bot reconnects immediately |
| **Tech can't connect (bot silent after join)** | Check their `phone` field in the Users page — must match exact WhatsApp number in `+<country><number>` format |
| **Add a new tech mid-pilot** | Admin creates user via `/users` page; set role = `technician`; fill `phone` field; share join code privately |
| **Incorrect move logged (outside undo window)** | Log a corrective move in the opposite direction. Transactions are append-only — no delete. |
| **AI hallucination — bot moved kit to wrong entity** | Same corrective-move path. Prevent recurrence: avoid entity names that differ only by a number. |

---

## 10. Rollback / disaster recovery

### Application rollback

List past releases and rollback to previous:
```bash
flyctl releases --app kit-tracker-<pilot-name>
flyctl releases rollback --app kit-tracker-<pilot-name>
```

### Database backup (manual, run daily during pilot)

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
