#!/usr/bin/env bash
# Run once after first PocketBase startup to create collections via admin API.
# Usage: ./setup_collections.sh <admin-email> <admin-password>

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

create_collection() {
  local body="$1"
  curl -s -X POST "$PB_URL/api/collections" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" | grep -o '"id":"[^"]*"' | head -1 || true
}

echo "Creating 'entities' collection..."
create_collection '{
  "name": "entities",
  "type": "base",
  "schema": [
    {"name":"name","type":"text","required":true},
    {"name":"description","type":"text"},
    {"name":"is_active","type":"bool","required":true}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.verified = true",
  "updateRule": "@request.auth.verified = true",
  "deleteRule": null
}'

echo "Creating 'kits' collection..."
create_collection '{
  "name": "kits",
  "type": "base",
  "schema": [
    {"name":"serial","type":"text","required":true},
    {"name":"notes","type":"text"},
    {"name":"is_active","type":"bool","required":true}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.verified = true",
  "updateRule": "@request.auth.verified = true",
  "deleteRule": null
}'

echo "Creating 'transactions' collection..."
create_collection '{
  "name": "transactions",
  "type": "base",
  "schema": [
    {"name":"kit","type":"relation","required":true,"options":{"collectionId":"_KITS_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"from_entity","type":"relation","options":{"collectionId":"_ENTITIES_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"to_entity","type":"relation","required":true,"options":{"collectionId":"_ENTITIES_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"timestamp","type":"date","required":true},
    {"name":"notes","type":"text"},
    {"name":"created_by","type":"relation","required":true,"options":{"collectionId":"_pb_users_auth_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"request","type":"relation","options":{"collectionId":"_REQUESTS_","cascadeDelete":false,"maxSelect":1,"minSelect":0}}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.verified = true",
  "updateRule": null,
  "deleteRule": null
}'

echo "Creating 'requests' collection..."
create_collection '{
  "name": "requests",
  "type": "base",
  "schema": [
    {"name":"requester","type":"relation","required":true,"options":{"collectionId":"_pb_users_auth_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"date","type":"date","required":true},
    {"name":"status","type":"select","required":true,"options":{"values":["open","approved","rejected","fulfilled","cancelled"]}},
    {"name":"designated_kit","type":"relation","options":{"collectionId":"_KITS_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"target_entity","type":"relation","options":{"collectionId":"_ENTITIES_","cascadeDelete":false,"maxSelect":1,"minSelect":0}},
    {"name":"notes","type":"text"},
    {"name":"decision_notes","type":"text"}
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.verified = true || requester = @request.auth.id",
  "deleteRule": null
}'

echo ""
echo "Done. Collections created."
echo ""
echo "IMPORTANT: Go to $PB_URL/_/ and:"
echo "  1. Add 'name' (text) and 'role' (select: admin,user,viewer) fields to the 'users' collection."
echo "  2. Fix relation IDs in transactions/requests if the script used placeholder IDs."
echo "  3. Set up your first admin account."
