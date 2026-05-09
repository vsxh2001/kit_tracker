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
./pocketbase admin create "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
  --dir=/app/pb_data 2>/dev/null || true

# Start PocketBase in the background so bootstrap scripts can call its API.
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  --publicDir=/app/pb_public &
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

# Google OAuth handling — credentials come from env vars, no argv leak.
if [ -n "${GOOGLE_OAUTH_DISABLE:-}" ]; then
  /app/pb/setup_oauth.sh --disable
elif [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] && [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  /app/pb/setup_oauth.sh
elif [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] || [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "WARNING: only one of GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET is set — Google OAuth not configured (need both CLIENT_ID and CLIENT_SECRET)" >&2
fi

# Keep the container alive by waiting on PocketBase.
wait $PB_PID
