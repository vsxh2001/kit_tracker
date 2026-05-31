# Pilot Deploy Checklist

## Pre-flight (commit to memory before touching flyctl)

- [ ] Branch worktree-pilot-sprint is merged to main? (or are we deploying the branch directly?)
- [ ] CI green on the tip commit?
- [ ] All migrations apply cleanly on a fresh DB? (run scripts/pilot-deploy-dry-run.sh)
- [ ] All hooks load without panic? (same script)
- [ ] All required Fly secrets known? (list below)
- [ ] Telegram bot token + secret generated?
- [ ] DEFAULT_WAREHOUSE_ENTITY_ID — choose AFTER deploy + seed, then set as secret

## Required Fly secrets

| Secret | Notes |
|---|---|
| PB_SUPERUSER_EMAIL | Admin login for /_/ panel + initial app user |
| PB_SUPERUSER_PASSWORD | Strong password |
| TELEGRAM_BOT_TOKEN | From @BotFather (`/newbot`) |
| TELEGRAM_BOT_SECRET | Random hex — `openssl rand -hex 20` |
| APP_BASE_URL | https://kit-tracker-<pilot>.fly.dev |
| SMTP_HOST | Optional — for email notifications |
| SMTP_USERNAME | Optional |
| SMTP_PASSWORD | Optional |
| SMTP_FROM | Optional |
| DEFAULT_WAREHOUSE_ENTITY_ID | Set AFTER seed runs |

Optional secrets (set if needed):

| Secret | Notes |
|---|---|
| TELEGRAM_BOT_USERNAME | Bot username without `@` — enables deep_link in link response |
| GOOGLE_OAUTH_CLIENT_ID | Enables Google login on /login |
| GOOGLE_OAUTH_CLIENT_SECRET | Required if Client ID is set |

## Deploy steps

1. `flyctl apps create kit-tracker-<pilot-name>` (or use existing)
2. `flyctl volumes create pb_data --size 1 --region fra`
3. `flyctl secrets set ...` for each required secret
4. `flyctl deploy --remote-only`
5. Tail logs: `flyctl logs -f` until "Server started at..." appears
6. Health check: `curl -fsS https://kit-tracker-<pilot>.fly.dev/api/health`
7. Register Telegram webhook:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://kit-tracker-<pilot>.fly.dev/api/tg/webhook" \
     -d "secret_token=<TELEGRAM_BOT_SECRET>"
   ```
8. Register bot slash-command menu: `TELEGRAM_BOT_TOKEN=<token> bash scripts/tg-set-commands.sh`
9. Seed demo data (optional) or production data via PB admin UI
10. Capture warehouse entity ID, set DEFAULT_WAREHOUSE_ENTITY_ID secret + redeploy

## Verification after deploy

- [ ] /api/health returns 200
- [ ] /_/ admin login works with PB_SUPERUSER creds
- [ ] /login app login works (same creds — see CLAUDE.md "First-boot identity")
- [ ] Telegram webhook registration returned `{"ok":true}`
- [ ] Bot slash-command menu appears in Telegram after `tg-set-commands.sh`
- [ ] Seed admin user has role=admin
- [ ] Profile → Link Telegram flow produces a code and bot confirms "Linked!"
- [ ] `/move <serial> <entity>` flow works end-to-end from Telegram
- [ ] /audit filter by Source=tg-command shows the move
- [ ] CSV export from /audit works

## Rollback

- `flyctl releases rollback` to the previous release
- Or rebuild from a known-good commit + `flyctl deploy --remote-only`
- Data: snapshot pb_data per `scripts/backup-pb-data.sh` before any risky change

## Known gaps / findings (from dry-run)

- `docker-entrypoint.sh` is NOT executable in the worktree (mode -rw-rw-r--). The Dockerfile
  COPYs it in — verify the Docker build sets the right permissions or add `RUN chmod +x` to
  the Dockerfile. Fix is out of lane for this task; flagged here for human action.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_SECRET` are NOT in `.env.example`. Consider adding
  them (commented-out) to `.env.example` for operator discoverability.
