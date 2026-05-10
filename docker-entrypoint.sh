#!/bin/sh
set -e

: "${PB_SUPERUSER_EMAIL:?PB_SUPERUSER_EMAIL must be set}"
: "${PB_SUPERUSER_PASSWORD:?PB_SUPERUSER_PASSWORD must be set}"

# NOTE: PocketBase v0.22's `admin create` command unconditionally requires the
# password as a positional CLI argument (argv[2]).  It provides no --password-file
# flag, no stdin mode, and no environment-variable alternative.  As a result the
# password is briefly visible in /proc/<pid>/cmdline of the pocketbase child
# process while this command runs.  This is a known upstream CLI limitation —
# see https://github.com/pocketbase/pocketbase/issues — and cannot be worked
# around at the call-site without patching PocketBase itself.  Mitigation: run
# the container in a trusted execution environment and restrict /proc access
# (e.g. Docker's default hidepid=0 can be tightened with a custom seccomp/pid-ns
# profile).  Once PB adds a --password-file or stdin option this line should be
# updated accordingly.
# Idempotency: suppress UNIQUE constraint errors (admin already exists) but exit on other errors.
./pocketbase admin create "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
  --dir=/app/pb_data 2>&1 | grep -v "constraint failed: UNIQUE constraint failed: _admins.email" || true

# Initialize migrations before starting PocketBase (required for schema).
./pocketbase migrate up --dir=/app/pb_data --migrationsDir=/app/pb/pb_migrations || true

# Start PocketBase in the background so bootstrap scripts can call its API.
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  --publicDir=/app/pb_public \
  --migrationsDir=/app/pb/pb_migrations \
  --hooksDir=/app/pb/pb_hooks &
PB_PID=$!

# Wait for the API to become ready (up to 30 s).
i=0
until curl -sf http://127.0.0.1:8090/api/health > /dev/null 2>&1; do
  i=$((i + 1))
  if [ $i -ge 30 ]; then
    echo "ERROR: PocketBase did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

# Run setup_collections.sh — credentials come from env vars, no argv leak.
# Failure stops the container: broken schema → broken app.
/app/pb/setup_collections.sh

# Seed test users for Playwright e2e tests
/app/pb/seed_test_users.sh "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" || true

# Google OAuth handling — credentials come from env vars, no argv leak.
if [ -n "${GOOGLE_OAUTH_DISABLE:-}" ]; then
  /app/pb/setup_oauth.sh --disable
elif [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] && [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  /app/pb/setup_oauth.sh
elif [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] || [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "WARNING: only one of GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET is set — Google OAuth not configured (need both CLIENT_ID and CLIENT_SECRET)" >&2
fi

# SMTP handling — mirror OAuth pattern.
if [ -n "${SMTP_DISABLE:-}" ]; then
  /app/pb/setup_smtp.sh "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" --disable || echo "WARN: setup_smtp.sh --disable failed, continuing"
elif [ -n "${SMTP_USERNAME:-}" ] && [ -n "${SMTP_PASSWORD:-}" ]; then
  /app/pb/setup_smtp.sh "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" || echo "WARN: setup_smtp.sh failed, continuing"
elif [ -n "${SMTP_USERNAME:-}" ] || [ -n "${SMTP_PASSWORD:-}" ]; then
  echo "WARNING: only one of SMTP_USERNAME / SMTP_PASSWORD is set — authenticated SMTP not configured (need both SMTP_USERNAME and SMTP_PASSWORD)" >&2
elif [ -n "${SMTP_HOST:-}" ]; then
  # SMTP_HOST set but no credentials — MailHog-style (no-auth SMTP). Configure it.
  /app/pb/setup_smtp.sh "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" || echo "WARN: setup_smtp.sh failed, continuing"
else
  echo "SMTP_HOST not set; skipping SMTP config"
fi

# Keep the container alive by waiting on PocketBase.
wait $PB_PID
