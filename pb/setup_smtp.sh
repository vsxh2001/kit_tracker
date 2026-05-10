#!/usr/bin/env bash
# Enables (or disables) SMTP settings in PocketBase via the settings API.
# Must run after PocketBase is started and ready.
#
# Usage: ./setup_smtp.sh [superuser-email] [superuser-password] [--disable]
# Falls back to PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD env vars if args omitted.
#
# Flags:
#   --disable   Set smtp.enabled=false (to stop sending mail without restarting PB).
#
# Required env vars when enabling:
#   SMTP_HOST       — SMTP server hostname (e.g. mailhog or smtp.gmail.com)
#   SMTP_PORT       — SMTP port (e.g. 1025 for MailHog, 587 for TLS)
#   SMTP_USERNAME   — SMTP auth username (may be empty for MailHog)
#   SMTP_PASSWORD   — SMTP auth password (may be empty for MailHog)
#   SMTP_FROM       — sender address (e.g. notifications@kit.local)
#   SMTP_TLS        — "true" or "false" (default: false)
#
# Idempotent — safe to re-run.

set -euo pipefail

PB_URL="${PB_URL:-http://127.0.0.1:8090}"

# ---- parse args ----
DISABLE=false
POSITIONAL=()
for arg in "$@"; do
  if [ "$arg" = "--disable" ]; then
    DISABLE=true
  else
    POSITIONAL+=("$arg")
  fi
done

if [ "${#POSITIONAL[@]}" -ge 2 ]; then
  ADMIN_EMAIL="${POSITIONAL[0]}"
  ADMIN_PASSWORD="${POSITIONAL[1]}"
else
  if [ -z "${PB_SUPERUSER_EMAIL:-}" ] || [ -z "${PB_SUPERUSER_PASSWORD:-}" ]; then
    echo "ERROR: provide credentials as positional args or set PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD" >&2
    exit 1
  fi
  ADMIN_EMAIL="$PB_SUPERUSER_EMAIL"
  ADMIN_PASSWORD="$PB_SUPERUSER_PASSWORD"
fi

# ---- env (only needed when enabling) ----
if [ "$DISABLE" = false ]; then
  : "${SMTP_HOST:?SMTP_HOST is required}"
  : "${SMTP_PORT:?SMTP_PORT is required}"
  : "${SMTP_FROM:?SMTP_FROM is required}"
  # SMTP_USERNAME and SMTP_PASSWORD may be empty (MailHog has no auth)
  SMTP_USERNAME="${SMTP_USERNAME:-}"
  SMTP_PASSWORD="${SMTP_PASSWORD:-}"
  SMTP_TLS="${SMTP_TLS:-false}"
fi

# ---- auth ----
echo "Authenticating with PocketBase at $PB_URL..."
AUTH_RESPONSE=$(curl -s -X POST "$PB_URL/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")

TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // empty' 2>/dev/null || true)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Authentication failed. Check credentials and that PocketBase is running." >&2
  echo "Response: $AUTH_RESPONSE" >&2
  exit 1
fi
echo "Authenticated."

# ---- PATCH settings ----
if [ "$DISABLE" = true ]; then
  echo "Disabling SMTP..."
  PATCH_RESPONSE=$(curl -s -o /tmp/_setup_smtp_patch.json -w "%{http_code}" \
    -X PATCH "$PB_URL/api/settings" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"smtp":{"enabled":false}}')

  if [ "$PATCH_RESPONSE" != "200" ]; then
    echo "ERROR: PATCH /api/settings returned HTTP $PATCH_RESPONSE" >&2
    cat /tmp/_setup_smtp_patch.json >&2
    exit 1
  fi

  echo ""
  echo "SMTP disabled."
  exit 0
fi

echo "Enabling SMTP (host=$SMTP_HOST port=$SMTP_PORT tls=$SMTP_TLS)..."
PATCH_RESPONSE=$(curl -s -o /tmp/_setup_smtp_patch.json -w "%{http_code}" \
  -X PATCH "$PB_URL/api/settings" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg host "$SMTP_HOST" \
    --argjson port "$SMTP_PORT" \
    --arg username "$SMTP_USERNAME" \
    --arg password "$SMTP_PASSWORD" \
    --argjson tls "$([ "$SMTP_TLS" = "true" ] && echo "true" || echo "false")" \
    --arg from "$SMTP_FROM" \
    '{
      smtp: {
        enabled: true,
        host: $host,
        port: $port,
        username: $username,
        password: $password,
        tls: $tls,
        authMethod: "PLAIN"
      },
      meta: {
        senderName: "Kit Tracker",
        senderAddress: $from
      }
    }')")

if [ "$PATCH_RESPONSE" != "200" ]; then
  echo "ERROR: PATCH /api/settings returned HTTP $PATCH_RESPONSE" >&2
  cat /tmp/_setup_smtp_patch.json >&2
  exit 1
fi

# ---- verify ----
echo "Verifying..."
VERIFY=$(curl -s -H "Authorization: $TOKEN" "$PB_URL/api/settings")

ENABLED=$(echo "$VERIFY" | jq -r '.smtp.enabled' 2>/dev/null || echo "false")
GOT_HOST=$(echo "$VERIFY" | jq -r '.smtp.host // ""' 2>/dev/null || echo "")

if [ "$ENABLED" != "true" ]; then
  echo "ERROR: smtp.enabled is not true after PATCH." >&2
  exit 1
fi

if [ "$GOT_HOST" != "$SMTP_HOST" ]; then
  echo "ERROR: smtp.host mismatch after PATCH (got: $GOT_HOST, expected: $SMTP_HOST)." >&2
  exit 1
fi

echo ""
echo "SMTP configured."
echo "  host:    $GOT_HOST"
echo "  port:    $(echo "$VERIFY" | jq -r '.smtp.port')"
echo "  enabled: $ENABLED"
echo "  from:    $(echo "$VERIFY" | jq -r '.meta.senderAddress // ""')"
