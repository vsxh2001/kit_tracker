#!/usr/bin/env bash
# Creates the 3 test users needed by Playwright e2e tests.
# Usage: ./seed_test_users.sh <admin-email> <admin-password>
# Skips a user if it already exists (HTTP 400).

set -euo pipefail

PB_URL="${PB_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${1:-admin@example.com}"
ADMIN_PASSWORD="${2:-password1234}"

echo "Authenticating with PocketBase at $PB_URL..."
TOKEN=$(curl -s -X POST "$PB_URL/api/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "Auth failed. Check credentials and that PocketBase is running."
  exit 1
fi
echo "Authenticated."

create_user() {
  local email="$1"
  local password="$2"
  local role="$3"

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$PB_URL/api/collections/users/records" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"$email\",
      \"password\": \"$password\",
      \"passwordConfirm\": \"$password\",
      \"role\": \"$role\",
      \"emailVisibility\": true,
      \"verified\": true
    }")
  HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -1)
  BODY=$(printf '%s' "$RESPONSE" | head -1)

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Created $email (role: $role)"
  elif [ "$HTTP_CODE" = "400" ]; then
    # User already exists — look up by email and patch the role
    USER_ID=$(curl -s "$PB_URL/api/collections/users/records?filter=email='$email'" \
      -H "Authorization: $TOKEN" \
      | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$USER_ID" ]; then
      PATCH_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X PATCH "$PB_URL/api/collections/users/records/$USER_ID" \
        -H "Authorization: $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"role\": \"$role\"}")
      if [ "$PATCH_CODE" = "200" ] || [ "$PATCH_CODE" = "204" ]; then
        echo "  Updated role for $email to $role"
      else
        echo "  WARNING: could not patch role for $email (HTTP $PATCH_CODE)"
      fi
    else
      echo "  Skipped $email (exists but could not find ID)"
    fi
  else
    echo "  WARNING: unexpected HTTP $HTTP_CODE for $email"
  fi
}

echo "Creating test users..."
create_user "logistics@kit.local" "Pass1234!" "admin"
create_user "requester@kit.local" "Pass1234!" "user"
create_user "viewer@kit.local"    "Pass1234!" "viewer"
create_user "tech@kit.local"      "Pass1234!" "technician"

echo "Done. Test users seeded."
