#!/usr/bin/env bash
# Enables (or disables) Google OAuth2 provider in PocketBase via the settings API.
# Must run after PocketBase is started (migrations applied).
#
# Usage: ./setup_oauth.sh [superuser-email] [superuser-password] [--disable]
# Falls back to PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD env vars if args omitted.
#
# Flags:
#   --disable   Set googleAuth.enabled=false (to remove OAuth without restarting PB).
#
# Required env vars when enabling:
#   GOOGLE_OAUTH_CLIENT_ID     — Google OAuth2 client ID
#   GOOGLE_OAUTH_CLIENT_SECRET — Google OAuth2 client secret
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
  if [ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
    echo "ERROR: GOOGLE_OAUTH_CLIENT_ID is not set." >&2
    exit 1
  fi
  if [ -z "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
    echo "ERROR: GOOGLE_OAUTH_CLIENT_SECRET is not set." >&2
    exit 1
  fi
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
  echo "Disabling Google OAuth2 provider..."
  PATCH_RESPONSE=$(curl -s -o /tmp/_setup_oauth_patch.json -w "%{http_code}" \
    -X PATCH "$PB_URL/api/settings" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"googleAuth":{"enabled":false}}')

  if [ "$PATCH_RESPONSE" != "200" ]; then
    echo "ERROR: PATCH /api/settings returned HTTP $PATCH_RESPONSE" >&2
    cat /tmp/_setup_oauth_patch.json >&2
    exit 1
  fi

  echo ""
  echo "Google OAuth provider disabled."
  exit 0
fi

echo "Enabling Google OAuth2 provider..."
PATCH_RESPONSE=$(curl -s -o /tmp/_setup_oauth_patch.json -w "%{http_code}" \
  -X PATCH "$PB_URL/api/settings" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"googleAuth\": {
      \"enabled\": true,
      \"clientId\": \"$GOOGLE_OAUTH_CLIENT_ID\",
      \"clientSecret\": \"$GOOGLE_OAUTH_CLIENT_SECRET\"
    }
  }")

if [ "$PATCH_RESPONSE" != "200" ]; then
  echo "ERROR: PATCH /api/settings returned HTTP $PATCH_RESPONSE" >&2
  cat /tmp/_setup_oauth_patch.json >&2
  exit 1
fi

# ---- verify ----
echo "Verifying..."
VERIFY=$(curl -s -H "Authorization: $TOKEN" "$PB_URL/api/settings")

ENABLED=$(echo "$VERIFY" | jq -r '.googleAuth.enabled' 2>/dev/null || echo "false")
CLIENT_ID=$(echo "$VERIFY" | jq -r '.googleAuth.clientId // ""' 2>/dev/null || echo "")

if [ "$ENABLED" != "true" ] && [ "$ENABLED" != "True" ]; then
  echo "ERROR: googleAuth.enabled is not true after PATCH." >&2
  exit 1
fi

if [ "$CLIENT_ID" != "$GOOGLE_OAUTH_CLIENT_ID" ]; then
  echo "ERROR: clientId mismatch after PATCH (got: $CLIENT_ID)." >&2
  exit 1
fi

echo ""
echo "Google OAuth provider enabled."
echo "  clientId: $CLIENT_ID"
echo "  enabled:  $ENABLED"
