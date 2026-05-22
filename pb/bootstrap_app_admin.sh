#!/bin/sh
# Promotes PB_SUPERUSER_EMAIL to an app-level admin user on first boot.
# Idempotent: skips if user already exists with that email.
#
# Why: PB has 2 identity stores (_superusers for /_/, users for /login).
# Without this script, ops must manually create the matching app user.
# This script gives single-identity UX: same credentials log in to both.
#
# Requires: PB running on $PB_URL (default 127.0.0.1:8090), jq, curl.

set -e

PB_URL="${PB_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${PB_SUPERUSER_EMAIL:?PB_SUPERUSER_EMAIL must be set}"
ADMIN_PASSWORD="${PB_SUPERUSER_PASSWORD:?PB_SUPERUSER_PASSWORD must be set}"

# Auth as PB superuser.
# PB v0.22 uses /api/admins/auth-with-password; newer versions use
# /api/collections/_superusers/auth-with-password. Try the newer endpoint
# first (returns token at .token), fall back to legacy endpoint.
AUTH_BODY="$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{identity:$e,password:$p}')"

TOKEN=$(curl -s -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "$AUTH_BODY" \
  | jq -r '.token // empty')

if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s -X POST "$PB_URL/api/admins/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "$AUTH_BODY" \
    | jq -r '.token // empty')
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: bootstrap_app_admin.sh — superuser auth failed" >&2
  exit 1
fi

# Check if app user already exists
EXISTING_JSON=$(curl -s -G "$PB_URL/api/collections/users/records" \
  -H "Authorization: $TOKEN" \
  --data-urlencode "filter=email = \"$ADMIN_EMAIL\"")
EXISTING_COUNT=$(echo "$EXISTING_JSON" | jq -r '.totalItems // 0')
EXISTING_ID=$(echo "$EXISTING_JSON" | jq -r '.items[0].id // empty')
EXISTING_ROLE=$(echo "$EXISTING_JSON" | jq -r '.items[0].role // empty')

if [ "${EXISTING_COUNT:-0}" -gt 0 ]; then
  if [ "$EXISTING_ROLE" = "admin" ]; then
    echo "App admin user $ADMIN_EMAIL already exists with role=admin; skipping"
    exit 0
  fi
  # Promote existing non-admin to admin
  HTTP_STATUS=$(curl -s -o /tmp/bootstrap_resp.json -w "%{http_code}" \
    -X PATCH "$PB_URL/api/collections/users/records/$EXISTING_ID" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"role":"admin","verified":true}')
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "App user $ADMIN_EMAIL promoted to role=admin (was '$EXISTING_ROLE')"
    exit 0
  else
    echo "ERROR: bootstrap_app_admin.sh — failed to promote $ADMIN_EMAIL (HTTP $HTTP_STATUS):" >&2
    cat /tmp/bootstrap_resp.json >&2
    exit 1
  fi
fi

# User doesn't exist — create with role=admin, verified, using same password as superuser
BODY=$(jq -nc \
  --arg e "$ADMIN_EMAIL" \
  --arg p "$ADMIN_PASSWORD" \
  '{email:$e, password:$p, passwordConfirm:$p, role:"admin", verified:true, emailVisibility:true, name:"Administrator"}')

HTTP_STATUS=$(curl -s -o /tmp/bootstrap_resp.json -w "%{http_code}" \
  -X POST "$PB_URL/api/collections/users/records" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ]; then
  echo "App admin user $ADMIN_EMAIL created"
  exit 0
else
  echo "ERROR: bootstrap_app_admin.sh — failed to create app admin (HTTP $HTTP_STATUS):" >&2
  cat /tmp/bootstrap_resp.json >&2
  exit 1
fi
