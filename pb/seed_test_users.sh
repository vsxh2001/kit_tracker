#!/usr/bin/env bash
# Creates the 3 test users needed by Playwright e2e tests.
# Usage: ./seed_test_users.sh <admin-email> <admin-password>
# Skips a user if it already exists (HTTP 400).

set -euo pipefail

PB_URL="${PB_URL:-http://127.0.0.1:8090}"
ADMIN_EMAIL="${1:-admin@example.com}"
ADMIN_PASSWORD="${2:-password1234}"

echo "Authenticating with PocketBase at $PB_URL..."
TOKEN=$(curl -s -X POST "$PB_URL/api/collections/_superusers/auth-with-password" \
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

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
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

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo "  Created $email (role: $role)"
  elif [ "$HTTP_CODE" = "400" ]; then
    echo "  Skipped $email (already exists or validation error)"
  else
    echo "  WARNING: unexpected HTTP $HTTP_CODE for $email"
  fi
}

echo "Creating test users..."
create_user "logistics@kit.local" "Pass1234!" "admin"
create_user "requester@kit.local" "Pass1234!" "user"
create_user "viewer@kit.local"    "Pass1234!" "viewer"

echo "Done. Test users seeded."
